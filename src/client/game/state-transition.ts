import { must } from '../../shared/assert';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { LogisticsUIState } from './logistics-ui';
import { createLogisticsUIState } from './logistics-ui';
import type { ClientState } from './phase';
import { deriveClientStateEntryPlan } from './phase-entry';
import { resetAstrogationPlanning, setSelectedShipId } from './planning-store';
import { deriveClientScreenPlan } from './screen';
import type { ClientSessionStateTransitionContext } from './session-model';

interface TransitionUI {
  showMenu: () => void;
  showConnecting: () => void;
  showWaiting: (code: string) => void;
  showFleetBuilding: (state: GameState, playerId: PlayerId) => void;
  showHUD: () => void;
  showAttackButton: (visible: boolean) => void;
  showMovementStatus: () => void;
}

interface TransitionTutorial {
  hideTip: () => void;
  onPhaseChange: (
    phase: 'astrogation' | 'ordnance' | 'combat',
    turnNumber: number,
  ) => void;
}

interface TransitionRenderer {
  resetCamera: () => void;
  frameOnShips: () => void;
}

interface TransitionTurnTimer {
  start: () => void;
  stop: () => void;
}

export interface StateTransitionDeps {
  ctx: ClientSessionStateTransitionContext;
  ui: TransitionUI;
  tutorial: TransitionTutorial;
  renderer: TransitionRenderer;
  turnTimer: TransitionTurnTimer;
  onStateChanged: (prevState: ClientState, nextState: ClientState) => void;
  hideTooltip: () => void;
  resetCombatState: () => void;
  startCombatTargetWatch: () => void;
  setLogisticsUIState: (state: LogisticsUIState | null) => void;
  renderLogisticsPanel: () => void;
}

export const applyClientStateTransition = (
  deps: StateTransitionDeps,
  newState: ClientState,
): void => {
  const prevState = deps.ctx.state;
  deps.ctx.state = newState;
  deps.onStateChanged(prevState, newState);
  deps.hideTooltip();

  const entryPlan = deriveClientStateEntryPlan(
    newState,
    deps.ctx.gameState,
    deps.ctx.playerId as PlayerId,
    deps.ctx.isLocalGame,
  );
  const screenPlan = deriveClientScreenPlan(newState, deps.ctx.gameCode);

  switch (screenPlan.kind) {
    case 'menu':
      deps.ui.showMenu();
      break;
    case 'connecting':
      deps.ui.showConnecting();
      break;
    case 'waiting':
      deps.ui.showWaiting(screenPlan.code);
      break;
    case 'fleetBuilding':
      deps.ui.showFleetBuilding(
        must(deps.ctx.gameState),
        deps.ctx.playerId as PlayerId,
      );
      break;
    case 'hud':
      deps.ui.showHUD();
      break;
    case 'none':
      break;
  }

  if (entryPlan.hideTutorial) {
    deps.tutorial.hideTip();
  }

  if (entryPlan.resetCamera) {
    deps.renderer.resetCamera();
  }

  if (entryPlan.stopTurnTimer) {
    deps.turnTimer.stop();
  }

  if (entryPlan.startTurnTimer) {
    deps.turnTimer.start();
  }

  if (entryPlan.clearAstrogationPlanning) {
    resetAstrogationPlanning(deps.ctx.planningState);
  }

  if (entryPlan.selectedShipId !== undefined) {
    setSelectedShipId(deps.ctx.planningState, entryPlan.selectedShipId);
  }

  if (entryPlan.resetCombatState) {
    deps.resetCombatState();
  }

  if (entryPlan.clearAttackButton) {
    deps.ui.showAttackButton(false);
  }

  if (entryPlan.showMovementStatus) {
    deps.ui.showMovementStatus();
  }

  if (entryPlan.startCombatTargetWatch) {
    deps.startCombatTargetWatch();
  }

  if (entryPlan.tutorialPhase && deps.ctx.gameState) {
    deps.tutorial.onPhaseChange(
      entryPlan.tutorialPhase,
      deps.ctx.gameState.turnNumber,
    );
  }

  if (entryPlan.frameOnShips) {
    deps.renderer.frameOnShips();
  }

  if (newState === 'playing_logistics' && deps.ctx.gameState) {
    deps.setLogisticsUIState(
      createLogisticsUIState(deps.ctx.gameState, deps.ctx.playerId as PlayerId),
    );
    deps.renderLogisticsPanel();
  } else {
    deps.setLogisticsUIState(null);
  }
};
