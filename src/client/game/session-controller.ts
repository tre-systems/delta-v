import type { AIDifficulty } from '../../shared/ai';
import {
  type EngineError,
  ErrorCode,
  type GameState,
  type PlayerId,
  type Result,
} from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import {
  resetReconnectAttempts,
  setGameCode,
  setIsLocalGame,
  setLatencyMs,
  setOpponentDisconnectDeadlineMs,
  setPlayerId,
  setReconnectOverlayState,
  setScenario,
  setSpectatorMode,
  setTransport,
  setWaitingScreenState,
} from './client-context-store';
import { clearClientGameState } from './game-state-store';
import { deriveGameStartClientState } from './network';
import type { ClientState } from './phase';
import type { ClientSession } from './session-model';
import type { GameTransport } from './transport';

export interface CreatedGameSessionDeps {
  ctx: ClientSession;
  storePlayerToken: (code: string, token: string) => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setWaitingScreenState: (
    state: import('../ui/screens').WaitingScreenState | null,
  ) => void;
  setState: (state: ClientState) => void;
  trackGameCreated: (details: {
    scenario: string;
    mode: 'multiplayer';
  }) => void;
}

export interface LocalGameSessionDeps {
  ctx: ClientSession;
  createLocalTransport: () => GameTransport;
  createLocalGameState: (scenario: string) => Result<GameState, EngineError>;
  getScenarioName: (scenario: string) => string;
  resetTurnTelemetry: () => void;
  clearTrails: () => void;
  clearLog: () => void;
  setChatEnabled: (enabled: boolean) => void;
  logText: (text: string) => void;
  trackGameCreated: (details: {
    scenario: string;
    mode: 'local';
    difficulty: AIDifficulty;
  }) => void;
  applyGameState: (state: GameState) => void;
  logScenarioBriefing: () => void;
  setState: (state: ClientState) => void;
  runLocalAI: () => void;
}

export interface SpectateGameSessionDeps {
  ctx: Pick<
    ClientSession,
    | 'gameCode'
    | 'spectatorMode'
    | 'reconnectOverlayState'
    | 'opponentDisconnectDeadlineMs'
  >;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setWaitingScreenState: (
    state: import('../ui/screens').WaitingScreenState | null,
  ) => void;
  setState: (state: ClientState) => void;
}

// Deps for viewing an archived match replay without a live WebSocket. The
// client applies the match's final state (so the game-over / replay UI has
// real data to render), then hands the full timeline to the replay
// controller which scrubs the match turn-by-turn.
export interface ArchivedReplaySessionDeps {
  ctx: Pick<
    ClientSession,
    | 'gameCode'
    | 'spectatorMode'
    | 'reconnectOverlayState'
    | 'opponentDisconnectDeadlineMs'
  >;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  setWaitingScreenState: (
    state: import('../ui/screens').WaitingScreenState | null,
  ) => void;
  setState: (state: ClientState) => void;
  fetchArchivedReplay: (
    code: string,
    gameId: string,
  ) => Promise<import('../../shared/replay').ReplayTimeline | null>;
  applyGameState: (state: GameState) => void;
  startArchivedReplay: (
    timeline: import('../../shared/replay').ReplayTimeline,
  ) => void;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  exitToMenu: () => void;
  setScenario: (scenario: string) => void;
}

export interface JoinGameSessionDeps {
  ctx: Pick<
    ClientSession,
    'gameCode' | 'reconnectOverlayState' | 'opponentDisconnectDeadlineMs'
  >;
  getStoredPlayerToken: (code: string) => string | null;
  storePlayerToken: (code: string, token: string) => void;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setWaitingScreenState: (
    state: import('../ui/screens').WaitingScreenState | null,
  ) => void;
  setState: (state: ClientState) => void;
  validateJoin: (
    code: string,
    playerToken: string | null,
  ) => Promise<Result<string | null, { message: string; code?: ErrorCode }>>;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  exitToMenu: () => void;
  selectCodeInput?: () => void;
  // When the server reports the room is full (ROOM_FULL), fall back to a
  // watch-only spectator session instead of bouncing to the menu. Callers
  // that don't support spectator fallback can omit this — the join will exit
  // to menu on ROOM_FULL, preserving legacy behaviour.
  fallbackToSpectator?: (code: string) => void;
}

