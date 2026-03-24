import { DurableObject } from 'cloudflare:workers';
import { INACTIVITY_TIMEOUT_MS, TURN_TIMEOUT_MS } from '../../shared/constants';
import type { EngineEvent } from '../../shared/engine/engine-events';
import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { deriveActionRng } from '../../shared/prng';
import type { GameState } from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import {
  isValidPlayerToken,
  type RoomConfig,
  resolveSeatAssignment,
} from '../protocol';
import {
  createGameStateActionHandlers,
  dispatchGameStateAction,
  type EngineFailure,
  type GameStateActionMessage,
  runGameStateAction,
} from './actions';
import {
  allocateMatchIdentity,
  appendEnvelopedEvents,
  getEventStreamLength,
  getMatchSeed,
  getProjectedCurrentStateRaw,
  saveCheckpoint,
  saveMatchCreatedAt,
} from './archive';
import {
  broadcastFilteredMessage,
  broadcastMessage,
  broadcastStateChange,
  sendSocketMessage,
} from './broadcast';
import { runGameDoAlarm } from './game-do-alarm';
import { handleGameDoFetch } from './game-do-fetch';
import {
  reportGameDoEngineError,
  reportGameDoProjectionParityMismatch,
  verifyGameDoProjectionParity,
} from './game-do-telemetry';
import {
  handleGameDoWebSocketClose,
  handleGameDoWebSocketMessage,
} from './game-do-ws';
import {
  handleInitRequest,
  handleJoinCheckRequest,
  handleReplayRequest,
  resolveJoinAttempt as resolveJoinAttemptRequest,
} from './http-handlers';
import { archiveCompletedMatch } from './match-archive';
import {
  resolveStateBearingMessage,
  type StatefulServerMessage,
  toGameStartMessage,
} from './messages';
import {
  createDisconnectMarker,
  getNextAlarmAt,
  normalizeDisconnectedPlayer,
} from './session';
import { type AuxMessageDeps, handleAuxMessage } from './socket';
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
    return resolveJoinAttemptRequest(
      {
        getRoomConfig: () => this.getRoomConfig(),
        isRoomArchived: () => this.isRoomArchived(),
        getDisconnectedPlayer: async () =>
          normalizeDisconnectedPlayer(
            await this.ctx.storage.get<number>('disconnectedPlayer'),
          ),
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

  // --- Error telemetry (see game-do-telemetry.ts) ---
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
        touchInactivity: () => this.touchInactivity(),
        send: (socket, outbound) => this.send(socket, outbound),
        isGameStateActionMessage: (msg) => this.isGameStateActionMessage(msg),
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
