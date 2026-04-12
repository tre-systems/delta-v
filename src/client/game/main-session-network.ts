import { createGame } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import type { ScenarioKey } from '../../shared/map-data';
import { findBaseHex, isValidScenario, SCENARIOS } from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import type { Renderer } from '../renderer/renderer';
import type { UIManager } from '../ui/ui';
import type { ActionDeps } from './action-deps';
import { setWaitingScreenState } from './client-context-store';
import type { ConnectionManager } from './connection';
import type { HudController } from './hud-controller';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './message-handler';
import type { ClientState } from './phase';
import type { SessionApi } from './session-api';
import {
  beginJoinGameSession,
  beginSpectateGameSession,
  type ExitToMenuSessionDeps,
  exitToMenuSession,
  type JoinGameSessionDeps,
  type LocalGameSessionDeps,
  type SpectateGameSessionDeps,
  startLocalGameSession,
} from './session-controller';
import { buildGameRoute } from './session-links';
import type { ClientSession } from './session-model';
import type { SessionTokenService } from './session-token-service';
import type { TurnTelemetryTracker } from './turn-telemetry';

export interface MainNetworkDeps {
  ctx: ClientSession;
  map: ReturnType<typeof import('../../shared/map-data').buildSolarSystemMap>;
  renderer: Renderer;
  ui: UIManager;
  hud: HudController;
  actionDeps: ActionDeps;
  turnTelemetry: TurnTelemetryTracker;
  sessionApi: Pick<SessionApi, 'validateJoin'>;
  sessionTokens: Pick<
    SessionTokenService,
    'getStoredPlayerToken' | 'storePlayerToken'
  >;
  connection: ConnectionManager;
  setState: (state: ClientState) => void;
  applyGameState: (state: GameState) => void;
  transitionToPhase: () => void;
  onAnimationComplete: () => void;
  runLocalAI: () => void;
  track: (event: string, props?: Record<string, unknown>) => void;
  createLocalTransport: () => import('./transport').GameTransport;
  stopTurnTimer: () => void;
}

type MainRemoteSessionBridge = Pick<
  SpectateGameSessionDeps,
  | 'ctx'
  | 'resetTurnTelemetry'
  | 'replaceRoute'
  | 'buildGameRoute'
  | 'connect'
  | 'setWaitingScreenState'
  | 'setState'
>;

const replaceMainRoute = (route: string): void => {
  history.replaceState(null, '', route);
};

// Validates an untrusted scenario string and returns the definition + key.
// Falls back to 'biplanetary' for unknown keys.
const resolveScenario = (scenario: string) => {
  const key: ScenarioKey = isValidScenario(scenario) ? scenario : 'biplanetary';
  return { def: SCENARIOS[key], key };
};

const createMainRemoteSessionBridge = (
  deps: Pick<
    MainNetworkDeps,
    'ctx' | 'turnTelemetry' | 'connection' | 'setState'
  >,
): MainRemoteSessionBridge => ({
  ctx: deps.ctx,
  resetTurnTelemetry: () => deps.turnTelemetry.reset(),
  replaceRoute: replaceMainRoute,
  buildGameRoute,
  connect: (gameCode) => deps.connection.connect(gameCode),
  setWaitingScreenState: (state) => setWaitingScreenState(deps.ctx, state),
  setState: deps.setState,
});

const createMainLocalSessionDeps = (
  deps: MainNetworkDeps,
): LocalGameSessionDeps => ({
  ctx: deps.ctx,
  createLocalTransport: deps.createLocalTransport,
  createLocalGameState: (selectedScenario) => {
    const { def, key } = resolveScenario(selectedScenario);
    return createGame(
      def,
      deps.map,
      asGameId('LOCAL'),
      findBaseHex,
      undefined,
      key,
    );
  },
  getScenarioName: (selectedScenario) =>
    resolveScenario(selectedScenario).def.name,
  resetTurnTelemetry: () => deps.turnTelemetry.reset(),
  clearTrails: () => deps.renderer.clearTrails(),
  clearLog: () => deps.ui.log.clear(),
  setChatEnabled: (enabled) => deps.ui.log.setChatEnabled(enabled),
  logText: (text) => deps.ui.log.logText(text),
  trackGameCreated: (details) => {
    deps.track('game_created', details);
    deps.track('ai_game_started', {
      scenario: details.scenario,
      difficulty: details.difficulty,
    });
  },
  applyGameState: deps.applyGameState,
  logScenarioBriefing: () => deps.hud.logScenarioBriefing(),
  setState: deps.setState,
  runLocalAI: deps.runLocalAI,
});

const createMainJoinSessionDeps = (
  deps: MainNetworkDeps,
): JoinGameSessionDeps => ({
  ...createMainRemoteSessionBridge(deps),
  getStoredPlayerToken: (gameCode) =>
    deps.sessionTokens.getStoredPlayerToken(gameCode),
  storePlayerToken: (gameCode, token) =>
    deps.sessionTokens.storePlayerToken(gameCode, token),
  validateJoin: (gameCode, token) =>
    deps.sessionApi.validateJoin(gameCode, token),
  showToast: (message, type) => deps.ui.overlay.showToast(message, type),
  exitToMenu: () => exitToMenuFromMain(deps),
});

const createMainExitSessionDeps = (
  deps: MainNetworkDeps,
): ExitToMenuSessionDeps => ({
  ctx: deps.ctx,
  stopPing: () => deps.connection.stopPing(),
  stopTurnTimer: deps.stopTurnTimer,
  closeConnection: () => deps.connection.close(),
  resetTurnTelemetry: () => deps.turnTelemetry.reset(),
  replaceRoute: replaceMainRoute,
  setState: deps.setState,
});

export const startLocalGameFromMain = (
  deps: MainNetworkDeps,
  scenario: string,
): void => {
  deps.ui.overlay.hideGameOver();
  deps.ui.log.setLocalGame(true);
  startLocalGameSession(createMainLocalSessionDeps(deps), scenario);
};

export const beginSpectateGameFromMain = (
  deps: MainNetworkDeps,
  code: string,
): void => {
  beginSpectateGameSession(createMainRemoteSessionBridge(deps), code);
};

export const beginJoinGameFromMain = (
  deps: MainNetworkDeps,
  code: string,
  playerToken: string | null,
): void => {
  deps.ui.log.setLocalGame(false);
  void beginJoinGameSession(createMainJoinSessionDeps(deps), code, playerToken);
};

export const handleServerMessageFromMain = (
  handlerDeps: MessageHandlerDeps,
  msg: S2C,
  onGameOver: () => void,
): void => {
  handleServerMessage(handlerDeps, msg);

  if (msg.type === 'gameOver') {
    onGameOver();
  }
};

export const exitToMenuFromMain = (deps: MainNetworkDeps): void => {
  exitToMenuSession(createMainExitSessionDeps(deps));
};
