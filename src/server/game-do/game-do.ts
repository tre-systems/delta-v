import { DurableObject } from 'cloudflare:workers';
import type { LastTurnAutoPlayed } from '../../shared/agent/types';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import { filterStateForPlayer } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  isValidScenario,
  SCENARIOS,
} from '../../shared/map-data';
import { deriveActionRng, mulberry32 } from '../../shared/prng';
import type { GameState, PlayerId, Result } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import {
  isValidPlayerToken,
  type RoomConfig,
  resolveSeatAssignment,
} from '../protocol';
import {
  type ActionAcceptedMessage,
  type ActionRejectedMessage,
  IdempotencyKeyCache,
} from './action-guards';
import {
  type AuxMessage,
  createGameStateActionHandlers,
  dispatchGameStateAction,
  type EngineFailure,
  type GameStateActionMessage,
  isGameStateActionMessage,
  runGameStateAction,
} from './actions';
import { type GameDoAlarmDeps, runGameDoAlarm } from './alarm';
import {
  getEventStreamLength,
  getMatchSeed,
  getProjectedCurrentStateRaw,
} from './archive';
import { purgeMatchScopedStorage } from './archive-storage';
import {
  BOT_THINK_TIME_MS,
  buildBotAction,
  SERVER_AGENT_AI_DIFFICULTY,
} from './bot';
import {
  broadcastMessage,
  broadcastStateChange,
  sendSocketMessage,
} from './broadcast';
import { parseCoachMessage, setCoachDirective } from './coach';
import { isDurableObjectCodeUpdateError } from './code-update';
import { type GameDoFetchDeps, handleGameDoFetch } from './fetch';
import {
  handleInitRequest,
  handleJoinCheckRequest,
  handleReplayRequest,
  type JoinAttemptSuccess,
  resolveJoinAttempt as resolveJoinAttemptRequest,
} from './http-handlers';
import {
  getRequiredRematchVotes,
  handleRematchRequest,
  initGameSession,
} from './match';
import { handleMcpRequest, type McpRequestDeps } from './mcp-handlers';
import {
  appendHostedMcpSeatEvent,
  clearAllHostedMcpSessionState,
} from './mcp-session-state';
import type {
  PublishStateChangeOptions,
  StatefulServerMessage,
} from './message-builders';
import { type PublicationDeps, runPublicationPipeline } from './publication';
import {
  createDisconnectMarker,
  getNextAlarmAt,
  readAlarmDeadlines,
  readDisconnectedPlayer,
} from './session';
import { dispatchAuxMessage, parseClientSocketMessage } from './socket';
import { StateWaiters } from './state-waiters';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';
import {
  reportGameAbandoned,
  reportGameDoEngineError,
  reportGameDoProjectionParityMismatch,
  reportLifecycleEvent,
  reportSideChannelFailure,
  verifyGameDoProjectionParity,
} from './telemetry';
import {
  type GameDoWebSocketCloseDeps,
  type GameDoWebSocketMessageDeps,
  handleGameDoWebSocketClose,
  handleGameDoWebSocketMessage,
} from './ws';
export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  LIVE_REGISTRY?: DurableObjectNamespace;
  DB: D1Database;
  MATCH_ARCHIVE?: R2Bucket;
}

export class GameDO extends DurableObject<Env> {
  private gameCodeCache: string | null = null;
  private currentStateCache: {
    gameId: import('../../shared/ids').GameId;
    state: GameState;
  } | null = null;
  private readonly map = buildSolarSystemMap();
  private readonly replacedSockets = new WeakSet<WebSocket>();
  // Per-match idempotency ring, cleared on phase advance so each phase has a
  // fresh scope. Ephemeral — safe to lose on DO re-activation (the agent will
  // retry and the server will accept).
  private readonly idempotencyCache = new IdempotencyKeyCache();
  // In-memory pending /mcp/wait + /mcp/action waiters, keyed by seat. Cleared
  // on DO eviction; HTTP clients retry, same recovery as WebSocket reconnect.
  private readonly stateWaiters = new StateWaiters();
  /** One-shot MCP observation hint per seat after a turn timer auto-advance. */
  private readonly lastTurnAutoPlayNoticeBySeat: [
    LastTurnAutoPlayed | null,
    LastTurnAutoPlayed | null,
  ] = [null, null];
  private readonly msgRates = new WeakMap<
    WebSocket,
    { count: number; windowStart: number }
  >();
  private readonly lastChatAt = new Map<number, number>();
  private readonly gameStateActionHandlers = createGameStateActionHandlers({
    map: this.map,
    getScenario: () => this.getScenario().then((s) => s.def),
    getActionRng: () => this.getActionRng(),
    publishStateChange: (state, primaryMessage, options) =>
      this.publishStateChange(state, primaryMessage, options),
  });

