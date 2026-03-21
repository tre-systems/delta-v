import type { AIDifficulty } from '../../shared/ai';
import type { GameState } from '../../shared/types/domain';
import {
  setGameCode,
  setIsLocalGame,
  setPlayerId,
  setScenario,
  setTransport,
} from './client-context-store';
import { clearClientGameState } from './game-state-store';
import { deriveGameStartClientState } from './network';
import type { ClientState } from './phase';
import type { GameTransport } from './transport';

interface SessionContext {
  scenario: string;
  isLocalGame: boolean;
  playerId: number;
  gameCode: string | null;
  gameState: GameState | null;
  transport: GameTransport | null;
  aiDifficulty: AIDifficulty;
}

export interface CreatedGameSessionDeps {
  ctx: SessionContext;
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
  ctx: SessionContext;
  createLocalTransport: () => GameTransport;
  createLocalGameState: (scenario: string) => GameState;
  getScenarioName: (scenario: string) => string;
  resetTurnTelemetry: () => void;
  setRendererPlayerId: (playerId: number) => void;
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

export interface JoinGameSessionDeps {
  ctx: Pick<SessionContext, 'gameCode'>;
  storePlayerToken: (code: string, token: string) => void;
  resetTurnTelemetry: () => void;
  replaceRoute: (route: string) => void;
  buildGameRoute: (code: string) => string;
  connect: (code: string) => void;
  setState: (state: ClientState) => void;
}

export interface ExitToMenuSessionDeps {
  ctx: Pick<SessionContext, 'gameState' | 'isLocalGame' | 'transport'>;
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
  setScenario(deps.ctx, scenario);
  setGameCode(deps.ctx, code);
  deps.storePlayerToken(code, playerToken);
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.trackGameCreated({
    scenario,
    mode: 'multiplayer',
  });
  deps.connect(code);
  deps.setState('waitingForOpponent');
};

export const startLocalGameSession = (
  deps: LocalGameSessionDeps,
  scenario: string,
): void => {
  setIsLocalGame(deps.ctx, true);
  setScenario(deps.ctx, scenario);
  setPlayerId(deps.ctx, 0);
  deps.resetTurnTelemetry();
  deps.setRendererPlayerId(0);
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

export const beginJoinGameSession = (
  deps: JoinGameSessionDeps,
  code: string,
  playerToken: string | null = null,
): void => {
  if (playerToken) {
    deps.storePlayerToken(code, playerToken);
  }
  deps.resetTurnTelemetry();
  setGameCode(deps.ctx, code);
  deps.replaceRoute(deps.buildGameRoute(code));
  deps.connect(code);
  deps.setState('connecting');
};

export const exitToMenuSession = (deps: ExitToMenuSessionDeps): void => {
  deps.stopPing();
  deps.stopTurnTimer();
  deps.closeConnection();
  deps.resetTurnTelemetry();
  clearClientGameState(deps.ctx);
  setIsLocalGame(deps.ctx, false);
  setTransport(deps.ctx, null);
  deps.replaceRoute('/');
  deps.setState('menu');
};
