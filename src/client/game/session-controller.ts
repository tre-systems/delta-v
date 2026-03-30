import type { AIDifficulty } from '../../shared/ai';
import type { GameState, Result } from '../../shared/types/domain';
import {
  resetReconnectAttempts,
  setGameCode,
  setIsLocalGame,
  setLatencyMs,
  setPlayerId,
  setScenario,
  setSpectatorMode,
  setTransport,
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
  setState: (state: ClientState) => void;
  trackGameCreated: (details: {
    scenario: string;
    mode: 'multiplayer';
  }) => void;
}

export interface LocalGameSessionDeps {
  ctx: ClientSession;
  createLocalTransport: () => GameTransport;
  createLocalGameState: (scenario: string) => GameState;
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
  ctx: Pick<ClientSession, 'gameCode' | 'spectatorMode'>;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setState: (state: ClientState) => void;
}

export interface JoinGameSessionDeps {
  ctx: Pick<ClientSession, 'gameCode'>;
  getStoredPlayerToken: (code: string) => string | null;
  storePlayerToken: (code: string, token: string) => void;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setState: (state: ClientState) => void;
  validateJoin: (
    code: string,
    playerToken: string | null,
  ) => Promise<Result<string | null>>;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  exitToMenu: () => void;
}

export interface ExitToMenuSessionDeps {
  ctx: Pick<
    ClientSession,
    | 'gameCode'
    | 'gameState'
    | 'isLocalGame'
    | 'latencyMs'
    | 'playerId'
    | 'reconnectAttempts'
    | 'spectatorMode'
    | 'transport'
  >;
  stopPing: () => void;
  stopTurnTimer: () => void;
  closeConnection: () => void;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  setState: (state: ClientState) => void;
}

export const completeCreatedGameSession = (
  deps: CreatedGameSessionDeps,
  scenario: string,
  code: string,
  playerToken: string,
): void => {
  setSpectatorMode(deps.ctx as ClientSession, false);
  setScenario(deps.ctx, scenario);
  setGameCode(deps.ctx, code);
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
  setSpectatorMode(deps.ctx as ClientSession, false);
  setIsLocalGame(deps.ctx, true);
  setScenario(deps.ctx, scenario);
  setPlayerId(deps.ctx, 0);
  deps.resetTurnTelemetry();
  setTransport(deps.ctx, deps.createLocalTransport());

  const state = deps.createLocalGameState(scenario);

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
  setSpectatorMode(deps.ctx as ClientSession, true);
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.setState('connecting');
  deps.connect(code);
};

export const beginJoinGameSession = async (
  deps: JoinGameSessionDeps,
  code: string,
  playerToken: string | null = null,
): Promise<void> => {
  const effectiveToken = playerToken ?? deps.getStoredPlayerToken(code);
  const validation = await deps.validateJoin(code, effectiveToken);

  if (!validation.ok) {
    deps.showToast(validation.error, 'error');
    deps.exitToMenu();
    return;
  }

  setSpectatorMode(deps.ctx as ClientSession, false);

  if (validation.value) {
    deps.storePlayerToken(code, validation.value);
  }
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
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
  setGameCode(deps.ctx, null);
  setSpectatorMode(deps.ctx, false);
  setIsLocalGame(deps.ctx, false);
  setLatencyMs(deps.ctx, -1);
  setPlayerId(deps.ctx, -1);
  resetReconnectAttempts(deps.ctx);
  setTransport(deps.ctx, null);
  deps.replaceRoute('/');
  deps.setState('menu');
};
