import type { GameState } from '../../shared/types/domain';
import { hide } from '../dom';
import type { Renderer } from '../renderer/renderer';
import type { Tutorial } from '../tutorial';
import type { UIManager } from '../ui/ui';
import type { ActionDeps } from './action-deps';
import type { HudController } from './hud-controller';
import type { LogisticsUIState } from './logistics-ui';
import type { MessageHandlerDeps } from './message-handler';
import type { ClientState } from './phase';
import type { PhaseControllerDeps } from './phase-controller';
import type { ClientSession } from './session-model';
import type { StateTransitionDeps } from './state-transition';
import type { TurnTimerManager } from './timer';
import type { TurnTelemetryTracker } from './turn-telemetry';

interface SharedMainDepsArgs {
  ctx: ClientSession;
  renderer: Renderer;
  ui: UIManager;
  hud: HudController;
  actionDeps: ActionDeps;
  turnTelemetry: TurnTelemetryTracker;
}

/** State transitions do not touch `HudController`; HUD refresh is mirror-driven. */
export interface MainStateTransitionDepsArgs {
  ctx: ClientSession;
  renderer: Renderer;
  ui: UIManager;
  actionDeps: ActionDeps;
  turnTelemetry: TurnTelemetryTracker;
  tutorial: Tutorial;
  turnTimer: TurnTimerManager;
  tooltipEl: HTMLElement;
  resetCombatState: () => void;
  startCombatTargetWatch: () => void;
  setLogisticsUIState: (state: LogisticsUIState | null) => void;
  renderLogisticsPanel: () => void;
}

/** Built once per client; `ctx` is read via getter so transitions always see current session. */
export const createMainStateTransitionDeps = (
  args: MainStateTransitionDepsArgs,
): StateTransitionDeps => ({
  get ctx() {
    return args.ctx;
  },
  ui: args.ui,
  tutorial: args.tutorial,
  renderer: args.renderer,
  turnTimer: args.turnTimer,
  onStateChanged: (prevState, nextState) =>
    args.turnTelemetry.onStateChanged(prevState, nextState),
  hideTooltip: () => hide(args.tooltipEl),
  resetCombatState: () => args.resetCombatState(),
  startCombatTargetWatch: () => args.startCombatTargetWatch(),
  setLogisticsUIState: (state) => args.setLogisticsUIState(state),
  renderLogisticsPanel: () => args.renderLogisticsPanel(),
});

export interface MainMessageHandlerDepsArgs extends SharedMainDepsArgs {
  sessionApi: {
    storePlayerToken: (code: string, token: string) => void;
  };
  setState: (state: ClientState) => void;
  applyGameState: (state: GameState) => void;
  transitionToPhase: () => void;
  onAnimationComplete: () => void;
  logScenarioBriefing: () => void;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
}

export const createMainMessageHandlerDeps = (
  args: MainMessageHandlerDepsArgs,
): MessageHandlerDeps => ({
  ctx: args.ctx,
  setState: (state) => args.setState(state),
  applyGameState: (state) => args.applyGameState(state),
  transitionToPhase: () => args.transitionToPhase(),
  presentMovementResult: (
    state,
    movements,
    ordnanceMovements,
    events,
    onComplete,
  ) =>
    args.actionDeps.presentMovementResult(
      state,
      movements,
      ordnanceMovements,
      events,
      onComplete,
    ),
  presentCombatResults: (prev, state, results) =>
    args.actionDeps.presentCombatResults(prev, state, results),
  showGameOverOutcome: (won, reason) =>
    args.actionDeps.showGameOverOutcome(won, reason),
  storePlayerToken: (code, token) =>
    args.sessionApi.storePlayerToken(code, token),
  resetTurnTelemetry: () => args.turnTelemetry.reset(),
  onAnimationComplete: () => args.onAnimationComplete(),
  logScenarioBriefing: () => args.logScenarioBriefing(),
  trackEvent: (event, props) => args.trackEvent(event, props),
  deserializeState: (raw) => raw,
  renderer: args.renderer,
  ui: args.ui,
});

export interface MainPhaseTransitionDepsArgs extends SharedMainDepsArgs {
  setState: (state: ClientState) => void;
  runLocalAI: () => void;
  beginCombat: () => void;
}

/** Built once per client; phase reads use getters so each transition sees live session/telemetry. */
export const createMainPhaseTransitionDeps = (
  args: MainPhaseTransitionDepsArgs,
): PhaseControllerDeps => ({
  get gameState() {
    return args.ctx.gameState;
  },
  get playerId() {
    return args.ctx.playerId;
  },
  get lastLoggedTurn() {
    return args.turnTelemetry.getLastLoggedTurn();
  },
  get isLocalGame() {
    return args.ctx.isLocalGame;
  },
  get scenario() {
    return args.ctx.scenario;
  },
  onTurnLogged: (turnNumber, context) =>
    args.turnTelemetry.onTurnLogged(turnNumber, context),
  logTurn: (turnNumber, playerLabel) =>
    args.ui.log.logTurn(turnNumber, playerLabel),
  beginCombat: () => args.beginCombat(),
  setState: (state) => args.setState(state),
  runLocalAI: () => args.runLocalAI(),
});