export interface ExitToMenuSessionDeps {
  ctx: Pick<
    ClientSession,
    | 'gameCode'
    | 'gameState'
    | 'isLocalGame'
    | 'latencyMs'
    | 'playerId'
    | 'reconnectOverlayState'
    | 'reconnectAttempts'
    | 'opponentDisconnectDeadlineMs'
    | 'spectatorMode'
    | 'transport'
    | 'waitingScreenState'
  >;
  stopPing: () => void;
  stopTurnTimer: () => void;
  closeConnection: () => void;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  setState: (state: ClientState) => void;
}

type SessionReconnectUiState = Pick<
  ClientSession,
  'reconnectOverlayState' | 'opponentDisconnectDeadlineMs'
>;

type RemoteSessionPrepState = Pick<
  ClientSession,
  | 'spectatorMode'
  | 'isLocalGame'
  | 'reconnectOverlayState'
  | 'opponentDisconnectDeadlineMs'
  | 'waitingScreenState'
>;

type LocalSessionPrepState = Pick<
  ClientSession,
  | 'spectatorMode'
  | 'isLocalGame'
  | 'gameCode'
  | 'latencyMs'
  | 'reconnectAttempts'
  | 'reconnectOverlayState'
  | 'opponentDisconnectDeadlineMs'
  | 'waitingScreenState'
>;

type ClearedRemoteSessionState = Pick<
  ClientSession,
  'gameCode' | 'latencyMs' | 'reconnectAttempts' | 'waitingScreenState'
>;

const clearReconnectUiState = (ctx: SessionReconnectUiState): void => {
  setReconnectOverlayState(ctx, null);
  setOpponentDisconnectDeadlineMs(ctx, null);
};

const prepareRemoteSession = (
  ctx: RemoteSessionPrepState,
  spectatorMode: boolean,
): void => {
  setSpectatorMode(ctx as ClientSession, spectatorMode);
  setIsLocalGame(ctx, false);
  clearReconnectUiState(ctx);
  setWaitingScreenState(ctx, null);
};

const clearRemoteSessionState = (ctx: ClearedRemoteSessionState): void => {
  setGameCode(ctx, null);
  setLatencyMs(ctx, -1);
  resetReconnectAttempts(ctx);
  setWaitingScreenState(ctx, null);
};

const prepareLocalSession = (ctx: LocalSessionPrepState): void => {
  setSpectatorMode(ctx as ClientSession, false);
  setIsLocalGame(ctx, true);
  clearRemoteSessionState(ctx);
  clearReconnectUiState(ctx);
};

export const completeCreatedGameSession = (
  deps: CreatedGameSessionDeps,
  scenario: string,
  code: string,
  playerToken: string,
): void => {
  prepareRemoteSession(deps.ctx, false);
  setScenario(deps.ctx, scenario);
  setGameCode(deps.ctx, code);
  deps.setWaitingScreenState({
    kind: 'private',
    code,
    connecting: false,
  });
  deps.storePlayerToken(code, playerToken);
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.trackGameCreated({
    scenario,
    mode: 'multiplayer',
  });
  deps.setState('waitingForOpponent');
  deps.connect(code);
};

export const startLocalGameSession = (
  deps: LocalGameSessionDeps,
  scenario: string,
): void => {
  prepareLocalSession(deps.ctx);
  setScenario(deps.ctx, scenario);
  const forcedSide = (globalThis as Record<string, unknown>)
    .__DELTAV_FORCE_PLAYER_SIDE;
  const humanSide = (
    forcedSide === 0 || forcedSide === 1
      ? forcedSide
      : Math.random() < 0.5
        ? 0
        : 1
  ) as PlayerId;
  setPlayerId(deps.ctx, humanSide);
  deps.resetTurnTelemetry();
  setTransport(deps.ctx, deps.createLocalTransport());

  const result = deps.createLocalGameState(scenario);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const state = result.value;

  deps.clearTrails();
  deps.clearLog();
  deps.setChatEnabled(false);
  deps.logText(
    `vs AI (${deps.ctx.aiDifficulty}) \u2014 ${deps.getScenarioName(scenario)}`,
  );
  deps.trackGameCreated({
    scenario,
    mode: 'local',
    difficulty: deps.ctx.aiDifficulty,
  });
  deps.applyGameState(state);
  deps.logScenarioBriefing();

  const gameState = deps.ctx.gameState;

  if (!gameState) {
    return;
  }

  const nextState = deriveGameStartClientState(gameState, deps.ctx.playerId);

  deps.setState(nextState);

  if (nextState === 'playing_opponentTurn') {
    deps.runLocalAI();
  }
};

