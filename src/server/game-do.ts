import { DurableObject } from 'cloudflare:workers';
import type { GameState, C2S, S2C, AstrogationOrder, OrdnanceLaunch, CombatAttack } from '../shared/types';
import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../shared/map-data';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../shared/constants';
import { createGame, processAstrogation, processOrdnance, skipOrdnance, processCombat, skipCombat } from '../shared/game-engine';

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
}

export class GameDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // --- WebSocket tag-based player tracking ---

  private getPlayerId(ws: WebSocket): number | null {
    const tag = this.ctx.getTags(ws).find(t => t.startsWith('player:'));
    return tag ? parseInt(tag.split(':')[1]) : null;
  }

  private getPlayerCount(): number {
    return this.ctx.getWebSockets('player:0').length
      + this.ctx.getWebSockets('player:1').length;
  }

  // --- State management ---

  private async getGameState(): Promise<GameState | null> {
    return await this.ctx.storage.get<GameState>('gameState') ?? null;
  }

  private async saveGameState(state: GameState): Promise<void> {
    await this.ctx.storage.put('gameState', state);
  }

  private async getGameCode(): Promise<string> {
    return await this.ctx.storage.get<string>('gameCode') ?? '';
  }

  private async setGameCode(code: string): Promise<void> {
    await this.ctx.storage.put('gameCode', code);
  }

  private async touchInactivity(): Promise<void> {
    await this.ctx.storage.put('inactivityAt', Date.now() + INACTIVITY_TIMEOUT_MS);
    await this.rescheduleAlarm();
  }

  private async rescheduleAlarm(): Promise<void> {
    const [disconnectAt, turnTimeoutAt, inactivityAt] = await Promise.all([
      this.ctx.storage.get<number>('disconnectAt'),
      this.ctx.storage.get<number>('turnTimeoutAt'),
      this.ctx.storage.get<number>('inactivityAt'),
    ]);

    const deadlines = [disconnectAt, turnTimeoutAt, inactivityAt]
      .filter((value): value is number => value !== undefined);

    if (deadlines.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...deadlines));
    }
  }

  // --- WebSocket lifecycle ---

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    const codeMatch = url.pathname.match(/\/ws\/([A-Z0-9]{5})/);
    if (codeMatch) {
      await this.setGameCode(codeMatch[1]);
    }

    // Store scenario from query param
    const scenario = url.searchParams.get('scenario');
    if (scenario) {
      await this.ctx.storage.put('scenario', scenario);
    }

    const playerCount = this.getPlayerCount();
    const disconnectedPlayer = await this.ctx.storage.get<number>('disconnectedPlayer');

    // Check if this is a reconnection
    if (disconnectedPlayer !== undefined && playerCount < 2) {
      // Reconnecting player takes the disconnected slot
      const playerId = disconnectedPlayer;
      await this.ctx.storage.delete('disconnectedPlayer');
      await this.ctx.storage.delete('disconnectTime');

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [`player:${playerId}`]);

      const code = await this.getGameCode();
      this.send(server, { type: 'welcome', playerId, code });

      // Send current game state so they can rejoin
      const gameState = await this.getGameState();
      if (gameState) {
        this.send(server, { type: 'gameStart', state: gameState });
      }

      await this.ctx.storage.delete('disconnectAt');
      await this.touchInactivity();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (playerCount >= 2) {
      return new Response('Game is full', { status: 409 });
    }

    const playerId = this.ctx.getWebSockets('player:0').length === 0 ? 0 : 1;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [`player:${playerId}`]);

    const code = await this.getGameCode();
    this.send(server, { type: 'welcome', playerId, code });

    // Both players connected — start the game
    if (playerCount + 1 >= 2) {
      this.broadcast({ type: 'matchFound' });
      await this.initGame();
    }

    await this.touchInactivity();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let msg: C2S;
    try {
      msg = JSON.parse(message);
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const playerId = this.getPlayerId(ws);
    if (playerId === null) return;

    await this.touchInactivity();

    switch (msg.type) {
      case 'astrogation':
        await this.handleAstrogation(playerId, ws, msg.orders);
        break;
      case 'ordnance':
        await this.handleOrdnance(playerId, ws, msg.launches);
        break;
      case 'skipOrdnance':
        await this.handleSkipOrdnance(playerId, ws);
        break;
      case 'combat':
        await this.handleCombat(playerId, ws, msg.attacks);
        break;
      case 'skipCombat':
        await this.handleSkipCombat(playerId, ws);
        break;
      case 'rematch':
        await this.handleRematch(playerId, ws);
        break;
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t });
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.getPlayerId(ws);
    const gameState = await this.getGameState();

    // If no game in progress, just clean up
    if (!gameState || gameState.phase === 'gameOver') {
      return;
    }

    // Grace period: set a 30s alarm for disconnect timeout
    // The player can reconnect before it fires
    if (playerId !== null) {
      await this.ctx.storage.put('disconnectedPlayer', playerId);
      await this.ctx.storage.put('disconnectTime', Date.now());
      await this.ctx.storage.put('disconnectAt', Date.now() + 30_000);
      await this.rescheduleAlarm();
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const disconnectedPlayer = await this.ctx.storage.get<number>('disconnectedPlayer');
    const disconnectAt = await this.ctx.storage.get<number>('disconnectAt');

    if (disconnectedPlayer !== undefined && disconnectAt !== undefined && now >= disconnectAt) {
      // Disconnect grace period expired — notify remaining player
      await this.ctx.storage.delete('disconnectedPlayer');
      await this.ctx.storage.delete('disconnectTime');
      await this.ctx.storage.delete('disconnectAt');
      this.broadcast({ type: 'opponentDisconnected' });
      await this.rescheduleAlarm();
      return;
    }

    // Check if turn timeout is pending
    const turnTimeoutAt = await this.ctx.storage.get<number>('turnTimeoutAt');
    if (turnTimeoutAt !== undefined && now >= turnTimeoutAt - 500) {
      await this.handleTurnTimeout();
      return;
    }

    const inactivityAt = await this.ctx.storage.get<number>('inactivityAt');
    if (inactivityAt !== undefined && now >= inactivityAt) {
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(1000, 'Inactivity timeout'); } catch {}
      }
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.rescheduleAlarm();
  }

  private async handleTurnTimeout(): Promise<void> {
    await this.ctx.storage.delete('turnTimeoutAt');
    const gameState = await this.getGameState();
    if (!gameState || gameState.phase === 'gameOver') {
      await this.rescheduleAlarm();
      return;
    }

    const map = getSolarSystemMap();
    const playerId = gameState.activePlayer;

    if (gameState.phase === 'astrogation') {
      // Auto-submit empty orders (no burns)
      const orders: AstrogationOrder[] = gameState.ships
        .filter(s => s.owner === playerId)
        .map(s => ({ shipId: s.id, burn: null }));
      const result = processAstrogation(gameState, playerId, orders, map);
      if (!('error' in result)) {
        if ('movements' in result) {
          this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
        }
        this.broadcastEndOrUpdate(result.state);
        await this.saveGameState(result.state);
        await this.startTurnTimer(result.state);
      }
    } else if (gameState.phase === 'ordnance') {
      const result = skipOrdnance(gameState, playerId, map);
      if (!('error' in result)) {
        if ('movements' in result) {
          this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
        } else {
          this.broadcast({ type: 'stateUpdate', state: result.state });
        }
        this.broadcastEndOrUpdate(result.state);
        await this.saveGameState(result.state);
        await this.startTurnTimer(result.state);
      }
    } else if (gameState.phase === 'combat') {
      const result = skipCombat(gameState, playerId, map);
      if (!('error' in result)) {
        if (result.baseDefenseResults && result.baseDefenseResults.length > 0) {
          this.broadcast({ type: 'combatResult', results: result.baseDefenseResults, state: result.state });
        }
        this.broadcastEndOrUpdate(result.state);
        await this.saveGameState(result.state);
        await this.startTurnTimer(result.state);
      }
    } else {
      await this.rescheduleAlarm();
    }
  }

  private async startTurnTimer(state: GameState): Promise<void> {
    if (state.phase === 'gameOver') {
      await this.ctx.storage.delete('turnTimeoutAt');
      await this.rescheduleAlarm();
      return;
    }
    const timeoutAt = Date.now() + TURN_TIMEOUT_MS;
    await this.ctx.storage.put('turnTimeoutAt', timeoutAt);
    await this.rescheduleAlarm();
  }

  // --- Game logic (delegates to engine) ---

  private async initGame() {
    const scenarioName = await this.ctx.storage.get<string>('scenario') ?? 'biplanetary';
    const scenario = SCENARIOS[scenarioName] ?? SCENARIOS.biplanetary;
    const map = getSolarSystemMap();
    const code = await this.getGameCode();

    const gameState = createGame(scenario, map, code, findBaseHex);

    await this.saveGameState(gameState);
    this.broadcast({ type: 'gameStart', state: gameState });
    await this.startTurnTimer(gameState);
  }

  private async handleAstrogation(playerId: number, ws: WebSocket, orders: AstrogationOrder[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = processAstrogation(gameState, playerId, orders, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    if ('movements' in result) {
      this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
    }
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
    await this.startTurnTimer(result.state);
  }

  private async handleOrdnance(playerId: number, ws: WebSocket, launches: OrdnanceLaunch[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = processOrdnance(gameState, playerId, launches, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
    await this.startTurnTimer(result.state);
  }

  private async handleSkipOrdnance(playerId: number, ws: WebSocket) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = skipOrdnance(gameState, playerId, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    if ('movements' in result) {
      this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
    } else {
      this.broadcast({ type: 'stateUpdate', state: result.state });
    }
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
    await this.startTurnTimer(result.state);
  }

  private async handleCombat(playerId: number, ws: WebSocket, attacks: CombatAttack[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = processCombat(gameState, playerId, attacks, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.broadcast({ type: 'combatResult', results: result.results, state: result.state });
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
    await this.startTurnTimer(result.state);
  }

  private async handleSkipCombat(playerId: number, ws: WebSocket) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = skipCombat(gameState, playerId, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    // If base defense fire happened, send as combat results
    if (result.baseDefenseResults && result.baseDefenseResults.length > 0) {
      this.broadcast({ type: 'combatResult', results: result.baseDefenseResults, state: result.state });
    }

    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
    await this.startTurnTimer(result.state);
  }

  private async handleRematch(playerId: number, ws: WebSocket) {
    const requests = await this.ctx.storage.get<number[]>('rematchRequests') ?? [];
    if (!requests.includes(playerId)) {
      requests.push(playerId);
    }

    if (requests.length >= 2) {
      // Both players want a rematch — restart
      await this.ctx.storage.delete('rematchRequests');
      await this.initGame();
    } else {
      // First request — notify both players
      await this.ctx.storage.put('rematchRequests', requests);
      this.broadcast({ type: 'rematchPending' });
    }
  }

  private broadcastEndOrUpdate(state: GameState) {
    if (state.phase === 'gameOver') {
      this.broadcast({ type: 'gameOver', winner: state.winner!, reason: state.winReason! });
    } else {
      this.broadcast({ type: 'stateUpdate', state });
    }
  }

  // --- Messaging ---

  private send(ws: WebSocket, msg: S2C) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private broadcast(msg: S2C) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }
}
