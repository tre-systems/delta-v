import { DurableObject } from 'cloudflare:workers';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  buildSolarSystemMap,
  isValidScenario,
  SCENARIOS,
} from '../../shared/map-data';
import { deriveActionRng } from '../../shared/prng';
import type { GameState, PlayerId, Result } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import {
  isValidPlayerToken,
  type RoomConfig,
  resolveSeatAssignment,
} from '../protocol';
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
import { BOT_THINK_TIME_MS, buildBotAction } from './bot';
import {
  broadcastMessage,
  broadcastStateChange,
  sendSocketMessage,
} from './broadcast';
import { type GameDoFetchDeps, handleGameDoFetch } from './fetch';
import {
  handleInitRequest,
  handleJoinCheckRequest,
  handleReplayRequest,
  type JoinAttemptSuccess,
  resolveJoinAttempt as resolveJoinAttemptRequest,
} from './http-handlers';
import { handleRematchRequest, initGameSession } from './match';
import type { StatefulServerMessage } from './message-builders';
import { type PublicationDeps, runPublicationPipeline } from './publication';
import {
  createDisconnectMarker,
  getNextAlarmAt,
  readAlarmDeadlines,
  readDisconnectedPlayer,
} from './session';
import { dispatchAuxMessage } from './socket';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';
import {
  reportGameAbandoned,
  reportGameDoEngineError,
  reportGameDoProjectionParityMismatch,
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
    getScenario: () => this.getScenario().then((s) => s.def),
    getActionRng: () => this.getActionRng(),
    publishStateChange: (state, primaryMessage, options) =>
      this.publishStateChange(state, primaryMessage, options),
  });

  private get storage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  private waitUntil(promise: Promise<unknown>): void {
    this.ctx.waitUntil(promise);
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
      return null;
    }

    return getProjectedCurrentStateRaw(this.storage, gameId);
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
    return (
      (await this.storage.get<string>(GAME_DO_STORAGE_KEYS.gameCode)) ?? ''
    );
  }

  private async getScenario() {
    const scenarioName =
      (await this.getRoomConfig())?.scenario ?? 'biplanetary';
    const key = isValidScenario(scenarioName) ? scenarioName : 'biplanetary';
    return { def: SCENARIOS[key], key };
  }

  private async setGameCode(code: string): Promise<void> {
    await this.storage.put(GAME_DO_STORAGE_KEYS.gameCode, code);
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
    await Promise.all([
      this.storage.put(GAME_DO_STORAGE_KEYS.roomArchived, true),
      this.storage.delete(GAME_DO_STORAGE_KEYS.botTurnAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.storage.delete(GAME_DO_STORAGE_KEYS.inactivityAt),
      this.storage.delete(GAME_DO_STORAGE_KEYS.rematchRequests),
      this.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt),
    ]);
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
      return Math.random;
    }

    const [seed, seq] = await Promise.all([
      getMatchSeed(this.storage, gameId),
      getEventStreamLength(this.storage, gameId),
    ]);

    if (seed === null) {
      return Math.random;
    }

    return deriveActionRng(seed, seq);
  }

  private async clearDisconnectMarker(): Promise<void> {
    await Promise.all([
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectTime),
      this.storage.delete(GAME_DO_STORAGE_KEYS.disconnectAt),
    ]);
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
      archiveRoomState: () => this.archiveRoomState(),
    };
  }

  private createPublicationDeps(): PublicationDeps {
    return {
      storage: this.storage,
      env: this.env,
      waitUntil: (promise) => this.waitUntil(promise),
      getGameCode: () => this.getGameCode(),
      verifyProjectionParity: (state) => this.verifyProjectionParity(state),
      broadcastStateChange: (state, primaryMessage) =>
        this.broadcastStateChange(state, primaryMessage),
      startTurnTimer: (state) => this.startTurnTimer(state),
    };
  }

  private createGameStateActionDeps(): Parameters<
    typeof runGameStateAction
  >[0] {
    return {
      getCurrentGameState: () => this.getCurrentGameState(),
      getGameCode: () => this.getGameCode(),
      reportEngineError: (code, phase, turn, err) =>
        this.reportEngineError(code, phase, turn, err),
      sendError: (socket, message, code) =>
        this.send(socket, { type: 'error', message, code }),
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
      socket,
      msg,
      this.gameStateActionHandlers,
      (targetWs, action, onSuccess) =>
        this.runGameStateAction(targetWs, action, onSuccess),
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
    });
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
    return handleGameDoWebSocketMessage(
      this.createWebSocketMessageDeps(),
      ws,
      message,
    );
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    return handleGameDoWebSocketClose(this.createWebSocketCloseDeps(), ws);
  }

  async alarm(): Promise<void> {
    await runGameDoAlarm(this.createAlarmDeps());
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
      this.createPublicationDeps(),
      state,
      primaryMessage,
      options,
    );
    await this.scheduleBotTurnIfNeeded(state);
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

    const action = buildBotAction(gameState, playerId, this.map);

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
  ): Promise<void> {
    await runGameStateAction(
      this.createGameStateActionDeps(),
      ws,
      action,
      onSuccess,
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

  private async initGame() {
    await initGameSession(this.createInitGameDeps());
  }

  private async handleRematch(playerId: PlayerId, _ws: WebSocket) {
    await handleRematchRequest(this.createRematchDeps(), playerId);
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
}
