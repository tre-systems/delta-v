import { DurableObject } from 'cloudflare:workers';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import type { EngineEvent } from '../../shared/engine/engine-events';
import { buildSolarSystemMap, SCENARIOS } from '../../shared/map-data';
import { deriveActionRng } from '../../shared/prng';
import type { GameState, PlayerId, Result } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import {
  isValidPlayerToken,
  type RoomConfig,
  resolveSeatAssignment,
} from '../protocol';
import {
  createGameStateActionHandlers,
  dispatchGameStateAction,
  type EngineFailure,
  isGameStateActionMessage,
  runGameStateAction,
} from './actions';
import { runGameDoAlarm } from './alarm';
import {
  getEventStreamLength,
  getMatchSeed,
  getProjectedCurrentStateRaw,
} from './archive';
import {
  broadcastFilteredMessage,
  broadcastMessage,
  broadcastStateChange,
  sendSocketMessage,
} from './broadcast';
import { handleGameDoFetch } from './fetch';
import {
  handleInitRequest,
  handleJoinCheckRequest,
  handleReplayRequest,
  type JoinAttemptSuccess,
  resolveJoinAttempt as resolveJoinAttemptRequest,
} from './http-handlers';
import { handleRematchRequest, initGameSession } from './match';
import type { StatefulServerMessage } from './message-builders';
import { runPublicationPipeline } from './publication';
import {
  createDisconnectMarker,
  getNextAlarmAt,
  readAlarmDeadlines,
  readDisconnectedPlayer,
} from './session';
import { type AuxMessageDeps, handleAuxMessage } from './socket';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';
import {
  reportGameDoEngineError,
  reportGameDoProjectionParityMismatch,
  verifyGameDoProjectionParity,
} from './telemetry';
import { handleGameDoWebSocketClose, handleGameDoWebSocketMessage } from './ws';
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
  private getPlayerId(ws: WebSocket): PlayerId | null {
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith('player:'));
    const id = tag ? parseInt(tag.split(':')[1], 10) : null;
    return id === 0 || id === 1 ? id : null;
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
    return (
      (await this.ctx.storage.get<RoomConfig>(
        GAME_DO_STORAGE_KEYS.roomConfig,
      )) ?? null
    );
  }

  private async saveRoomConfig(config: RoomConfig): Promise<void> {
    await this.ctx.storage.put(GAME_DO_STORAGE_KEYS.roomConfig, config);
  }

  private async getGameCode(): Promise<string> {
    return (
      (await this.ctx.storage.get<string>(GAME_DO_STORAGE_KEYS.gameCode)) ?? ''
    );
  }

  private async getScenario() {
    const scenarioName =
      (await this.getRoomConfig())?.scenario ?? 'biplanetary';
    return SCENARIOS[scenarioName] ?? SCENARIOS.biplanetary;
  }

  private async setGameCode(code: string): Promise<void> {
    await this.ctx.storage.put(GAME_DO_STORAGE_KEYS.gameCode, code);
  }

  private async touchInactivity(): Promise<void> {
    await this.ctx.storage.put(
      GAME_DO_STORAGE_KEYS.inactivityAt,
      Date.now() + INACTIVITY_TIMEOUT_MS,
    );
    await this.rescheduleAlarm();
  }

  private async getAlarmDeadlines() {
    return readAlarmDeadlines(this.ctx.storage);
  }

  private async isRoomArchived(): Promise<boolean> {
    return (
      (await this.ctx.storage.get<boolean>(
        GAME_DO_STORAGE_KEYS.roomArchived,
      )) === true
    );
  }

  private async archiveRoomState(): Promise<void> {
    await Promise.all([
      this.ctx.storage.put(GAME_DO_STORAGE_KEYS.roomArchived, true),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.inactivityAt),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.rematchRequests),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt),
    ]);
  }

  private async clearRoomArchivedFlag(): Promise<void> {
    await this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.roomArchived);
  }

  private async getLatestGameId(): Promise<string | null> {
    const [code, matchNumber] = await Promise.all([
      this.getGameCode(),
      this.ctx.storage.get<number>(GAME_DO_STORAGE_KEYS.matchNumber),
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
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
    ]);
  }

  private async setDisconnectMarker(playerId: PlayerId): Promise<void> {
    const marker = createDisconnectMarker(playerId, Date.now());
    await Promise.all([
      this.ctx.storage.put(
        GAME_DO_STORAGE_KEYS.disconnectedPlayer,
        marker.disconnectedPlayer,
      ),
      this.ctx.storage.put(
        GAME_DO_STORAGE_KEYS.disconnectTime,
        marker.disconnectTime,
      ),
      this.ctx.storage.put(
        GAME_DO_STORAGE_KEYS.disconnectAt,
        marker.disconnectAt,
      ),
    ]);
    await this.rescheduleAlarm();
  }

  private async resolveJoinAttempt(
    presentedTokenRaw: string | null,
  ): Promise<Result<JoinAttemptSuccess, Response>> {
    return resolveJoinAttemptRequest(
      {
        getRoomConfig: () => this.getRoomConfig(),
        isRoomArchived: () => this.isRoomArchived(),
        getDisconnectedPlayer: async () =>
          readDisconnectedPlayer(this.ctx.storage),
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
      await this.ctx.storage.setAlarm(alarmAt);
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
      { db: this.env.DB, waitUntil: (p) => this.ctx.waitUntil(p) },
      code,
      phase,
      turn,
      err,
    );
  };

  private reportProjectionParityMismatch = async (
    gameId: string,
    liveState: GameState,
  ): Promise<void> => {
    await reportGameDoProjectionParityMismatch({
      storage: this.ctx.storage,
      db: this.env.DB,
      waitUntil: (p) => this.ctx.waitUntil(p),
      gameId,
      liveState,
    });
  };

  private async verifyProjectionParity(state: GameState): Promise<void> {
    await verifyGameDoProjectionParity(
      this.ctx.storage,
      state,
      (gameId, liveState) =>
        this.reportProjectionParityMismatch(gameId, liveState),
    );
  }
  // --- WebSocket lifecycle ---
  async fetch(request: Request): Promise<Response> {
    return handleGameDoFetch(
      {
        handleInit: (r) => this.handleInit(r),
        handleJoinCheck: (r) => this.handleJoinCheck(r),
        handleReplayRequest: (r) => this.handleReplayRequest(r),
        resolveJoinAttempt: (token) => this.resolveJoinAttempt(token),
        getConnectedSeatCountAfterJoin: (seatOpen, playerId) =>
          this.getConnectedSeatCountAfterJoin(seatOpen, playerId),
        saveRoomConfig: (roomConfig) => this.saveRoomConfig(roomConfig),
        clearDisconnectMarker: () => this.clearDisconnectMarker(),
        replacePlayerSockets: (playerId) => this.replacePlayerSockets(playerId),
        send: (ws, msg) => this.send(ws, msg),
        broadcast: (msg) => this.broadcast(msg),
        getLatestGameId: () => this.getLatestGameId(),
        storage: this.ctx.storage,
        initGame: () => this.initGame(),
        touchInactivity: () => this.touchInactivity(),
        acceptWebSocket: (server, tags) =>
          this.ctx.acceptWebSocket(server, tags),
        getRoomConfig: () => this.getRoomConfig(),
      },
      request,
    );
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    return handleGameDoWebSocketMessage(
      {
        msgRates: this.msgRates,
        getPlayerId: (socket) => this.getPlayerId(socket),
        isSpectatorSocket: (socket) =>
          this.ctx.getTags(socket).includes('spectator'),
        touchInactivity: () => this.touchInactivity(),
        send: (socket, outbound) => this.send(socket, outbound),
        isGameStateActionMessage,
        dispatchGameStateAction: (playerId, socket, msg) =>
          dispatchGameStateAction(
            playerId,
            socket,
            msg,
            this.gameStateActionHandlers,
            (targetWs, action, onSuccess) =>
              this.runGameStateAction(targetWs, action, onSuccess),
          ),
        dispatchAuxMessage: (socket, playerId, msg) =>
          handleAuxMessage({
            ws: socket,
            playerId,
            msg: msg as AuxMessageDeps['msg'],
            lastChatAt: this.lastChatAt,
            send: (w, outbound) => this.send(w, outbound),
            broadcast: (outbound) => this.broadcast(outbound),
            handleRematch: (rematchPlayerId, w) =>
              this.handleRematch(rematchPlayerId, w),
          }),
      },
      ws,
      message,
    );
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    return handleGameDoWebSocketClose(
      {
        consumeReplacedSocket: (socket) => this.replacedSockets.delete(socket),
        getPlayerId: (socket) => this.getPlayerId(socket),
        getCurrentGameState: () => this.getCurrentGameState(),
        setDisconnectMarker: (playerId) => this.setDisconnectMarker(playerId),
        broadcast: (msg) => this.broadcast(msg),
      },
      ws,
    );
  }

  async alarm(): Promise<void> {
    await runGameDoAlarm({
      now: Date.now(),
      storage: this.ctx.storage,
      env: this.env,
      waitUntil: (p) => this.ctx.waitUntil(p),
      getWebSockets: () => this.ctx.getWebSockets(),
      map: this.map,
      getCurrentGameState: () => this.getCurrentGameState(),
      getGameCode: () => this.getGameCode(),
      getActionRng: () => this.getActionRng(),
      clearDisconnectMarker: () => this.clearDisconnectMarker(),
      rescheduleAlarm: () => this.rescheduleAlarm(),
      publishStateChange: (state, primaryMessage, options) =>
        this.publishStateChange(state, primaryMessage, options),
      reportEngineError: (code, phase, turn, err) =>
        this.reportEngineError(code, phase, turn, err),
      archiveRoomState: () => this.archiveRoomState(),
    });
  }

  private async startTurnTimer(state: GameState): Promise<void> {
    if (state.phase === 'gameOver') {
      await this.ctx.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt);
      await this.rescheduleAlarm();
      return;
    }
    const timeoutAt = Date.now() + TURN_TIMEOUT_MS;
    await this.ctx.storage.put(GAME_DO_STORAGE_KEYS.turnTimeoutAt, timeoutAt);
    await this.rescheduleAlarm();
  }

  private async publishStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: {
      actor?: PlayerId | null;
      restartTurnTimer?: boolean;
      events?: EngineEvent[];
    },
  ) {
    await runPublicationPipeline(
      {
        storage: this.ctx.storage,
        env: this.env,
        waitUntil: (p) => this.ctx.waitUntil(p),
        getGameCode: () => this.getGameCode(),
        verifyProjectionParity: (s) => this.verifyProjectionParity(s),
        broadcastStateChange: (s, msg) => this.broadcastStateChange(s, msg),
        startTurnTimer: (s) => this.startTurnTimer(s),
      },
      state,
      primaryMessage,
      options,
    );
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
    return handleInitRequest(
      {
        getRoomConfig: () => this.getRoomConfig(),
        saveRoomConfig: (roomConfig) => this.saveRoomConfig(roomConfig),
        setGameCode: (code) => this.setGameCode(code),
        touchInactivity: () => this.touchInactivity(),
      },
      request,
    );
  }

  private async handleJoinCheck(request: Request): Promise<Response> {
    return handleJoinCheckRequest(
      {
        resolveJoinAttempt: (playerToken) =>
          this.resolveJoinAttempt(playerToken),
      },
      request,
    );
  }

  private async handleReplayRequest(request: Request): Promise<Response> {
    return handleReplayRequest(
      {
        storage: this.ctx.storage,
        getRoomConfig: () => this.getRoomConfig(),
        getLatestGameId: () => this.getLatestGameId(),
        touchInactivity: () => this.touchInactivity(),
      },
      request,
    );
  }

  private async initGame() {
    await initGameSession({
      storage: this.ctx.storage,
      map: this.map,
      getRoomConfig: () => this.getRoomConfig(),
      getScenario: () => this.getScenario(),
      getGameCode: () => this.getGameCode(),
      clearRoomArchivedFlag: () => this.clearRoomArchivedFlag(),
      verifyProjectionParity: (state) => this.verifyProjectionParity(state),
      broadcastFiltered: (msg) => this.broadcastFiltered(msg),
      startTurnTimer: (state) => this.startTurnTimer(state),
    });
  }

  private async handleRematch(playerId: PlayerId, _ws: WebSocket) {
    await handleRematchRequest(
      {
        storage: this.ctx.storage,
        initGame: () => this.initGame(),
        broadcast: (msg) => this.broadcast(msg),
      },
      playerId,
    );
  }

  private broadcastStateChange(
    state: GameState,
    primaryMessage?: StatefulServerMessage,
  ) {
    broadcastStateChange(this.ctx, state, primaryMessage);
  }

  // --- Messaging ---
  private send(ws: WebSocket, msg: S2C) {
    sendSocketMessage(ws, msg);
  }

  private broadcast(msg: S2C) {
    broadcastMessage(this.ctx, msg);
  }

  // Broadcast a message containing game state,
  // filtering hidden information per player.
  private broadcastFiltered(
    msg: S2C & {
      state: GameState;
    },
  ) {
    broadcastFilteredMessage(this.ctx, msg);
  }
}
