import { DurableObject } from 'cloudflare:workers';
import { must } from '../../shared/assert';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  createGame,
  filterStateForPlayer,
} from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { deriveActionRng } from '../../shared/prng';
import type { GameState } from '../../shared/types/domain';
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
  appendEnvelopedEvents,
  getEventStreamLength,
  getMatchSeed,
  getProjectedCurrentState,
  getProjectedCurrentStateRaw,
  getProjectedReplayTimeline,
  getReplayViewerId,
  hasProjectionParity,
  saveCheckpoint,
  saveMatchCreatedAt,
} from './archive';
import {
  createGameStateActionHandlers,
  dispatchGameStateAction,
  type EngineFailure,
  type GameStateActionMessage,
  runGameStateAction,
} from './game-do-actions';
import {
  applySocketRateLimit,
  handleAuxMessage,
  parseClientSocketMessage,
} from './game-do-socket';
import { archiveCompletedMatch } from './match-archive';
import {
  resolveStateBearingMessage,
  type StatefulServerMessage,
  toGameStartMessage,
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
  MATCH_ARCHIVE?: R2Bucket;
}

export class GameDO extends DurableObject<Env> {
  private readonly map = buildSolarSystemMap();
  private readonly replacedSockets = new WeakSet<WebSocket>();
  private readonly msgRates = new WeakMap<
    WebSocket,
    { count: number; windowStart: number }
  >();
  private readonly lastChatAt = new Map<number, number>();
  private readonly gameStateActionHandlers = createGameStateActionHandlers({
    map: this.map,
    getScenario: () => this.getScenario(),
    getActionRng: () => this.getActionRng(),
    publishStateChange: (state, primaryMessage, options) =>
      this.publishStateChange(state, primaryMessage, options),
  });
  // --- WebSocket tag-based player tracking ---
  private getPlayerId(ws: WebSocket): number | null {
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith('player:'));
    return tag ? parseInt(tag.split(':')[1], 10) : null;
  }

  private isGameStateActionMessage(
    message: C2S,
  ): message is GameStateActionMessage {
    return message.type in this.gameStateActionHandlers;
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
  private async getCurrentGameState(): Promise<GameState | null> {
    const gameId = await this.getLatestGameId();

    if (!gameId) {
      return null;
    }

    return getProjectedCurrentStateRaw(this.ctx.storage, gameId);
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
    return {
      disconnectAt,
      turnTimeoutAt,
      inactivityAt,
    };
  }

  private async isRoomArchived(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>('roomArchived')) === true;
  }

  private async archiveRoomState(): Promise<void> {
    await Promise.all([
      this.ctx.storage.put('roomArchived', true),
      this.ctx.storage.delete('disconnectAt'),
      this.ctx.storage.delete('disconnectTime'),
      this.ctx.storage.delete('disconnectedPlayer'),
      this.ctx.storage.delete('inactivityAt'),
      this.ctx.storage.delete('rematchRequests'),
      this.ctx.storage.delete('turnTimeoutAt'),
    ]);
  }

  private async clearRoomArchivedFlag(): Promise<void> {
    await this.ctx.storage.delete('roomArchived');
  }

  private async getLatestGameId(): Promise<string | null> {
    const [code, matchNumber] = await Promise.all([
      this.getGameCode(),
      this.ctx.storage.get<number>('matchNumber'),
    ]);

    if (!code || matchNumber === undefined) {
      return null;
    }

    return `${code}-m${matchNumber}`;
  }

  private async getActionRng(): Promise<() => number> {
    const gameId = await this.getLatestGameId();

    if (!gameId) {
      return Math.random;
    }

    const [seed, seq] = await Promise.all([
      getMatchSeed(this.ctx.storage, gameId),
      getEventStreamLength(this.ctx.storage, gameId),
    ]);

    if (seed === null) {
      return Math.random;
    }

    return deriveActionRng(seed, seq);
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

    if (await this.isRoomArchived()) {
      return {
        ok: false,
        response: new Response('Game archived', {
          status: 410,
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

  private reportProjectionParityMismatch = async (
    gameId: string,
    liveState: GameState,
  ): Promise<void> => {
    const projectedState = await getProjectedCurrentStateRaw(
      this.ctx.storage,
      gameId,
    );
    console.error('[projection parity mismatch]', {
      gameId,
      liveTurn: liveState.turnNumber,
      livePhase: liveState.phase,
      projectedTurn: projectedState?.turnNumber ?? null,
      projectedPhase: projectedState?.phase ?? null,
    });

    const db = this.env.DB;

    if (!db) {
      return;
    }

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
          'projection_parity_mismatch',
          JSON.stringify({
            gameId,
            liveTurn: liveState.turnNumber,
            livePhase: liveState.phase,
            projectedTurn: projectedState?.turnNumber ?? null,
            projectedPhase: projectedState?.phase ?? null,
          }),
          'server',
          null,
        )
        .run()
        .catch((e: unknown) =>
          console.error('[D1 projection parity insert failed]', e),
        ),
    );
  };

  private async verifyProjectionParity(state: GameState): Promise<void> {
    const hasParity = await hasProjectionParity(
      this.ctx.storage,
      state.gameId,
      state,
    );

    if (!hasParity) {
      await this.reportProjectionParityMismatch(state.gameId, state);
    }
  }
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
    if (url.searchParams.get('viewer') === 'spectator') {
      return new Response('Spectator websocket joins are not supported', {
        status: 501,
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
      disconnectedPlayer,
      seatOpen,
    } = joinAttempt;
    const connectedSeatCountAfterJoin = this.getConnectedSeatCountAfterJoin(
      seatOpen,
      playerId,
    );

    if (issueNewToken) {
      roomConfig.playerTokens[playerId] = generatePlayerToken();
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
    const latestGameId = await this.getLatestGameId();
    const reconnectState = latestGameId
      ? await getProjectedCurrentState(this.ctx.storage, latestGameId, playerId)
      : null;

    if (reconnectState) {
      this.send(server, {
        type: 'gameStart',
        state: reconnectState,
      });
    }
    // Both players connected — start the game
    if (!reconnectState && connectedSeatCountAfterJoin >= 2) {
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

    if (!applySocketRateLimit(ws, Date.now(), this.msgRates)) {
      return;
    }

    const parsed = parseClientSocketMessage(message);

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
      if (this.isGameStateActionMessage(msg)) {
        await dispatchGameStateAction(
          playerId,
          ws,
          msg,
          this.gameStateActionHandlers,
          (targetWs, action, onSuccess) =>
            this.runGameStateAction(targetWs, action, onSuccess),
        );
        return;
      }
      await handleAuxMessage({
        ws,
        playerId,
        msg,
        lastChatAt: this.lastChatAt,
        send: (socket, outbound) => this.send(socket, outbound),
        broadcast: (outbound) => this.broadcast(outbound),
        handleRematch: (rematchPlayerId, socket) =>
          this.handleRematch(rematchPlayerId, socket),
      });
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
    const gameState = await this.getCurrentGameState();
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
        const gameState = await this.getCurrentGameState();

        if (!gameState || gameState.phase === 'gameOver') {
          await this.rescheduleAlarm();
          return;
        }
        gameState.phase = 'gameOver';
        gameState.winner = 1 - action.playerId;
        gameState.winReason = 'Opponent disconnected';
        await this.publishStateChange(gameState, undefined, {
          actor: null,
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
      case 'inactivityTimeout': {
        // Archive any unarchived match before cleanup
        if (this.env.MATCH_ARCHIVE) {
          const gameState = await this.getCurrentGameState();

          if (gameState) {
            const code = await this.getGameCode();
            this.ctx.waitUntil(
              archiveCompletedMatch(
                this.ctx.storage,
                this.env.MATCH_ARCHIVE,
                this.env.DB,
                gameState,
                code,
              ),
            );
          }
        }
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(1000, 'Inactivity timeout');
          } catch {}
        }
        await this.archiveRoomState();
        return;
      }
      case 'reschedule':
        await this.rescheduleAlarm();
        return;
    }
  }

  private async handleTurnTimeout(): Promise<void> {
    await this.ctx.storage.delete('turnTimeoutAt');
    const gameState = await this.getCurrentGameState();

    if (!gameState || gameState.phase === 'gameOver') {
      await this.rescheduleAlarm();
      return;
    }
    let outcome: ReturnType<typeof resolveTurnTimeoutOutcome>;
    try {
      const rng = await this.getActionRng();
      outcome = resolveTurnTimeoutOutcome(gameState, this.map, rng);
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
      actor: null,
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
      actor?: number | null;
      restartTurnTimer?: boolean;
      events?: EngineEvent[];
    },
  ) {
    const {
      actor = null,
      restartTurnTimer = true,
      events = [],
    } = options ?? {};
    const roomCode = await this.getGameCode();
    const replayMessage = resolveStateBearingMessage(state, primaryMessage);
    let eventSeq = await getEventStreamLength(this.ctx.storage, state.gameId);

    if (events.length > 0) {
      await appendEnvelopedEvents(
        this.ctx.storage,
        state.gameId,
        actor,
        ...events,
      );
      eventSeq = await getEventStreamLength(this.ctx.storage, state.gameId);
    }
    // Save checkpoint at turn boundaries and game end
    const hasTurnBoundary = events.some(
      (e) => e.type === 'turnAdvanced' || e.type === 'gameOver',
    );

    if (hasTurnBoundary) {
      await saveCheckpoint(this.ctx.storage, state.gameId, state, eventSeq);
    }
    await this.verifyProjectionParity(state);
    // Archive completed match to R2 for persistent analysis
    const hasGameOver = events.some((e) => e.type === 'gameOver');

    if (hasGameOver && this.env.MATCH_ARCHIVE) {
      this.ctx.waitUntil(
        archiveCompletedMatch(
          this.ctx.storage,
          this.env.MATCH_ARCHIVE,
          this.env.DB,
          state,
          roomCode,
        ),
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
    action: (
      gameState: GameState,
    ) => Success | EngineFailure | Promise<Success | EngineFailure>,
    onSuccess: (result: Success) => Promise<void> | void,
  ): Promise<void> {
    await runGameStateAction(
      {
        getCurrentGameState: () => this.getCurrentGameState(),
        getGameCode: () => this.getGameCode(),
        reportEngineError: (code, phase, turn, err) =>
          this.reportEngineError(code, phase, turn, err),
        sendError: (socket, message, code) =>
          this.send(socket, { type: 'error', message, code }),
      },
      ws,
      action,
      onSuccess,
    );
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
    const playerId = getReplayViewerId(
      roomConfig,
      url.searchParams.get('playerToken'),
      url.searchParams.get('viewer'),
    );

    if (playerId === null) {
      return new Response('Invalid player token', {
        status: 403,
      });
    }

    const gameId =
      url.searchParams.get('gameId') ?? (await this.getLatestGameId());

    if (!gameId) {
      return new Response('Replay not found', {
        status: 404,
      });
    }

    const timeline = await getProjectedReplayTimeline(
      this.ctx.storage,
      gameId,
      playerId,
    );

    if (!timeline) {
      return new Response('Replay not found', {
        status: 404,
      });
    }

    await this.touchInactivity();

    return Response.json(timeline);
  }

  private async initGame() {
    const [roomConfig, scenario] = await Promise.all([
      this.getRoomConfig(),
      this.getScenario(),
    ]);
    const map = this.map;
    const code = roomConfig?.code ?? (await this.getGameCode());
    const { gameId, matchSeed } = await allocateMatchIdentity(
      this.ctx.storage,
      code,
    );
    const gameState = createGame(scenario, map, gameId, findBaseHex);
    const gameStartMessage = toGameStartMessage(gameState);
    await this.clearRoomArchivedFlag();
    await saveMatchCreatedAt(this.ctx.storage, gameId, Date.now());
    const initEvents: EngineEvent[] = [
      {
        type: 'gameCreated' as const,
        scenario: gameState.scenario,
        turn: gameState.turnNumber,
        phase: gameState.phase,
        matchSeed,
      },
    ];

    // Capture fugitive designation for replay
    for (const ship of gameState.ships) {
      if (ship.identity?.hasFugitives) {
        initEvents.push({
          type: 'fugitiveDesignated' as const,
          shipId: ship.id,
          playerId: ship.owner,
        });
      }
    }

    await appendEnvelopedEvents(this.ctx.storage, gameId, null, ...initEvents);
    await this.verifyProjectionParity(gameState);
    this.broadcastFiltered(gameStartMessage);
    await this.startTurnTimer(gameState);
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

  // Broadcast a message containing game state,
  // filtering hidden information per player.
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

    const spectatorSockets = this.ctx.getWebSockets('spectator');

    if (spectatorSockets.length === 0) {
      return;
    }

    const spectatorData = JSON.stringify({
      ...msg,
      state: filterStateForPlayer(msg.state, 'spectator'),
    });

    for (const ws of spectatorSockets) {
      try {
        ws.send(spectatorData);
      } catch {}
    }
  }
}