export const beginSpectateGameSession = (
  deps: SpectateGameSessionDeps,
  code: string,
): void => {
  prepareRemoteSession(deps.ctx as ClientSession, true);
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
  deps.setWaitingScreenState({
    kind: 'private',
    code,
    connecting: true,
  });
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.setState('connecting');
  deps.connect(code);
};

// Enter archived-replay mode: fetch the timeline via the spectator route
// (no playerToken), apply the match's final state so the game-over / replay
// overlay has real data, then hand the timeline to the replay controller.
// Deliberately skips connect(code) — archived replays do not open a
// WebSocket.
export const beginArchivedReplaySession = async (
  deps: ArchivedReplaySessionDeps,
  code: string,
  gameId: string,
): Promise<void> => {
  prepareRemoteSession(deps.ctx as ClientSession, true);
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.setState('connecting');
  deps.setWaitingScreenState({
    kind: 'private',
    code,
    connecting: true,
  });

  const timeline = await deps.fetchArchivedReplay(code, gameId);

  if (!timeline || timeline.entries.length === 0) {
    deps.showToast(TOAST.sessionController.replayUnavailable, 'error');
    deps.exitToMenu();
    return;
  }

  // Seed scenario so the UI's scenario label renders correctly.
  deps.setScenario(timeline.scenario);

  // Apply the final state first — this populates gameState with the
  // match's endgame (winner, outcome, turn count) so the replay-controller
  // has a "source state" to restore when the viewer closes the replay.
  const lastEntry = timeline.entries[timeline.entries.length - 1];
  if (lastEntry) {
    deps.applyGameState(lastEntry.message.state);
  }

  deps.setWaitingScreenState(null);
  deps.setState('gameOver');
  deps.startArchivedReplay(timeline);
};

export const beginJoinGameSession = async (
  deps: JoinGameSessionDeps,
  code: string,
  playerToken: string | null = null,
): Promise<void> => {
  const effectiveToken = playerToken ?? deps.getStoredPlayerToken(code);
  const validation = await deps.validateJoin(code, effectiveToken);

  if (!validation.ok) {
    if (
      validation.error.code === ErrorCode.ROOM_FULL &&
      deps.fallbackToSpectator
    ) {
      deps.showToast(TOAST.sessionController.joinRoomFullSpectator, 'info');
      deps.fallbackToSpectator(code);
      return;
    }
    deps.showToast(validation.error.message, 'error');
    deps.selectCodeInput?.();
    deps.exitToMenu();
    return;
  }

  prepareRemoteSession(deps.ctx as ClientSession, false);

  if (validation.value) {
    deps.storePlayerToken(code, validation.value);
  }
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
  deps.setWaitingScreenState({
    kind: 'private',
    code,
    connecting: true,
  });
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.setState('connecting');
  deps.connect(code);
};

export const exitToMenuSession = (deps: ExitToMenuSessionDeps): void => {
  deps.stopPing();
  deps.stopTurnTimer();
  deps.closeConnection();
  deps.resetTurnTelemetry();
  clearClientGameState(deps.ctx);
  clearRemoteSessionState(deps.ctx);
  setSpectatorMode(deps.ctx, false);
  setIsLocalGame(deps.ctx, false);
  clearReconnectUiState(deps.ctx);
  setPlayerId(deps.ctx, -1);
  setTransport(deps.ctx, null);
  deps.replaceRoute('/');
  deps.setState('menu');
};