  private get storage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  private waitUntil(promise: Promise<unknown>): void {
    if (typeof this.ctx.waitUntil === 'function') {
      this.ctx.waitUntil(promise);
      return;
    }
    void promise.catch(() => undefined);
  }

  private getWebSockets(tag?: string): WebSocket[] {
    return this.ctx.getWebSockets(tag);
  }

  private getTags(socket: WebSocket): string[] {
    return this.ctx.getTags(socket);
  }

  private acceptWebSocket(server: WebSocket, tags: string[]): void {
    this.ctx.acceptWebSocket(server, tags);
  }

  // --- WebSocket tag-based player tracking ---
  private getPlayerId(ws: WebSocket): PlayerId | null {
    const tag = this.getTags(ws).find((t) => t.startsWith('player:'));
    const id = tag ? parseInt(tag.split(':')[1], 10) : null;
    return id === 0 || id === 1 ? id : null;
  }

  private getSeatOpen(): [boolean, boolean] {
    return [
      this.getWebSockets('player:0').length === 0,
      this.getWebSockets('player:1').length === 0,
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
    for (const old of this.getWebSockets(`player:${playerId}`)) {
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
      this.currentStateCache = null;
      return null;
    }

    if (this.currentStateCache?.gameId === gameId) {
      return structuredClone(this.currentStateCache.state);
    }

    const projected = await getProjectedCurrentStateRaw(this.storage, gameId);

    if (projected) {
      this.currentStateCache = {
        gameId,
        state: structuredClone(projected),
      };
    } else {
      this.currentStateCache = null;
    }

    return projected;
  }

  private async getRoomConfig(): Promise<RoomConfig | null> {
    return (
      (await this.storage.get<RoomConfig>(GAME_DO_STORAGE_KEYS.roomConfig)) ??
      null
    );
  }

  private async isAgentSeat(playerId: 0 | 1): Promise<boolean> {
    const roomConfig = await this.getRoomConfig();
    return roomConfig?.players?.[playerId]?.kind === 'agent';
  }

  private async shouldTrackDisconnectForPlayer(
    playerId: PlayerId,
  ): Promise<boolean> {
    const opponentId = playerId === 0 ? 1 : 0;
    return !(await this.isAgentSeat(opponentId as 0 | 1));
  }

  private async saveRoomConfig(config: RoomConfig): Promise<void> {
    await this.storage.put(GAME_DO_STORAGE_KEYS.roomConfig, config);
  }

  private async getGameCode(): Promise<string> {
    const code =
      (await this.storage.get<string>(GAME_DO_STORAGE_KEYS.gameCode)) ?? '';
    this.gameCodeCache = code.length > 0 ? code : null;
    return code;
  }

  private async getScenario() {
    const scenarioName =
      (await this.getRoomConfig())?.scenario ?? 'biplanetary';
    const key = isValidScenario(scenarioName) ? scenarioName : 'biplanetary';
    return { def: SCENARIOS[key], key };
  }

  private async setGameCode(code: string): Promise<void> {
    await this.storage.put(GAME_DO_STORAGE_KEYS.gameCode, code);
    this.gameCodeCache = code;
  }

  private reportCodeUpdateEviction(
    entrypoint: 'webSocketMessage' | 'webSocketClose' | 'alarm',
    props?: {
      playerId?: PlayerId | null;
      actionType?: string | null;
    },
    error?: unknown,
  ): void {
    const cachedState = this.currentStateCache?.state ?? null;
    const cachedCode =
      this.gameCodeCache ??
      (this.currentStateCache?.gameId
        ? String(this.currentStateCache.gameId).replace(/-m\d+$/, '')
        : null);
    reportSideChannelFailure(
      { db: this.env.DB, waitUntil: (promise) => this.waitUntil(promise) },
      'game_do_code_update_evicted',
      {
        entrypoint,
        code: cachedCode,
        gameId: this.currentStateCache?.gameId ?? null,
        turn: cachedState?.turnNumber ?? null,
        phase: cachedState?.phase ?? null,
        playerId: props?.playerId ?? null,
        actionType: props?.actionType ?? null,
        message: error instanceof Error ? error.message : String(error),
      },
    );
  }

  private async touchInactivity(): Promise<void> {
    await this.storage.put(
      GAME_DO_STORAGE_KEYS.inactivityAt,
      Date.now() + INACTIVITY_TIMEOUT_MS,
    );
    await this.rescheduleAlarm();
  }

  private async getAlarmDeadlines() {
    return readAlarmDeadlines(this.storage);
  }

  private async isRoomArchived(): Promise<boolean> {
    return (
      (await this.storage.get<boolean>(GAME_DO_STORAGE_KEYS.roomArchived)) ===
      true
    );
  }

  private async archiveRoomState(): Promise<void> {
    const code = await this.getGameCode();
    const latestGameId = await this.getLatestGameId();
    this.currentStateCache = null;
    await Promise.all([
      this.storage.put(GAME_DO_STORAGE_KEYS.roomArchived, true),
      this.storage.delete(GAME_DO_STORAGE_KEYS.botTurnAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.storage.delete(GAME_DO_STORAGE_KEYS.inactivityAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.rematchRequests),
      this.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt),
      // Clear any live coach directives so the next match in this room
      // starts fresh. matchCoached is intentionally NOT cleared — future
      // leaderboard code uses it to tag the archived match.
      this.storage.delete(GAME_DO_STORAGE_KEYS.coachDirectiveSeat0),
      this.storage.delete(GAME_DO_STORAGE_KEYS.coachDirectiveSeat1),
      clearAllHostedMcpSessionState(this.storage),
    ]);
    // Drop per-match residue (event chunks, seq cursor, matchSeed,
    // matchCreatedAt, checkpoint). An abandoned room previously kept
    // these forever — ~1–2 KB per DO, unbounded across rooms that never
    // reach gameOver. Completed matches have already been mirrored to
    // R2 + D1 by scheduleArchiveCompletedMatch, so purging DO storage
    // here doesn't strip data from anywhere else.
    if (latestGameId) {
      await Promise.all([
        purgeMatchScopedStorage(this.storage, latestGameId),
        this.storage.delete(`checkpoint:${latestGameId}`),
      ]);
    }
    // Ensure the match is removed from the live-match registry. This
    // fires as a safety net on inactivity timeout; the primary deregister
    // fires earlier in publishStateChange on gameOver.
    this.deregisterLiveMatch(code);
  }

  private async clearRoomArchivedFlag(): Promise<void> {
    await this.storage.delete(GAME_DO_STORAGE_KEYS.roomArchived);
  }

  private async getLatestGameId(): Promise<
    import('../../shared/ids').GameId | null
  > {
    const [code, matchNumber] = await Promise.all([
      this.getGameCode(),
      this.storage.get<number>(GAME_DO_STORAGE_KEYS.matchNumber),
    ]);

    if (!code || matchNumber === undefined) {
      return null;
    }

    return `${code}-m${matchNumber}` as import('../../shared/ids').GameId;
  }

  private async getActionRng(): Promise<() => number> {
    const gameId = await this.getLatestGameId();

    if (!gameId) {
      // Pre-init action: no match identity has been allocated yet.
      // Use a fixed-seed PRNG so any stray path stays replayable in CI;
      // this should not happen on any action path that runs after initGame.
      console.warn(
        '[getActionRng] fallback to deterministic PRNG — no latest gameId',
      );
      return mulberry32(0x7e1110cf);
    }

    const [seed, seq] = await Promise.all([
      getMatchSeed(this.storage, gameId),
      getEventStreamLength(this.storage, gameId),
    ]);

    if (seed === null) {
      // allocateMatchIdentity has fired (gameId exists) but matchSeed is
      // missing. This is the specific breach the backlog flagged — a
      // legitimate match should always have its seed. Warn loudly so
      // production deploys catch the regression.
      console.warn(
        `[getActionRng] fallback to deterministic PRNG — matchSeed missing for ${gameId}`,
      );
      return mulberry32(0x7eed10cf);
    }

    return deriveActionRng(seed, seq);
  }

  private async clearDisconnectMarker(): Promise<void> {
    // Signal the resolved transition only when a marker actually existed;
    // clearing a non-existent marker is a no-op and shouldn't pollute logs.
    const hadMarker = await readDisconnectedPlayer(this.storage);
    await Promise.all([
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
    ]);
    if (hadMarker !== null) {
      const code = await this.getGameCode();
      reportLifecycleEvent(
        { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
        'disconnect_grace_resolved',
        { code, player: hadMarker },
      );
    }
  }

  private async clearBotTurnMarker(): Promise<void> {
    await this.storage.delete(GAME_DO_STORAGE_KEYS.botTurnAt);
  }

  private async scheduleBotTurnIfNeeded(state: GameState): Promise<void> {
    if (
      state.phase === 'gameOver' ||
      !(await this.isAgentSeat(state.activePlayer as 0 | 1))
    ) {
      await this.clearBotTurnMarker();
      await this.rescheduleAlarm();
      return;
    }

    await this.storage.put(
      GAME_DO_STORAGE_KEYS.botTurnAt,
      Date.now() + BOT_THINK_TIME_MS,
    );
    await this.rescheduleAlarm();
  }

  private async setDisconnectMarker(playerId: PlayerId): Promise<void> {
    const marker = createDisconnectMarker(playerId, Date.now());
    await Promise.all([
      this.storage.put(
        GAME_DO_STORAGE_KEYS.disconnectedPlayer,
        marker.disconnectedPlayer,
      ),
      this.storage.put(
        GAME_DO_STORAGE_KEYS.disconnectTime,
        marker.disconnectTime,
      ),
      this.storage.put(GAME_DO_STORAGE_KEYS.disconnectAt, marker.disconnectAt),
    ]);
    await this.rescheduleAlarm();
    const code = await this.getGameCode();
    reportLifecycleEvent(
      { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
      'disconnect_grace_started',
      { code, player: playerId, disconnectAt: marker.disconnectAt },
    );
  }

  private async resolveJoinAttempt(
    presentedTokenRaw: string | null,
  ): Promise<Result<JoinAttemptSuccess, Response>> {
    return resolveJoinAttemptRequest(
      {
        getRoomConfig: () => this.getRoomConfig(),
        isRoomArchived: () => this.isRoomArchived(),
        getDisconnectedPlayer: async () => readDisconnectedPlayer(this.storage),
        getSeatOpen: () => this.getSeatOpen(),
        isValidPlayerToken,
        resolveSeatAssignment,
      },
      presentedTokenRaw,
    );
  }

  private async rescheduleAlarm(): Promise<void> {
    const alarmAt = getNextAlarmAt(await this.getAlarmDeadlines());

    if (alarmAt !== null) {
      await this.storage.setAlarm(alarmAt);
    }
  }

  // --- Error telemetry (see telemetry.ts) ---
  private reportEngineError = (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ): void => {
    reportGameDoEngineError(
      { db: this.env.DB, waitUntil: (promise) => this.waitUntil(promise) },
      code,
      phase,
      turn,
      err,
    );
  };

  private reportGameAbandoned = (props: {
    gameId: string;
    turn: number;
    phase: string;
    reason: string;
    scenario: string;
  }): void => {
    reportGameAbandoned(
      { db: this.env.DB, waitUntil: (promise) => this.waitUntil(promise) },
      props,
    );
  };

  private reportProjectionParityMismatch = async (
    gameId: import('../../shared/ids').GameId,
    liveState: GameState,
  ): Promise<void> => {
    await reportGameDoProjectionParityMismatch({
      storage: this.storage,
      db: this.env.DB,
      waitUntil: (promise) => this.waitUntil(promise),
      gameId,
      liveState,
    });
  };

  private async verifyProjectionParity(state: GameState): Promise<void> {
    await verifyGameDoProjectionParity(
      this.storage,
      state,
      (gameId, liveState) =>
        this.reportProjectionParityMismatch(gameId, liveState),
    );
  }

  private createFetchDeps(): GameDoFetchDeps {
    return {
      handleInit: (request) => this.handleInit(request),
      handleJoinCheck: (request) => this.handleJoinCheck(request),
      handleReplayRequest: (request) => this.handleReplayRequest(request),
      handleMcpRequest: (request) => this.handleMcpRequest(request),
      resolveJoinAttempt: (token) => this.resolveJoinAttempt(token),
      getConnectedSeatCountAfterJoin: (seatOpen, playerId) =>
        this.getConnectedSeatCountAfterJoin(seatOpen, playerId),
      isAgentSeat: (playerId) => this.isAgentSeat(playerId),
      saveRoomConfig: (roomConfig) => this.saveRoomConfig(roomConfig),
      clearDisconnectMarker: () => this.clearDisconnectMarker(),
      replacePlayerSockets: (playerId) => this.replacePlayerSockets(playerId),
      send: (ws, msg) => this.send(ws, msg),
      broadcast: (msg) => this.broadcast(msg),
      getLatestGameId: () => this.getLatestGameId(),
      storage: this.storage,
      initGame: () => this.initGame(),
      touchInactivity: () => this.touchInactivity(),
      acceptWebSocket: (server, tags) => this.acceptWebSocket(server, tags),
      getRoomConfig: () => this.getRoomConfig(),
    };
  }

  private createAlarmDeps(): GameDoAlarmDeps {
    return {
      now: Date.now(),
      storage: this.storage,
      env: this.env,
      waitUntil: (promise) => this.waitUntil(promise),
      getWebSockets: () => this.getWebSockets(),
      map: this.map,
      getCurrentGameState: () => this.getCurrentGameState(),
      getGameCode: () => this.getGameCode(),
      getActionRng: () => this.getActionRng(),
      runBotTurn: () => this.runBotTurn(),
      clearDisconnectMarker: () => this.clearDisconnectMarker(),
      rescheduleAlarm: () => this.rescheduleAlarm(),
      publishStateChange: (state, primaryMessage, options) =>
        this.publishStateChange(state, primaryMessage, options),
      reportEngineError: (code, phase, turn, err) =>
        this.reportEngineError(code, phase, turn, err),
      reportGameAbandoned: (props) => this.reportGameAbandoned(props),
      reportLifecycle: (event, props) =>
        reportLifecycleEvent(
          { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
          event,
          props,
        ),
      archiveRoomState: () => this.archiveRoomState(),
    };
  }

  private createPublicationDeps(): PublicationDeps {
    return {
      storage: this.storage,
      env: this.env,
      waitUntil: (promise) => this.waitUntil(promise),
      getGameCode: () => this.getGameCode(),
      getRoomConfig: () => this.getRoomConfig(),
      verifyProjectionParity: (state) => this.verifyProjectionParity(state),
      broadcastStateChange: (state, primaryMessage) =>
        this.broadcastStateChange(state, primaryMessage),
      startTurnTimer: (state) => this.startTurnTimer(state),
    };
  }

  private createGameStateActionDeps(
    ws: WebSocket,
  ): Parameters<typeof runGameStateAction>[0] {
    return {
      getCurrentGameState: () => this.getCurrentGameState(),
      getGameCode: () => this.getGameCode(),
      reportEngineError: (code, phase, turn, err) =>
        this.reportEngineError(code, phase, turn, err),
      sendError: (message, code) =>
        this.send(ws, { type: 'error', message, code }),
      sendActionAccepted: (accepted) => this.send(ws, accepted),
      sendActionRejected: (rejected) => this.send(ws, rejected),
    };
  }

  private createInitRequestDeps(): Parameters<typeof handleInitRequest>[0] {
    return {
      getRoomConfig: () => this.getRoomConfig(),
      saveRoomConfig: (roomConfig) => this.saveRoomConfig(roomConfig),
      setGameCode: (code) => this.setGameCode(code),
      touchInactivity: () => this.touchInactivity(),
    };
  }

  private createJoinCheckDeps(): Parameters<typeof handleJoinCheckRequest>[0] {
    return {
      resolveJoinAttempt: (playerToken) => this.resolveJoinAttempt(playerToken),
    };
  }

  private createReplayRequestDeps(): Parameters<typeof handleReplayRequest>[0] {
    return {
      storage: this.storage,
      getRoomConfig: () => this.getRoomConfig(),
      getLatestGameId: () => this.getLatestGameId(),
      touchInactivity: () => this.touchInactivity(),
    };
  }

  private createInitGameDeps(): Parameters<typeof initGameSession>[0] {
    return {
      storage: this.storage,
      map: this.map,
      getRoomConfig: () => this.getRoomConfig(),
      getScenario: () => this.getScenario(),
      getGameCode: () => this.getGameCode(),
      clearRoomArchivedFlag: () => this.clearRoomArchivedFlag(),
      publishStateChange: (state, primaryMessage, options) =>
        this.publishStateChange(state, primaryMessage, options),
    };
  }

  private createRematchDeps(): Parameters<typeof handleRematchRequest>[0] {
    return {
      storage: this.storage,
      initGame: () => this.initGame(),
      broadcast: (msg) => this.broadcast(msg),
      getRequiredVotes: async () =>
        getRequiredRematchVotes(await this.getRoomConfig()),
    };
  }

  private isSpectatorSocket(socket: WebSocket): boolean {
    return this.getTags(socket).includes('spectator');
  }

  private async dispatchSocketGameStateAction(
    playerId: PlayerId,
    socket: WebSocket,
    msg: GameStateActionMessage,
  ): Promise<void> {
    await dispatchGameStateAction(
      playerId,
      msg,
      this.gameStateActionHandlers,
      (action, onSuccess, preCheck) =>
        this.runGameStateAction(socket, action, onSuccess, preCheck),
      this.idempotencyCache,
    );
  }

  private async dispatchSocketAuxMessage(
    socket: WebSocket,
    playerId: PlayerId,
    msg: AuxMessage,
  ): Promise<void> {
    await dispatchAuxMessage({
      ws: socket,
      playerId,
      msg,
      lastChatAt: this.lastChatAt,
      send: (targetWs, outbound) => this.send(targetWs, outbound),
      broadcast: (outbound) => this.broadcast(outbound),
      handleRematch: (rematchPlayerId, targetWs) =>
        this.handleRematch(rematchPlayerId, targetWs),
      handleCoach: (senderId, rawText) =>
        this.maybeStoreCoachDirective(senderId, rawText),
    });
  }

  // Coach-directive intercept for the chat handler. Returns true when the
  // message was consumed as a /coach whisper (caller must not broadcast).
  private async maybeStoreCoachDirective(
    senderId: PlayerId,
    rawText: string,
  ): Promise<boolean> {
    const parsed = parseCoachMessage(rawText);
    if (!parsed) return false;
    const state = await this.getCurrentGameState();
    const turnReceived = state?.turnNumber ?? 0;
    const targetSeat: PlayerId = senderId === 0 ? 1 : 0;
    await setCoachDirective(this.storage, targetSeat, {
      text: parsed.text,
      turnReceived,
      acknowledged: false,
    });
    return true;
  }

  // --- WebSocket lifecycle ---
  async fetch(request: Request): Promise<Response> {
    return handleGameDoFetch(this.createFetchDeps(), request);
  }

  private createWebSocketMessageDeps(): GameDoWebSocketMessageDeps {
    return {
      msgRates: this.msgRates,
      getPlayerId: (socket) => this.getPlayerId(socket),
      isSpectatorSocket: (socket) => this.isSpectatorSocket(socket),
      touchInactivity: () => this.touchInactivity(),
      send: (socket, outbound) => this.send(socket, outbound),
      isGameStateActionMessage,
      dispatchGameStateAction: (playerId, socket, msg) =>
        this.dispatchSocketGameStateAction(playerId, socket, msg),
      dispatchAuxMessage: (socket, playerId, msg) =>
        this.dispatchSocketAuxMessage(socket, playerId, msg),
    };
  }

  private createWebSocketCloseDeps(): GameDoWebSocketCloseDeps {
    return {
      consumeReplacedSocket: (socket) => this.replacedSockets.delete(socket),
      getPlayerId: (socket) => this.getPlayerId(socket),
      getCurrentGameState: () => this.getCurrentGameState(),
      shouldTrackDisconnectForPlayer: (playerId) =>
        this.shouldTrackDisconnectForPlayer(playerId),
      setDisconnectMarker: (playerId) => this.setDisconnectMarker(playerId),
      broadcast: (msg) => this.broadcast(msg),
    };
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    try {
      return await handleGameDoWebSocketMessage(
        this.createWebSocketMessageDeps(),
        ws,
        message,
      );
    } catch (error) {
      if (isDurableObjectCodeUpdateError(error)) {
        const parsedActionType =
          typeof message === 'string'
            ? (() => {
                const parsed = parseClientSocketMessage(message);
                return parsed.ok ? parsed.value.type : null;
              })()
            : null;
        this.reportCodeUpdateEviction(
          'webSocketMessage',
          {
            playerId: this.getPlayerId(ws),
            actionType: parsedActionType,
          },
          error,
        );
        return;
      }
      throw error;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      return await handleGameDoWebSocketClose(
        this.createWebSocketCloseDeps(),
        ws,
      );
    } catch (error) {
      if (isDurableObjectCodeUpdateError(error)) {
        this.reportCodeUpdateEviction(
          'webSocketClose',
          { playerId: this.getPlayerId(ws) },
          error,
        );
        return;
      }
      throw error;
    }
  }

  async alarm(): Promise<void> {
    try {
      await runGameDoAlarm(this.createAlarmDeps());
    } catch (error) {
      if (isDurableObjectCodeUpdateError(error)) {
        this.reportCodeUpdateEviction('alarm', undefined, error);
        return;
      }
      throw error;
    }
  }

  private async startTurnTimer(state: GameState): Promise<void> {
    if (state.phase === 'gameOver') {
      await this.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt);
      await this.rescheduleAlarm();
      return;
    }
    const timeoutAt = Date.now() + TURN_TIMEOUT_MS;
    await this.storage.put(GAME_DO_STORAGE_KEYS.turnTimeoutAt, timeoutAt);
    await this.rescheduleAlarm();
  }

  private consumeLastTurnAutoPlayNotice(
    playerId: PlayerId,
  ): LastTurnAutoPlayed | null {
    const current = this.lastTurnAutoPlayNoticeBySeat[playerId];
    this.lastTurnAutoPlayNoticeBySeat[playerId] = null;
    return current;
  }

  private async publishStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: PublishStateChangeOptions,
  ) {
    const notice = options?.lastTurnAutoPlayed;
    if (notice) {
      this.lastTurnAutoPlayNoticeBySeat[notice.seat] = {
        index: notice.index,
        reason: notice.reason,
      };
    }
    // Each accepted action advances the state; agent idempotency keys are
    // scoped per action, so clear the cache here rather than tracking phase
    // transitions. Re-submits after this point target a newer state anyway.
    this.idempotencyCache.clear();
    const { lastTurnAutoPlayed: _drop, ...publicationOpts } = options ?? {};
    await runPublicationPipeline(
      this.createPublicationDeps(),
      state,
      primaryMessage,
      publicationOpts,
    );
    this.currentStateCache = {
      gameId: state.gameId,
      state: structuredClone(state),
    };
    // Wake every HTTP /mcp/wait or /mcp/action long-poller — mirror of the
    // WebSocket broadcast. Either seat may be waiting (simultaneous phases,
    // observation polling, gameOver close-out), so wake unconditionally.
    this.stateWaiters.wakeAllSeats();
    await this.scheduleBotTurnIfNeeded(state);

    // Remove from the live-match registry as soon as the game ends so
    // the /matches "Live now" section updates on the next poll.
    if (state.phase === 'gameOver') {
      const code = await this.getGameCode();
      this.deregisterLiveMatch(code);
      reportLifecycleEvent(
        { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
        'game_ended',
        {
          gameId: state.gameId,
          code,
          turn: state.turnNumber,
          winner: state.outcome?.winner ?? null,
          reason: state.outcome?.reason ?? null,
        },
      );
    }
  }

  private async runBotTurn(): Promise<void> {
    await this.clearBotTurnMarker();
    const gameState = await this.getCurrentGameState();

    if (!gameState || gameState.phase === 'gameOver') {
      await this.rescheduleAlarm();
      return;
    }

    const playerId = gameState.activePlayer;

    if (!(await this.isAgentSeat(playerId as 0 | 1))) {
      await this.rescheduleAlarm();
      return;
    }

    const rng = await this.getActionRng();
    const action = buildBotAction(
      gameState,
      playerId,
      this.map,
      SERVER_AGENT_AI_DIFFICULTY,
      rng,
    );

    if (!action) {
      await this.rescheduleAlarm();
      return;
    }

    const handler = this.gameStateActionHandlers[action.type];

    try {
      const result = await handler.run(gameState, playerId, action as never);

      if ('error' in result) {
        const code = await this.getGameCode();
        this.reportEngineError(
          code,
          gameState.phase,
          gameState.turnNumber,
          result.error,
        );
        await this.rescheduleAlarm();
        return;
      }

      await handler.publish(playerId, result as never);
    } catch (err) {
      const code = await this.getGameCode();
      this.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
      await this.rescheduleAlarm();
    }
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
    preCheck?: (gameState: GameState) => {
      accepted: ActionAcceptedMessage;
      rejected: ActionRejectedMessage | null;
    },
  ): Promise<void> {
    await runGameStateAction(
      this.createGameStateActionDeps(ws),
      action,
      onSuccess,
      preCheck,
    );
  }

  // --- Game logic (delegates to engine) ---
  private async handleInit(request: Request): Promise<Response> {
    return handleInitRequest(this.createInitRequestDeps(), request);
  }

  private async handleJoinCheck(request: Request): Promise<Response> {
    return handleJoinCheckRequest(this.createJoinCheckDeps(), request);
  }

  private async handleReplayRequest(request: Request): Promise<Response> {
    return handleReplayRequest(this.createReplayRequestDeps(), request);
  }

  private createMcpRequestDeps(): McpRequestDeps {
    return {
      getRoomConfig: () => this.getRoomConfig(),
      getCurrentGameState: () => this.getCurrentGameState(),
      getGameCode: () => this.getGameCode(),
      reportEngineError: (code, phase, turn, err) =>
        this.reportEngineError(code, phase, turn, err),
      reportObservationTimeout: (props) =>
        reportSideChannelFailure(
          { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
          'mcp_observation_timeout',
          props,
        ),
      handlers: this.gameStateActionHandlers,
      idempotencyCache: this.idempotencyCache,
      stateWaiters: this.stateWaiters,
      broadcast: (msg) => this.broadcast(msg),
      touchInactivity: () => this.touchInactivity(),
      storage: this.storage,
      initGameIfReady: () => this.maybeInitGameForMcp(),
      consumeLastTurnAutoPlayNotice: (playerId) =>
        this.consumeLastTurnAutoPlayNotice(playerId),
    };
  }

  // MCP-only clients never establish a WebSocket, so the WS-upgrade path's
  // "start when both seats connected" trigger never fires. When both player
  // tokens are filled (host + guest, or both quick-match seats) and we
  // haven't started a game yet, this kicks off initGame() so the very first
  // MCP request to /mcp/* lands on a live game state. Cheap to call on every
  // request — it short-circuits once state exists.
  private async maybeInitGameForMcp(): Promise<void> {
    const existingState = await this.getCurrentGameState();
    if (existingState) return;
    const roomConfig = await this.getRoomConfig();
    if (!roomConfig) return;
    const tokensFilled =
      roomConfig.playerTokens[0] !== null &&
      roomConfig.playerTokens[1] !== null;
    if (!tokensFilled) return;
    if (await this.isRoomArchived()) return;
    await this.initGame();
  }

  private async handleMcpRequest(request: Request): Promise<Response | null> {
    return handleMcpRequest(this.createMcpRequestDeps(), request);
  }

  // Fire-and-forget notification to the LIVE_REGISTRY singleton DO.
  // Never blocks game flow. Failures are reported through
  // `reportSideChannelFailure` so operators can see when matches stop
  // registering / deregistering rather than silently disappearing from
  // /matches.
  private registerLiveMatch(
    code: string,
    scenario: string,
    playerKeys: string[],
  ): void {
    const reg = this.env.LIVE_REGISTRY;
    if (!reg) return;
    const deps = {
      db: this.env.DB,
      waitUntil: (p: Promise<unknown>) => this.waitUntil(p),
    };
    this.waitUntil(
      reg
        .get(reg.idFromName('global'))
        .fetch(
          new Request('https://live-registry.internal/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              scenario,
              startedAt: Date.now(),
              playerKeys,
            }),
          }),
        )
        .then((res) => {
          if (!res.ok) {
            reportSideChannelFailure(deps, 'live_registry_register_failed', {
              code,
              scenario,
              status: res.status,
            });
          }
        })
        .catch((err) => {
          reportSideChannelFailure(deps, 'live_registry_register_failed', {
            code,
            scenario,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
    );
  }

  private deregisterLiveMatch(code: string): void {
    const reg = this.env.LIVE_REGISTRY;
    if (!reg) return;
    const deps = {
      db: this.env.DB,
      waitUntil: (p: Promise<unknown>) => this.waitUntil(p),
    };
    this.waitUntil(
      reg
        .get(reg.idFromName('global'))
        .fetch(
          new Request(`https://live-registry.internal/deregister/${code}`, {
            method: 'DELETE',
          }),
        )
        .then((res) => {
          if (!res.ok && res.status !== 404) {
            reportSideChannelFailure(deps, 'live_registry_deregister_failed', {
              code,
              status: res.status,
            });
          }
        })
        .catch((err) => {
          reportSideChannelFailure(deps, 'live_registry_deregister_failed', {
            code,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
    );
  }

  private async initGame() {
    this.currentStateCache = null;
    await clearAllHostedMcpSessionState(this.storage);
    await initGameSession(this.createInitGameDeps());
    // Register the new match in the LIVE_REGISTRY for the /matches page.
    const roomConfig = await this.getRoomConfig();
    const code = await this.getGameCode();
    const scenario = roomConfig?.scenario ?? 'duel';
    const playerKeys = (roomConfig?.players ?? [])
      .flatMap((player) => (player ? [player.playerKey] : []))
      .filter((playerKey) => typeof playerKey === 'string');
    this.registerLiveMatch(code, scenario, playerKeys);
    const gameId = await this.getLatestGameId();
    reportLifecycleEvent(
      { db: this.env.DB, waitUntil: (p) => this.waitUntil(p) },
      'game_started',
      { gameId, code, scenario },
    );
  }

  private async handleRematch(playerId: PlayerId, _ws: WebSocket) {
    await handleRematchRequest(this.createRematchDeps(), playerId);
  }

  private broadcastStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
  ) {
    broadcastStateChange(this.ctx, state, primaryMessage);
    const primary = primaryMessage ?? { type: 'stateUpdate', state };
    for (const playerId of [0, 1] as const) {
      const filtered = {
        ...primary,
        state: filterStateForPlayer(state, playerId),
      } as S2C;
      this.waitUntil(
        appendHostedMcpSeatEvent(this.storage, playerId, filtered),
      );
    }
    if (state.phase === 'gameOver') {
      const gameOver: S2C = {
        type: 'gameOver',
        winner: state.outcome?.winner ?? 0,
        reason: state.outcome?.reason ?? 'Game over',
      };
      for (const playerId of [0, 1] as const) {
        this.waitUntil(
          appendHostedMcpSeatEvent(this.storage, playerId, gameOver),
        );
      }
    }
  }

  // --- Messaging ---
  private send(ws: WebSocket, msg: S2C) {
    sendSocketMessage(ws, msg);
  }

  private broadcast(msg: S2C) {
    broadcastMessage(this.ctx, msg);
    for (const playerId of [0, 1] as const) {
      this.waitUntil(appendHostedMcpSeatEvent(this.storage, playerId, msg));
    }
  }
}
