import { createGame } from '../../shared/engine/game-engine';
import { findBaseHex, SCENARIOS } from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import type { Renderer } from '../renderer/renderer';
import type { UIManager } from '../ui/ui';
import type { ActionDeps } from './action-deps';
import type { ConnectionManager } from './connection';
import type { HudController } from './hud-controller';
import { createMainMessageHandlerDeps } from './main-deps';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './message-handler';
import type { ClientState } from './phase';
import { buildGameRoute } from './session';
import type { SessionApi } from './session-api';
import {
  beginJoinGameSession,
  exitToMenuSession,
  startLocalGameSession,
} from './session-controller';
import type { TurnTelemetryTracker } from './turn-telemetry';

interface ClientContextLike {
  state: ClientState;
  playerId: number;
  gameCode: string | null;
  scenario: string;
  gameState: GameState | null;
  isLocalGame: boolean;
  transport: import('./transport').GameTransport | null;
  aiDifficulty: import('../../shared/ai').AIDifficulty;
  planningState: import('./planning').PlanningState;
  latencyMs: number;
  reconnectAttempts: number;
}

interface SharedMainNetworkDeps {
  ctx: ClientContextLike;
  map: ReturnType<typeof import('../../shared/map-data').buildSolarSystemMap>;
  renderer: Renderer;
  ui: UIManager;
  hud: HudController;
  actionDeps: ActionDeps;
  turnTelemetry: TurnTelemetryTracker;
  sessionApi: SessionApi;
  connection: ConnectionManager;
  setMenuState: (state: ClientState) => void;
  setState: (state: ClientState) => void;
  applyGameState: (state: GameState) => void;
  transitionToPhase: () => void;
  onAnimationComplete: () => void;
  runLocalAI: () => void;
  track: (event: string, props?: Record<string, unknown>) => void;
  createLocalTransport: () => import('./transport').GameTransport;
  stopTurnTimer: () => void;
}

export const startLocalGameFromMain = (
  deps: SharedMainNetworkDeps,
  scenario: string,
): void => {
  startLocalGameSession(
    {
      ctx: deps.ctx,
      createLocalTransport: () => deps.createLocalTransport(),
      createLocalGameState: (selectedScenario) => {
        const scenarioDef =
          SCENARIOS[selectedScenario] ?? SCENARIOS.biplanetary;
        return createGame(scenarioDef, deps.map, 'LOCAL', findBaseHex);
      },
      getScenarioName: (selectedScenario) =>
        (SCENARIOS[selectedScenario] ?? SCENARIOS.biplanetary).name,
      resetTurnTelemetry: () => deps.turnTelemetry.reset(),
      setRendererPlayerId: (playerId) => deps.renderer.setPlayerId(playerId),
      clearTrails: () => deps.renderer.clearTrails(),
      clearLog: () => deps.ui.log.clear(),
      setChatEnabled: (enabled) => deps.ui.log.setChatEnabled(enabled),
      logText: (text) => deps.ui.log.logText(text),
      trackGameCreated: (details) => deps.track('game_created', details),
      applyGameState: (state) => deps.applyGameState(state),
      logScenarioBriefing: () => deps.hud.logScenarioBriefing(),
      setState: (state) => deps.setState(state),
      runLocalAI: () => deps.runLocalAI(),
    },
    scenario,
  );
};

export const beginJoinGameFromMain = (
  deps: SharedMainNetworkDeps,
  code: string,
  playerToken: string | null,
): void => {
  void beginJoinGameSession(
    {
      ctx: deps.ctx,
      getStoredPlayerToken: (gameCode) =>
        deps.sessionApi.getStoredPlayerToken(gameCode),
      storePlayerToken: (gameCode, token) =>
        deps.sessionApi.storePlayerToken(gameCode, token),
      resetTurnTelemetry: () => deps.turnTelemetry.reset(),
      replaceRoute: (route) => history.replaceState(null, '', route),
      buildGameRoute,
      connect: (gameCode) => deps.connection.connect(gameCode),
      setState: (state) => deps.setMenuState(state),
      validateJoin: (gameCode, token) =>
        deps.sessionApi.validateJoin(gameCode, token),
      showToast: (message, type) => deps.ui.overlay.showToast(message, type),
      exitToMenu: () => exitToMenuFromMain(deps),
    },
    code,
    playerToken,
  );
};

export const handleServerMessageFromMain = (
  deps: SharedMainNetworkDeps,
  msg: S2C,
  onGameOver: () => void,
): void => {
  const handlerDeps: MessageHandlerDeps = createMainMessageHandlerDeps({
    ctx: deps.ctx,
    renderer: deps.renderer,
    ui: deps.ui,
    hud: deps.hud,
    actionDeps: deps.actionDeps,
    turnTelemetry: deps.turnTelemetry,
    sessionApi: deps.sessionApi,
    setState: (state) => deps.setState(state),
    applyGameState: (state) => deps.applyGameState(state),
    transitionToPhase: () => deps.transitionToPhase(),
    onAnimationComplete: () => deps.onAnimationComplete(),
    logScenarioBriefing: () => deps.hud.logScenarioBriefing(),
    trackEvent: (event, props) => deps.track(event, props),
  });
  handleServerMessage(handlerDeps, msg);

  if (msg.type === 'gameOver') {
    onGameOver();
  }
};

export const exitToMenuFromMain = (deps: SharedMainNetworkDeps): void => {
  exitToMenuSession({
    ctx: deps.ctx,
    stopPing: () => deps.connection.stopPing(),
    stopTurnTimer: () => deps.stopTurnTimer(),
    closeConnection: () => deps.connection.close(),
    resetTurnTelemetry: () => deps.turnTelemetry.reset(),
    replaceRoute: (route) => history.replaceState(null, '', route),
    setState: (state) => deps.setState(state),
  });
};
