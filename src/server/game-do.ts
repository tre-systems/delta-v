import { DurableObject } from 'cloudflare:workers';
import type { GameState, C2S, S2C, AstrogationOrder, OrdnanceLaunch, CombatAttack, OrbitalBaseEmplacement, FleetPurchase } from '../shared/types';
import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../shared/map-data';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../shared/constants';
import { createGame, filterStateForPlayer, processFleetReady, processAstrogation, processOrdnance, processEmplacement, skipOrdnance, beginCombatPhase, processCombat, skipCombat } from '../shared/game-engine';
import {
  generatePlayerToken,
  isValidPlayerToken,
  resolveSeatAssignment,
  validateClientMessage,
  type RoomConfig,
} from './protocol';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  toMovementResultMessage,
  toStateUpdateMessage,
  type StatefulServerMessage,
} from './game-do-messages';

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

  private async getRoomConfig(): Promise<RoomConfig | null> {
    return await this.ctx.storage.get<RoomConfig>('roomConfig') ?? null;
  }

  private async saveRoomConfig(config: RoomConfig): Promise<void> {
    await this.ctx.storage.put('roomConfig', config);
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
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      return this.handleInit(request);
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const roomConfig = await this.getRoomConfig();
    if (!roomConfig) {
      return new Response('Game not found', { status: 404 });
    }

    const presentedTokenRaw = url.searchParams.get('playerToken');
    if (presentedTokenRaw !== null && !isValidPlayerToken(presentedTokenRaw)) {
      return new Response('Invalid player token', { status: 400 });
    }

    const playerCount = this.getPlayerCount();
    const disconnectedPlayerRaw = await this.ctx.storage.get<number>('disconnectedPlayer');
    const disconnectedPlayer = disconnectedPlayerRaw === 0 || disconnectedPlayerRaw === 1
      ? disconnectedPlayerRaw
      : null;
    const seatOpen: [boolean, boolean] = [
      this.ctx.getWebSockets('player:0').length === 0,
      this.ctx.getWebSockets('player:1').length === 0,
    ];

    const seatDecision = resolveSeatAssignment({
      presentedToken: presentedTokenRaw,
      disconnectedPlayer,
      seatOpen,
      playerTokens: roomConfig.playerTokens,
      inviteTokens: roomConfig.inviteTokens,
    });

    if (seatDecision.type === 'reject') {
      return new Response(seatDecision.message, { status: seatDecision.status });
    }

    const playerId = seatDecision.playerId;
    if (seatDecision.issueNewToken) {
      roomConfig.playerTokens[playerId] = generatePlayerToken();
      if (seatDecision.consumeInviteToken) {
        roomConfig.inviteTokens[playerId] = null;
      }
      await this.saveRoomConfig(roomConfig);
    }

    const playerToken = roomConfig.playerTokens[playerId];
    if (!playerToken) {
      return new Response('Player token unavailable', { status: 500 });
    }

    if (disconnectedPlayer === playerId) {
      await this.ctx.storage.delete('disconnectedPlayer');
      await this.ctx.storage.delete('disconnectTime');
      await this.ctx.storage.delete('disconnectAt');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [`player:${playerId}`]);

    this.send(server, { type: 'welcome', playerId, code: roomConfig.code, playerToken });

    const gameState = await this.getGameState();
    if (gameState) {
      const filteredState = filterStateForPlayer(gameState, playerId);
      this.send(server, { type: 'gameStart', state: filteredState });
    }

    // Both players connected — start the game
    if (!gameState && playerCount + 1 >= 2) {
      this.broadcast({ type: 'matchFound' });
      await this.initGame();
    }

    await this.touchInactivity();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const parsed = validateClientMessage(raw);
    if (!parsed.ok) {
      this.send(ws, { type: 'error', message: parsed.error });
      return;
    }
    const msg: C2S = parsed.value;

    const playerId = this.getPlayerId(ws);
    if (playerId === null) return;

    await this.touchInactivity();

    try {
      switch (msg.type) {
        case 'fleetReady':
          await this.handleFleetReady(playerId, ws, msg.purchases);
          break;
        case 'astrogation':
          await this.handleAstrogation(playerId, ws, msg.orders);
          break;
        case 'ordnance':
          await this.handleOrdnance(playerId, ws, msg.launches);
          break;
        case 'emplaceBase':
          await this.handleEmplaceBase(playerId, ws, msg.emplacements);
          break;
        case 'skipOrdnance':
          await this.handleSkipOrdnance(playerId, ws);
          break;
        case 'beginCombat':
          await this.handleBeginCombat(playerId, ws);
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
    } catch (error) {
      console.error('Unhandled websocket message error', error);
      this.send(ws, { type: 'error', message: 'Internal server error' });
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
        await this.publishStateChange(
          result.state,
          resolveMovementBroadcast(result),
        );
      }
    } else if (gameState.phase === 'ordnance') {
      const result = skipOrdnance(gameState, playerId, map);
      if (!('error' in result)) {
        await this.publishStateChange(
          result.state,
          resolveMovementBroadcast(result, 'stateUpdate'),
        );
      }
    } else if (gameState.phase === 'combat') {
      const result = skipCombat(gameState, playerId, map);
      if (!('error' in result)) {
        await this.publishStateChange(
          result.state,
          resolveCombatBroadcast(result),
        );
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

  private async publishStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    restartTurnTimer = true,
  ) {
    if (primaryMessage) {
      this.broadcastFiltered(primaryMessage);
    }
    this.broadcastEndOrUpdate(state);
    await this.saveGameState(state);
    if (restartTurnTimer) {
      await this.startTurnTimer(state);
    }
  }

  // --- Game logic (delegates to engine) ---

  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.getRoomConfig();
    if (existing) {
      return new Response('Room already initialized', { status: 409 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid init payload', { status: 400 });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return new Response('Invalid init payload', { status: 400 });
    }

    const { code, scenario, playerToken, inviteToken } = payload as {
      code?: unknown;
      scenario?: unknown;
      playerToken?: unknown;
      inviteToken?: unknown;
    };

    if (typeof code !== 'string' || !/^[A-Z0-9]{5}$/.test(code)) {
      return new Response('Invalid room code', { status: 400 });
    }
    if (typeof scenario !== 'string' || !(scenario in SCENARIOS)) {
      return new Response('Invalid scenario', { status: 400 });
    }
    if (!isValidPlayerToken(playerToken)) {
      return new Response('Invalid player token', { status: 400 });
    }
    if (!isValidPlayerToken(inviteToken)) {
      return new Response('Invalid invite token', { status: 400 });
    }

    const roomConfig: RoomConfig = {
      code,
      scenario,
      playerTokens: [playerToken, null],
      inviteTokens: [null, inviteToken],
    };

    await this.saveRoomConfig(roomConfig);
    await this.setGameCode(code);
    await this.touchInactivity();
    return Response.json({ ok: true }, { status: 201 });
  }

  private async initGame() {
    const roomConfig = await this.getRoomConfig();
    const scenarioName = roomConfig?.scenario ?? 'biplanetary';
    const scenario = SCENARIOS[scenarioName] ?? SCENARIOS.biplanetary;
    const map = getSolarSystemMap();
    const code = roomConfig?.code ?? await this.getGameCode();

    const gameState = createGame(scenario, map, code, findBaseHex);

    await this.saveGameState(gameState);
    this.broadcastFiltered({ type: 'gameStart', state: gameState });
    await this.startTurnTimer(gameState);
  }

  private async handleFleetReady(playerId: number, ws: WebSocket, purchases: FleetPurchase[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const scenarioName = (await this.getRoomConfig())?.scenario ?? 'biplanetary';
    const scenario = SCENARIOS[scenarioName] ?? SCENARIOS.biplanetary;
    const result = processFleetReady(gameState, playerId, purchases, map, scenario.availableShipTypes);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    await this.publishStateChange(
      result.state,
      undefined,
      result.state.phase === 'astrogation',
    );
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

    await this.publishStateChange(
      result.state,
      resolveMovementBroadcast(result),
    );
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

    await this.publishStateChange(result.state, toMovementResultMessage(result));
  }

  private async handleEmplaceBase(playerId: number, ws: WebSocket, emplacements: OrbitalBaseEmplacement[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = processEmplacement(gameState, playerId, emplacements, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    await this.publishStateChange(result.state, toStateUpdateMessage(result.state), false);
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

    await this.publishStateChange(
      result.state,
      resolveMovementBroadcast(result, 'stateUpdate'),
    );
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

    await this.publishStateChange(result.state, resolveCombatBroadcast(result)!);
  }

  private async handleBeginCombat(playerId: number, ws: WebSocket) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    const map = getSolarSystemMap();
    const result = beginCombatPhase(gameState, playerId, map);

    if ('error' in result) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    await this.publishStateChange(
      result.state,
      resolveCombatBroadcast(result, 'stateUpdate'),
    );
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

    await this.publishStateChange(
      result.state,
      resolveCombatBroadcast(result),
    );
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
      this.broadcastFiltered({ type: 'stateUpdate', state });
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

  /**
   * Broadcast a message containing game state, filtering hidden information per player.
   */
  private broadcastFiltered(msg: S2C & { state: GameState }) {
    const hasHiddenInfo = msg.state.scenarioRules.hiddenIdentityInspection
      || msg.state.ships.some(s => s.hasFugitives || s.identityRevealed === false);
    if (!hasHiddenInfo) {
      this.broadcast(msg);
      return;
    }

    for (let playerId = 0; playerId < 2; playerId++) {
      const sockets = this.ctx.getWebSockets(`player:${playerId}`);
      if (sockets.length === 0) continue;
      const filtered = { ...msg, state: filterStateForPlayer(msg.state, playerId) };
      const data = JSON.stringify(filtered);
      for (const ws of sockets) {
        try { ws.send(data); } catch {}
      }
    }
  }
}
