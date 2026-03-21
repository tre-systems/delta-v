import { DurableObject } from 'cloudflare:workers';
import { must } from '../../shared/assert';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import {
  beginCombatPhase,
  createGame,
  filterStateForPlayer,
  processAstrogation,
  processCombat,
  processEmplacement,
  processFleetReady,
  processLogistics,
  processOrdnance,
  processSurrender,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type { GameEvent } from '../../shared/events';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { validateClientMessage } from '../../shared/protocol';
import type {
  AstrogationOrder,
  CombatAttack,
  FleetPurchase,
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  TransferOrder,
} from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import {
  createRoomConfig,
  generatePlayerToken,
  isValidPlayerToken,
  parseInitPayload,
  type RoomConfig,
  resolveSeatAssignment,
} from '../protocol';
import {
  deriveCombatEvents,
  deriveMovementEvents,
  derivePhaseChangeEvents,
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
  toMovementResultMessage,
  toStateUpdateMessage,
} from './messages';
import {
  createDisconnectMarker,
  getNextAlarmAt,
  normalizeDisconnectedPlayer,
  resolveAlarmAction,
  shouldClearDisconnectMarker,
} from './session';
import { resolveTurnTimeoutOutcome } from './turns';
export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  DB: D1Database;
}
const CHAT_RATE_LIMIT_MS = 500;
export class GameDO extends DurableObject<Env> {
  private readonly map = buildSolarSystemMap();
  // --- WebSocket tag-based player tracking ---
  private getPlayerId(ws: WebSocket): number | null {
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith('player:'));
    return tag ? parseInt(tag.split(':')[1], 10) : null;
  }
  private getPlayerCount(): number {
    return (
      this.ctx.getWebSockets('player:0').length +
      this.ctx.getWebSockets('player:1').length
    );
  }
  // --- State management ---
  private async getGameState(): Promise<GameState | null> {
    return (await this.ctx.storage.get<GameState>('gameState')) ?? null;
  }
  private async saveGameState(state: GameState): Promise<void> {
    await this.ctx.storage.put('gameState', state);
  }
  private async getEventLog(): Promise<GameEvent[]> {
    return (await this.ctx.storage.get<GameEvent[]>('eventLog')) ?? [];
  }
  private async appendEvents(...events: GameEvent[]): Promise<void> {
    const log = await this.getEventLog();
    log.push(...events);
    const MAX_EVENTS = 500;
    if (log.length > MAX_EVENTS) {
      log.splice(0, log.length - MAX_EVENTS);
    }
    await this.ctx.storage.put('eventLog', log);
  }
  private async resetEventLog(): Promise<void> {
    await this.ctx.storage.put('eventLog', []);
  }
  private async getRoomConfig(): Promise<RoomConfig | null> {
    return (await this.ctx.storage.get<RoomConfig>('roomConfig')) ?? null;
  }
  private async saveRoomConfig(config: RoomConfig): Promise<void> {
    await this.ctx.storage.put('roomConfig', config);
  }
  private async getGameCode(): Promise<string> {
    return (await this.ctx.storage.get<string>('gameCode')) ?? '';
  }
  private async getScenario() {
    const scenarioName =
      (await this.getRoomConfig())?.scenario ?? 'biplanetary';
    return SCENARIOS[scenarioName] ?? SCENARIOS.biplanetary;
  }
  private async setGameCode(code: string): Promise<void> {
    await this.ctx.storage.put('gameCode', code);
  }
  private async touchInactivity(): Promise<void> {
    await this.ctx.storage.put(
      'inactivityAt',
      Date.now() + INACTIVITY_TIMEOUT_MS,
    );
    await this.rescheduleAlarm();
  }
  private async getAlarmDeadlines() {
    const [disconnectAt, turnTimeoutAt, inactivityAt] = await Promise.all([
      this.ctx.storage.get<number>('disconnectAt'),
      this.ctx.storage.get<number>('turnTimeoutAt'),
      this.ctx.storage.get<number>('inactivityAt'),
    ]);
    return { disconnectAt, turnTimeoutAt, inactivityAt };
  }
  private async clearDisconnectMarker(): Promise<void> {
    await Promise.all([
      this.ctx.storage.delete('disconnectedPlayer'),
      this.ctx.storage.delete('disconnectTime'),
      this.ctx.storage.delete('disconnectAt'),
    ]);
  }
  private async setDisconnectMarker(playerId: number): Promise<void> {
    const marker = createDisconnectMarker(playerId, Date.now());
    await Promise.all([
      this.ctx.storage.put('disconnectedPlayer', marker.disconnectedPlayer),
      this.ctx.storage.put('disconnectTime', marker.disconnectTime),
      this.ctx.storage.put('disconnectAt', marker.disconnectAt),
    ]);
    await this.rescheduleAlarm();
  }
  private async rescheduleAlarm(): Promise<void> {
    const alarmAt = getNextAlarmAt(await this.getAlarmDeadlines());
    if (alarmAt !== null) {
      await this.ctx.storage.setAlarm(alarmAt);
    }
  }
  // --- Error telemetry ---
  private reportEngineError = (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ): void => {
    const db = this.env.DB;
    if (!db) return;
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.ctx.waitUntil(
      db
        .prepare(
          'INSERT INTO events ' +
            '(ts, anon_id, event, props, ip_hash, ua) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          Date.now(),
          null,
          'engine_error',
          JSON.stringify({
            code,
            phase,
            turn,
            message: msg,
            stack,
          }),
          'server',
          null,
        )
        .run()
        .catch((e: unknown) =>
          console.error('[D1 engine error insert failed]', e),
        ),
    );
  };
  // --- WebSocket lifecycle ---
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', {
        status: 426,
      });
    }
    const roomConfig = await this.getRoomConfig();
    if (!roomConfig) {
      return new Response('Game not found', {
        status: 404,
      });
    }
    const presentedTokenRaw = url.searchParams.get('playerToken');
    if (presentedTokenRaw !== null && !isValidPlayerToken(presentedTokenRaw)) {
      return new Response('Invalid player token', {
        status: 400,
      });
    }
    const playerCount = this.getPlayerCount();
    const disconnectedPlayer = normalizeDisconnectedPlayer(
      await this.ctx.storage.get<number>('disconnectedPlayer'),
    );
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
      return new Response(seatDecision.message, {
        status: seatDecision.status,
      });
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
      return new Response('Player token unavailable', {
        status: 500,
      });
    }
    if (shouldClearDisconnectMarker(disconnectedPlayer, playerId)) {
      await this.clearDisconnectMarker();
    }
    // Close any existing sockets for this player
    // to prevent duplicate broadcasts
    const existing = this.ctx.getWebSockets(`player:${playerId}`);
    for (const old of existing) {
      try {
        old.close(1000, 'Replaced by new connection');
      } catch {}
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`player:${playerId}`]);
    this.send(server, {
      type: 'welcome',
      playerId,
      code: roomConfig.code,
      playerToken,
    });
    const gameState = await this.getGameState();
    if (gameState) {
      const filteredState = filterStateForPlayer(gameState, playerId);
      const eventLog = await this.getEventLog();
      this.send(server, {
        type: 'gameStart',
        state: filteredState,
        eventLog,
      });
    }
    // Both players connected — start the game
    if (!gameState && playerCount + 1 >= 2) {
      this.broadcast({ type: 'matchFound' });
      await this.initGame();
    }
    await this.touchInactivity();
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.send(ws, {
        type: 'error',
        message: 'Invalid JSON',
      });
      return;
    }
    const parsed = validateClientMessage(raw);
    if (!parsed.ok) {
      this.send(ws, {
        type: 'error',
        message: parsed.error,
      });
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
        case 'surrender':
          await this.handleSurrender(playerId, ws, msg.shipIds);
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
        case 'logistics':
          await this.handleLogistics(playerId, ws, msg.transfers);
          break;
        case 'skipLogistics':
          await this.handleSkipLogistics(playerId, ws);
          break;
        case 'rematch':
          await this.handleRematch(playerId, ws);
          break;
        case 'chat': {
          const now = Date.now();
          const chatKey = `lastChat:${playerId}`;
          const last = (await this.ctx.storage.get<number>(chatKey)) ?? 0;
          if (now - last < CHAT_RATE_LIMIT_MS) break;
          await this.ctx.storage.put(chatKey, now);
          this.broadcast({
            type: 'chat',
            playerId,
            text: msg.text,
          });
          break;
        }
        case 'ping':
          this.send(ws, { type: 'pong', t: msg.t });
          break;
      }
    } catch (error) {
      console.error('Unhandled websocket message error', error);
      this.send(ws, {
        type: 'error',
        message: 'Internal server error',
      });
    }
  }
  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.getPlayerId(ws);
    const gameState = await this.getGameState();
    // If no game in progress, just clean up
    if (!gameState || gameState.phase === 'gameOver') {
      return;
    }
    // Grace period: set a 30s alarm for disconnect
    // timeout. The player can reconnect before it fires.
    if (playerId !== null) {
      await this.setDisconnectMarker(playerId);
    }
  }
  async alarm(): Promise<void> {
    const now = Date.now();
    const disconnectedPlayer = normalizeDisconnectedPlayer(
      await this.ctx.storage.get<number>('disconnectedPlayer'),
    );
    const action = resolveAlarmAction({
      now,
      disconnectedPlayer,
      ...(await this.getAlarmDeadlines()),
    });
    switch (action.type) {
      case 'disconnectExpired':
        await this.clearDisconnectMarker();
        this.broadcast({ type: 'opponentDisconnected' });
        await this.rescheduleAlarm();
        return;
      case 'turnTimeout':
        await this.handleTurnTimeout();
        return;
      case 'inactivityTimeout':
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(1000, 'Inactivity timeout');
          } catch {}
        }
        await this.ctx.storage.deleteAll();
        return;
      case 'reschedule':
        await this.rescheduleAlarm();
        return;
    }
  }
  private async handleTurnTimeout(): Promise<void> {
    await this.ctx.storage.delete('turnTimeoutAt');
    const gameState = await this.getGameState();
    if (!gameState || gameState.phase === 'gameOver') {
      await this.rescheduleAlarm();
      return;
    }
    let outcome: ReturnType<typeof resolveTurnTimeoutOutcome>;
    try {
      outcome = resolveTurnTimeoutOutcome(gameState, this.map);
    } catch (err) {
      const code = await this.getGameCode();
      console.error(
        `Engine error during turn timeout in game ${code}`,
        `(phase=${gameState.phase},` + ` turn=${gameState.turnNumber}):`,
        err,
      );
      this.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
      // State is preserved — reschedule so
      // the next player action can proceed
      await this.rescheduleAlarm();
      return;
    }
    if (!outcome) {
      await this.rescheduleAlarm();
      return;
    }
    await this.publishStateChange(outcome.state, outcome.primaryMessage, {
      events: outcome.events,
    });
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
    options?: {
      restartTurnTimer?: boolean;
      events?: GameEvent[];
    },
  ) {
    const { restartTurnTimer = true, events = [] } = options ?? {};
    await this.saveGameState(state);
    if (events.length > 0) {
      await this.appendEvents(...events);
    }
    if (restartTurnTimer) {
      await this.startTurnTimer(state);
    }
    this.broadcastStateChange(state, primaryMessage);
  }
  private async runGameStateAction<
    Success extends {
      state: GameState;
    },
  >(
    ws: WebSocket,
    action: (gameState: GameState) =>
      | Success
      | {
          error: string;
        }
      | Promise<
          | Success
          | {
              error: string;
            }
        >,
    onSuccess: (result: Success) => Promise<void> | void,
  ): Promise<void> {
    const gameState = await this.getGameState();
    if (!gameState) {
      return;
    }
    // Engine entry points clone state on entry, so
    // gameState is never mutated — if the engine throws,
    // the stored state remains intact and the game
    // continues from where it was.
    let result:
      | Success
      | {
          error: string;
        };
    try {
      result = await action(gameState);
    } catch (err) {
      const code = await this.getGameCode();
      console.error(
        `Engine error in game ${code}`,
        `(phase=${gameState.phase},` + ` turn=${gameState.turnNumber}):`,
        err,
      );
      this.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
      this.send(ws, {
        type: 'error',
        message: 'Engine error — action rejected,' + ' game state preserved',
      });
      return;
    }
    if ('error' in result) {
      this.send(ws, {
        type: 'error',
        message: result.error,
      });
      return;
    }
    await onSuccess(result);
  }
  // --- Game logic (delegates to engine) ---
  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.getRoomConfig();
    if (existing) {
      return new Response('Room already initialized', {
        status: 409,
      });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid init payload', {
        status: 400,
      });
    }
    const parsed = parseInitPayload(payload, Object.keys(SCENARIOS));
    if (!parsed.ok) {
      return new Response(parsed.error, { status: 400 });
    }
    const roomConfig = createRoomConfig(parsed.value);
    await this.saveRoomConfig(roomConfig);
    await this.setGameCode(roomConfig.code);
    await this.touchInactivity();
    return Response.json({ ok: true }, { status: 201 });
  }
  private async initGame() {
    const [roomConfig, scenario] = await Promise.all([
      this.getRoomConfig(),
      this.getScenario(),
    ]);
    const map = this.map;
    const code = roomConfig?.code ?? (await this.getGameCode());
    const gameState = createGame(scenario, map, code, findBaseHex);
    await this.saveGameState(gameState);
    await this.resetEventLog();
    await this.appendEvents({
      type: 'gameStarted',
      turn: gameState.turnNumber,
      phase: gameState.phase,
    });
    this.broadcastFiltered({
      type: 'gameStart',
      state: gameState,
    });
    await this.startTurnTimer(gameState);
  }
  private async handleFleetReady(
    playerId: number,
    ws: WebSocket,
    purchases: FleetPurchase[],
  ) {
    await this.runGameStateAction(
      ws,
      async (gameState) => {
        const scenario = await this.getScenario();
        return processFleetReady(
          gameState,
          playerId,
          purchases,
          this.map,
          scenario.availableShipTypes,
        );
      },
      async (result) => {
        await this.publishStateChange(result.state, undefined, {
          restartTurnTimer: result.state.phase === 'astrogation',
          events: derivePhaseChangeEvents(result.state),
        });
      },
    );
  }
  private async handleAstrogation(
    playerId: number,
    ws: WebSocket,
    orders: AstrogationOrder[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) =>
        processAstrogation(gameState, playerId, orders, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          resolveMovementBroadcast(result),
          { events: deriveMovementEvents(result) },
        );
      },
    );
  }
  private async handleSurrender(
    playerId: number,
    ws: WebSocket,
    shipIds: string[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) => processSurrender(gameState, playerId, shipIds),
      async (result) => {
        await this.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            restartTurnTimer: false,
            events: derivePhaseChangeEvents(result.state),
          },
        );
      },
    );
  }
  private async handleLogistics(
    playerId: number,
    ws: WebSocket,
    transfers: TransferOrder[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) => processLogistics(gameState, playerId, transfers, this.map),
      async (result) => {
        await this.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            events: derivePhaseChangeEvents(result.state),
          },
        );
      },
    );
  }
  private async handleSkipLogistics(playerId: number, ws: WebSocket) {
    await this.runGameStateAction(
      ws,
      (gameState) => skipLogistics(gameState, playerId, this.map),
      async (result) => {
        await this.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            events: derivePhaseChangeEvents(result.state),
          },
        );
      },
    );
  }
  private async handleOrdnance(
    playerId: number,
    ws: WebSocket,
    launches: OrdnanceLaunch[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) =>
        processOrdnance(gameState, playerId, launches, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          toMovementResultMessage(result),
          { events: deriveMovementEvents(result) },
        );
      },
    );
  }
  private async handleEmplaceBase(
    playerId: number,
    ws: WebSocket,
    emplacements: OrbitalBaseEmplacement[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) =>
        processEmplacement(gameState, playerId, emplacements, this.map),
      async (result) => {
        await this.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            restartTurnTimer: false,
            events: derivePhaseChangeEvents(result.state),
          },
        );
      },
    );
  }
  private async handleSkipOrdnance(playerId: number, ws: WebSocket) {
    await this.runGameStateAction(
      ws,
      (gameState) => skipOrdnance(gameState, playerId, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          resolveMovementBroadcast(result, 'stateUpdate'),
          { events: deriveMovementEvents(result) },
        );
      },
    );
  }
  private async handleCombat(
    playerId: number,
    ws: WebSocket,
    attacks: CombatAttack[],
  ) {
    await this.runGameStateAction(
      ws,
      (gameState) =>
        processCombat(gameState, playerId, attacks, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          must(resolveCombatBroadcast(result)),
          { events: deriveCombatEvents(result) },
        );
      },
    );
  }
  private async handleBeginCombat(playerId: number, ws: WebSocket) {
    await this.runGameStateAction(
      ws,
      (gameState) =>
        beginCombatPhase(gameState, playerId, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          resolveCombatBroadcast(result, 'stateUpdate'),
          { events: deriveCombatEvents(result) },
        );
      },
    );
  }
  private async handleSkipCombat(playerId: number, ws: WebSocket) {
    await this.runGameStateAction(
      ws,
      (gameState) => skipCombat(gameState, playerId, this.map, Math.random),
      async (result) => {
        await this.publishStateChange(
          result.state,
          resolveCombatBroadcast(result),
          { events: deriveCombatEvents(result) },
        );
      },
    );
  }
  private async handleRematch(playerId: number, _ws: WebSocket) {
    const requests =
      (await this.ctx.storage.get<number[]>('rematchRequests')) ?? [];
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
  private broadcastStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
  ) {
    this.broadcastFiltered(primaryMessage ?? toStateUpdateMessage(state));
    if (state.phase === 'gameOver') {
      this.broadcast({
        type: 'gameOver',
        winner: must(state.winner),
        reason: must(state.winReason),
      });
    }
  }
  // --- Messaging ---
  private send(ws: WebSocket, msg: S2C) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
  private broadcast(msg: S2C) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {}
    }
  }
  /**
   * Broadcast a message containing game state,
   * filtering hidden information per player.
   */
  private broadcastFiltered(
    msg: S2C & {
      state: GameState;
    },
  ) {
    const hasHiddenInfo =
      msg.state.scenarioRules.hiddenIdentityInspection ||
      msg.state.ships.some((s) => s.identity && !s.identity.revealed);
    if (!hasHiddenInfo) {
      this.broadcast(msg);
      return;
    }
    for (let playerId = 0; playerId < 2; playerId++) {
      const sockets = this.ctx.getWebSockets(`player:${playerId}`);
      if (sockets.length === 0) continue;
      const filtered = {
        ...msg,
        state: filterStateForPlayer(msg.state, playerId),
      };
      const data = JSON.stringify(filtered);
      for (const ws of sockets) {
        try {
          ws.send(data);
        } catch {}
      }
    }
  }
}
