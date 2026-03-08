import { DurableObject } from 'cloudflare:workers';
import type { GameState, C2S, S2C, AstrogationOrder, OrdnanceLaunch, CombatAttack } from '../shared/types';
import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../shared/map-data';
import { INACTIVITY_TIMEOUT_MS } from '../shared/constants';
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

    await this.ctx.storage.setAlarm(Date.now() + INACTIVITY_TIMEOUT_MS);
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

    await this.ctx.storage.setAlarm(Date.now() + INACTIVITY_TIMEOUT_MS);

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
        await this.initGame();
        break;
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t });
        break;
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcast({ type: 'opponentDisconnected' });
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, 'Inactivity timeout'); } catch {}
    }
    await this.ctx.storage.deleteAll();
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

    this.broadcast({ type: 'movementResult', movements: result.movements, ordnanceMovements: result.ordnanceMovements, events: result.events, state: result.state });
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
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

    this.broadcast({ type: 'stateUpdate', state: result.state });
    this.broadcastEndOrUpdate(result.state);
    await this.saveGameState(result.state);
  }

  private async handleSkipOrdnance(playerId: number, ws: WebSocket) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const result = skipOrdnance(gameState, playerId);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.broadcast({ type: 'stateUpdate', state: result.state });
    await this.saveGameState(result.state);
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
  }

  private async handleSkipCombat(playerId: number, ws: WebSocket) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const result = skipCombat(gameState, playerId);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.broadcast({ type: 'stateUpdate', state: result.state });
    await this.saveGameState(result.state);
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
