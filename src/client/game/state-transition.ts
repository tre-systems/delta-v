import { must } from '../../shared/assert';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { batch } from '../reactive';
import { createLogisticsStore } from './logistics-ui';
import type { ClientState } from './phase';
import { deriveClientStateEntryPlan } from './phase-entry';
import { deriveClientScreenPlan } from './screen';
import type { ClientSessionStateTransitionContext } from './session-model';

interface TransitionUI {
  showMenu: () => void;
  showConnecting: () => void;
  showWaiting: (code: string) => void;
  showFleetBuilding: (state: GameState, playerId: PlayerId) => void;
  showHUD: () => void;
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
  autoSkipCombatIfNoTargets: () => void;
}

export const applyClientStateTransition = (
  deps: StateTransitionDeps,
  newState: ClientState,
): void => {
  batch(() => {
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
      deps.ctx.planningState.resetAstrogationPlanning();
    }

    if (entryPlan.selectedShipId !== undefined) {
      deps.ctx.planningState.setSelectedShipId(entryPlan.selectedShipId);
    }

    if (entryPlan.resetCombatState) {
      deps.resetCombatState();
    }

    if (entryPlan.autoSkipCombatIfNoTargets) {
      deps.autoSkipCombatIfNoTargets();
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
      deps.ctx.logisticsState = createLogisticsStore(
        deps.ctx.gameState,
        deps.ctx.playerId as PlayerId,
      );
    } else {
      deps.ctx.logisticsState = null;
    }
  });
};
