import type { GameState, PlayerId } from '../../shared/types/domain';
import { getFirstLaunchableShipId } from './ordnance';
import type { ClientState } from './phase';
import type { PlanningPhase } from './planning';

export interface PlanningPhaseEntry {
  phase: PlanningPhase;
  selectedShipId: string | null;
}

export interface ClientStateEntryPlan {
  stopTurnTimer: boolean;
  startTurnTimer: boolean;
  hideTutorial: boolean;
  resetCamera: boolean;

  frameOnShips: boolean;
  planningPhaseEntry: PlanningPhaseEntry | null;
  autoSkipCombatIfNoTargets: boolean;
  tutorialPhase: 'astrogation' | 'ordnance' | 'combat' | null;
}

interface ClientStateEntryRule {
  stopTurnTimer?: boolean;
  startTurnTimer?: boolean | ((isLocalGame: boolean) => boolean);
  hideTutorial?: boolean;
  resetCamera?: boolean;
  frameOnShips?: boolean;
  planningPhase?: PlanningPhase;
  deriveSelectedShipId?: (
    gameState: GameState | null,
    playerId: PlayerId | -1,
  ) => string | null;
  autoSkipCombatIfNoTargets?: boolean;
  tutorialPhase?: PlanningPhase;
}

const getFirstActionableShipId = (
  gameState: GameState | null,
  playerId: PlayerId | -1,
): string | null => {
  if (playerId < 0) return null;
  if (!gameState) return null;
  const actionable = gameState.ships.find(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.damage.disabledTurns === 0,
  );
  return actionable?.id ?? null;
};

const getFirstLaunchableShipIdForEntry = (
  gameState: GameState | null,
  playerId: PlayerId | -1,
): string | null => {
  if (playerId < 0) return null;
  return getFirstLaunchableShipId(
    gameState ?? {
      ships: [],
      scenarioRules: {},
      pendingAstrogationOrders: null,
    },
    playerId as PlayerId,
  );
};

const DEFAULT_ENTRY_PLAN: Omit<
  ClientStateEntryPlan,
  'planningPhaseEntry' | 'tutorialPhase'
> = {
  stopTurnTimer: false,
  startTurnTimer: false,
  hideTutorial: false,
  resetCamera: false,
  frameOnShips: false,
  autoSkipCombatIfNoTargets: false,
};

const startRemoteTurnTimer = (isLocalGame: boolean): boolean => !isLocalGame;

const CLIENT_STATE_ENTRY_RULES: Record<ClientState, ClientStateEntryRule> = {
  menu: {
    hideTutorial: true,
    resetCamera: true,
  },
  connecting: {},
  waitingForOpponent: {},
  playing_fleetBuilding: {},
  playing_astrogation: {
    startTurnTimer: startRemoteTurnTimer,
    frameOnShips: true,
    planningPhase: 'astrogation',
    deriveSelectedShipId: getFirstActionableShipId,
    tutorialPhase: 'astrogation',
  },
  playing_ordnance: {
    startTurnTimer: startRemoteTurnTimer,
    planningPhase: 'ordnance',
    deriveSelectedShipId: getFirstLaunchableShipIdForEntry,
    tutorialPhase: 'ordnance',
  },
  playing_logistics: {
    startTurnTimer: startRemoteTurnTimer,
    hideTutorial: true,
  },
  playing_combat: {
    startTurnTimer: startRemoteTurnTimer,
    planningPhase: 'combat',
    deriveSelectedShipId: getFirstActionableShipId,
    autoSkipCombatIfNoTargets: true,
    tutorialPhase: 'combat',
  },
  playing_movementAnim: {
    stopTurnTimer: true,
    hideTutorial: true,
  },
  playing_opponentTurn: {
    stopTurnTimer: true,
    frameOnShips: true,
  },
  gameOver: {
    stopTurnTimer: true,
    hideTutorial: true,
  },
};

export const deriveClientStateEntryPlan = (
  state: ClientState,
  gameState: GameState | null,
  playerId: PlayerId | -1,
  isLocalGame = false,
): ClientStateEntryPlan => {
  const rule = CLIENT_STATE_ENTRY_RULES[state];
  const startTurnTimer =
    typeof rule.startTurnTimer === 'function'
      ? rule.startTurnTimer(isLocalGame)
      : (rule.startTurnTimer ?? DEFAULT_ENTRY_PLAN.startTurnTimer);

  return {
    stopTurnTimer: rule.stopTurnTimer ?? DEFAULT_ENTRY_PLAN.stopTurnTimer,
    startTurnTimer,
    hideTutorial: rule.hideTutorial ?? DEFAULT_ENTRY_PLAN.hideTutorial,
    resetCamera: rule.resetCamera ?? DEFAULT_ENTRY_PLAN.resetCamera,
    frameOnShips: rule.frameOnShips ?? DEFAULT_ENTRY_PLAN.frameOnShips,
    planningPhaseEntry: rule.planningPhase
      ? {
          phase: rule.planningPhase,
          selectedShipId:
            rule.deriveSelectedShipId?.(gameState, playerId) ?? null,
        }
      : null,
    autoSkipCombatIfNoTargets:
      rule.autoSkipCombatIfNoTargets ??
      DEFAULT_ENTRY_PLAN.autoSkipCombatIfNoTargets,
    tutorialPhase: rule.tutorialPhase && gameState ? rule.tutorialPhase : null,
  };
};
