import { DurableObject } from 'cloudflare:workers';
import { must } from '../../shared/assert';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import type { EngineEvent } from '../../shared/engine/engine-events';
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
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { validateClientMessage } from '../../shared/protocol';
import type { ReplayArchive } from '../../shared/replay';
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
  allocateMatchIdentity,
  appendEvents,
  appendReplayMessage,
  getReplayArchive,
  resetEventLog,
} from './archive';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  resolveStateBearingMessage,
  type StatefulServerMessage,
  toGameStartMessage,
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
const WS_MSG_RATE_LIMIT = 10;
const WS_MSG_RATE_WINDOW_MS = 1_000;
const INACTIVITY_FLUSH_MS = 60_000;
export class GameDO extends DurableObject<Env> {
  private readonly map = buildSolarSystemMap();
  private readonly replacedSockets = new WeakSet<WebSocket>();
  private readonly msgRates = new WeakMap<
    WebSocket,
    { count: number; windowStart: number }
  >();
  private readonly lastChatAt = new Map<number, number>();
  private cachedInactivityAt: number | null = null;
  private lastInactivityFlush = 0;
  // --- WebSocket tag-based player tracking ---
  private getPlayerId(ws: WebSocket): number | null {
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith('player:'));
    return tag ? parseInt(tag.split(':')[1], 10) : null;
  }
  private getSeatOpen(): [boolean, boolean] {
    return [
      this.ctx.getWebSockets('player:0').length === 0,
      this.ctx.getWebSockets('player:1').length === 0,
    ];
  }
  private getConnectedSeatCountAfterJoin(
    seatOpen: [boolean, boolean],
    playerId: 0 | 1,
  ): number {
    const connectedSeats = seatOpen.filter((open) => !open).length;

    return connectedSeats + (seatOpen[playerId] ? 1 : 0);
  }
  private replacePlayerSockets(playerId: 0 | 1): void {
    for (const old of this.ctx.getWebSockets(`player:${playerId}`)) {
      try {
        this.replacedSockets.add(old);
        old.close(1000, 'Replaced by new connection');
      } catch {}
    }
  }
  // --- State management ---
  private async getGameState(): Promise<GameState | null> {
    return (await this.ctx.storage.get<GameState>('gameState')) ?? null;
  }
  private async saveGameState(state: GameState): Promise<void> {
    await this.ctx.storage.put('gameState', state);
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
    const now = Date.now();
    const shouldFlushImmediately = this.cachedInactivityAt === null;

    this.cachedInactivityAt = now + INACTIVITY_TIMEOUT_MS;
    if (
      shouldFlushImmediately ||
      now - this.lastInactivityFlush >= INACTIVITY_FLUSH_MS
    ) {
      await this.ctx.storage.put('inactivityAt', this.cachedInactivityAt);
      this.lastInactivityFlush = now;
      await this.rescheduleAlarm();
    }
  }
  private async getAlarmDeadlines() {
    const [disconnectAt, turnTimeoutAt, storedInactivityAt] = await Promise.all(
      [
        this.ctx.storage.get<number>('disconnectAt'),
        this.ctx.storage.get<number>('turnTimeoutAt'),
        this.ctx.storage.get<number>('inactivityAt'),
      ],
    );
    return {
      disconnectAt,
      turnTimeoutAt,
      inactivityAt: this.cachedInactivityAt ?? storedInactivityAt,
    };
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
  private async resolveJoinAttempt(presentedTokenRaw: string | null): Promise<
    | {
        ok: false;
        response: Response;
      }
    | {
        ok: true;
        roomConfig: RoomConfig;
        playerId: 0 | 1;
        issueNewToken: boolean;
        consumeInviteToken: boolean;
        disconnectedPlayer: number | null;
        seatOpen: [boolean, boolean];
      }
  > {
    const roomConfig = await this.getRoomConfig();
    if (!roomConfig) {
      return {
        ok: false,
        response: new Response('Game not found', {
          status: 404,
        }),
      };
    }
    if (presentedTokenRaw !== null && !isValidPlayerToken(presentedTokenRaw)) {
      return {
        ok: false,
        response: new Response('Invalid player token', {
          status: 400,
        }),
      };
    }
    const disconnectedPlayer = normalizeDisconnectedPlayer(
      await this.ctx.storage.get<number>('disconnectedPlayer'),
    );
    const seatOpen = this.getSeatOpen();
    const seatDecision = resolveSeatAssignment({
      presentedToken: presentedTokenRaw,
      disconnectedPlayer,
      seatOpen,
      playerTokens: roomConfig.playerTokens,
      inviteTokens: roomConfig.inviteTokens,
    });
    if (seatDecision.type === 'reject') {
      return {
        ok: false,
        response: new Response(seatDecision.message, {
          status: seatDecision.status,
        }),
      };
    }
    return {
      ok: true,
      roomConfig,
      playerId: seatDecision.playerId,
      issueNewToken: seatDecision.issueNewToken,
      consumeInviteToken: seatDecision.consumeInviteToken,
      disconnectedPlayer,
      seatOpen,
    };
  }
  private async rescheduleAlarm(): Promise<void> {
    const alarmAt = getNextAlarmAt(await this.getAlarmDeadlines());
    if (alarmAt !== null) {
      await this.ctx.storage.setAlarm(alarmAt);
    }
  }
  private getReplayViewerId(
    roomConfig: RoomConfig,
    presentedTokenRaw: string | null,
  ): 0 | 1 | null {
    if (!presentedTokenRaw || !isValidPlayerToken(presentedTokenRaw)) {
      return null;
    }

    if (roomConfig.playerTokens[0] === presentedTokenRaw) {
      return 0;
    }

    if (roomConfig.playerTokens[1] === presentedTokenRaw) {
      return 1;
    }

    return null;
  }
  private filterReplayArchiveForPlayer(
    archive: ReplayArchive,
    playerId: number,
  ): ReplayArchive {
    return {
      ...archive,
      entries: archive.entries.map((entry) => ({
        ...entry,
        message: {
          ...entry.message,
          state: filterStateForPlayer(entry.message.state, playerId),
        },
      })),
    };
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
    if (url.pathname === '/join' && request.method === 'GET') {
      return this.handleJoinCheck(request);
    }
    if (url.pathname === '/replay' && request.method === 'GET') {
      return this.handleReplayRequest(request);
    }
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', {
        status: 426,
      });
    }
    const presentedTokenRaw = url.searchParams.get('playerToken');
    const joinAttempt = await this.resolveJoinAttempt(presentedTokenRaw);
    if (!joinAttempt.ok) {
      return joinAttempt.response;
    }
    const {
      roomConfig,
      playerId,
      issueNewToken,
      consumeInviteToken,
      disconnectedPlayer,
      seatOpen,
    } = joinAttempt;
    const connectedSeatCountAfterJoin = this.getConnectedSeatCountAfterJoin(
      seatOpen,
      playerId,
    );
    if (issueNewToken) {
      roomConfig.playerTokens[playerId] = generatePlayerToken();
      if (consumeInviteToken) {
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
    this.replacePlayerSockets(playerId);
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
      this.send(server, {
        type: 'gameStart',
        state: filteredState,
      });
    }
    // Both players connected — start the game
    if (!gameState && connectedSeatCountAfterJoin >= 2) {
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
    const now = Date.now();
    const rate = this.msgRates.get(ws);
    if (rate && now - rate.windowStart < WS_MSG_RATE_WINDOW_MS) {
      rate.count++;
      if (rate.count > WS_MSG_RATE_LIMIT) {
        try {
          ws.close(1008, 'Rate limit exceeded');
        } catch {}
        return;
      }
    } else {
      this.msgRates.set(ws, {
        count: 1,
        windowStart: now,
      });
    }
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
          const chatTime = Date.now();
          const last = this.lastChatAt.get(playerId) ?? 0;
          if (chatTime - last < CHAT_RATE_LIMIT_MS) break;
          this.lastChatAt.set(playerId, chatTime);
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
    if (this.replacedSockets.delete(ws)) {
      return;
    }
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
      case 'disconnectExpired': {
        await this.clearDisconnectMarker();
        const gameState = await this.getGameState();
        if (!gameState || gameState.phase === 'gameOver') {
          await this.rescheduleAlarm();
          return;
        }
        gameState.phase = 'gameOver';
        gameState.winner = 1 - action.playerId;
        gameState.winReason = 'Opponent disconnected';
        await this.publishStateChange(gameState, undefined, {
          restartTurnTimer: false,
          events: [
            {
              type: 'gameOver' as const,
              winner: gameState.winner,
              reason: gameState.winReason ?? '',
            },
          ],
        });
        return;
      }
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
      events?: EngineEvent[];
    },
  ) {
    const { restartTurnTimer = true, events = [] } = options ?? {};
    const roomCode = await this.getGameCode();
    const matchNumber = await this.ctx.storage.get<number>('matchNumber');
    const replayMessage = resolveStateBearingMessage(state, primaryMessage);
    await this.saveGameState(state);
    if (events.length > 0) {
      await appendEvents(this.ctx.storage, ...events);
    }
    if (matchNumber !== undefined) {
      await appendReplayMessage(
        this.ctx.storage,
        roomCode,
        matchNumber,
        replayMessage,
      );
    }
    if (restartTurnTimer) {
      await this.startTurnTimer(state);
    }
    this.broadcastStateChange(state, replayMessage);
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
  private async handleJoinCheck(request: Request): Promise<Response> {
    const presentedTokenRaw = new URL(request.url).searchParams.get(
      'playerToken',
    );
    const joinAttempt = await this.resolveJoinAttempt(presentedTokenRaw);

    return joinAttempt.ok
      ? Response.json({ ok: true }, { status: 200 })
      : joinAttempt.response;
  }
  private async handleReplayRequest(request: Request): Promise<Response> {
    const roomConfig = await this.getRoomConfig();

    if (!roomConfig) {
      return new Response('Game not found', {
        status: 404,
      });
    }

    const url = new URL(request.url);
    const playerId = this.getReplayViewerId(
      roomConfig,
      url.searchParams.get('playerToken'),
    );

    if (playerId === null) {
      return new Response('Invalid player token', {
        status: 403,
      });
    }

    const gameId =
      url.searchParams.get('gameId') ?? (await this.getGameState())?.gameId;

    if (!gameId) {
      return new Response('Replay not found', {
        status: 404,
      });
    }

    const archive = await getReplayArchive(this.ctx.storage, gameId);

    if (!archive) {
      return new Response('Replay not found', {
        status: 404,
      });
    }

    await this.touchInactivity();

    return Response.json(this.filterReplayArchiveForPlayer(archive, playerId));
  }
  private async initGame() {
    const [roomConfig, scenario] = await Promise.all([
      this.getRoomConfig(),
      this.getScenario(),
    ]);
    const map = this.map;
    const code = roomConfig?.code ?? (await this.getGameCode());
    const { gameId, matchNumber } = await allocateMatchIdentity(
      this.ctx.storage,
      code,
    );
    const gameState = createGame(scenario, map, gameId, findBaseHex);
    const gameStartMessage = toGameStartMessage(gameState);
    await this.saveGameState(gameState);
    await resetEventLog(this.ctx.storage);
    await appendReplayMessage(
      this.ctx.storage,
      code,
      matchNumber,
      gameStartMessage,
    );
    await appendEvents(this.ctx.storage, {
      type: 'gameCreated',
      scenario: gameState.scenario,
      turn: gameState.turnNumber,
      phase: gameState.phase,
    });
    this.broadcastFiltered(gameStartMessage);
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
          events: result.engineEvents,
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
          { events: result.engineEvents },
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
            events: result.engineEvents,
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
            events: result.engineEvents,
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
            events: result.engineEvents,
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
          { events: result.engineEvents },
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
            events: result.engineEvents,
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
          { events: result.engineEvents },
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
          { events: result.engineEvents },
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
          { events: result.engineEvents },
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
          { events: result.engineEvents },
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
