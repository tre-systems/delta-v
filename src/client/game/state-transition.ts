import { must } from '../../shared/assert';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { batch } from '../reactive';
import type { InteractionEvent } from './interaction-fsm';
import { applyInteractionEvent } from './interaction-fsm';
import { createLogisticsStore } from './logistics-ui';
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
  resetCombatState: () => void;
  autoSkipCombatIfNoTargets: () => void;
}

const deriveInteractionEvent = (state: ClientState): InteractionEvent => {
  switch (state) {
    case 'menu':
      return { type: 'ENTER_MENU' };
    case 'connecting':
    case 'waitingForOpponent':
      return { type: 'ENTER_WAITING' };
    case 'playing_fleetBuilding':
      return { type: 'ENTER_FLEETBUILDING' };
    case 'playing_astrogation':
      return { type: 'ENTER_ASTROGATION' };
    case 'playing_ordnance':
      return { type: 'ENTER_ORDNANCE' };
    case 'playing_logistics':
      return { type: 'ENTER_LOGISTICS' };
    case 'playing_combat':
      return { type: 'ENTER_COMBAT' };
    case 'playing_movementAnim':
      return { type: 'ENTER_ANIMATING' };
    case 'playing_opponentTurn':
      return { type: 'ENTER_OPPONENT_TURN' };
    case 'gameOver':
      return { type: 'ENTER_GAME_OVER' };
  }
};

export const applyClientStateTransition = (
  deps: StateTransitionDeps,
  newState: ClientState,
): void => {
  batch(() => {
    const prevState = deps.ctx.state;
    deps.ctx.state = newState;

    const interactionEvent = deriveInteractionEvent(newState);
    const prevInteraction = deps.ctx.interactionState;
    deps.ctx.interactionState = applyInteractionEvent(
      prevInteraction,
      interactionEvent,
    );

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

    if (entryPlan.clearAstrogationPlanning) {
      deps.ctx.planningState.resetAstrogationPlanning();
    }

    if (entryPlan.resetOrdnancePlanning) {
      deps.ctx.planningState.resetOrdnancePlanning();
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
