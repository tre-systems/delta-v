import { must } from '../../shared/assert';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { batch } from '../reactive';
import { createLogisticsStore } from './logistics-store';
import type { ClientState } from './phase';
import { deriveClientStateEntryPlan } from './phase-entry';
import type { ClientSessionStateTransitionContext } from './session-model';

interface TransitionUI {
  showFleetBuilding: (state: GameState, playerId: PlayerId) => void;
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

    if (newState === 'playing_fleetBuilding') {
      deps.ui.showFleetBuilding(
        must(deps.ctx.gameState),
        deps.ctx.playerId as PlayerId,
      );
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

    if (entryPlan.planningPhaseEntry) {
      deps.ctx.planningState.enterPhase(
        entryPlan.planningPhaseEntry.phase,
        entryPlan.planningPhaseEntry.selectedShipId,
      );
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
