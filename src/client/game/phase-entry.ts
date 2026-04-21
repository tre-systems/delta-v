import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { getFirstOrdnanceActionableShipId } from './ordnance';
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
    map?: SolarSystemMap | null,
  ) => string | null;
  autoSkipCombatIfNoTargets?: boolean;
  tutorialPhase?: PlanningPhase;
}

const getFirstActionableShipId = (
  gameState: GameState | null,
  playerId: PlayerId | -1,
  _map?: SolarSystemMap | null,
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

const CLIENT_STATE_ENTRY_RULES: Record<ClientState, ClientStateEntryRule> = {
  menu: {
    hideTutorial: true,
    resetCamera: true,
  },
  connecting: {},
  waitingForOpponent: {},
  playing_fleetBuilding: {},
  playing_astrogation: {
    startTurnTimer: (isLocalGame) => !isLocalGame,
    frameOnShips: true,
    planningPhase: 'astrogation',
    deriveSelectedShipId: getFirstActionableShipId,
    tutorialPhase: 'astrogation',
  },
  playing_ordnance: {
    startTurnTimer: (isLocalGame) => !isLocalGame,
    planningPhase: 'ordnance',
    deriveSelectedShipId: (gameState, playerId, map) =>
      gameState && playerId >= 0
        ? getFirstOrdnanceActionableShipId(gameState, playerId as PlayerId, map)
        : null,
    tutorialPhase: 'ordnance',
  },
  playing_logistics: {
    startTurnTimer: (isLocalGame) => !isLocalGame,
    hideTutorial: true,
  },
  playing_combat: {
    startTurnTimer: (isLocalGame) => !isLocalGame,
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
    hideTutorial: true,
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
  map?: SolarSystemMap | null,
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
            rule.deriveSelectedShipId?.(gameState, playerId, map) ?? null,
        }
      : null,
    autoSkipCombatIfNoTargets:
      rule.autoSkipCombatIfNoTargets ??
      DEFAULT_ENTRY_PLAN.autoSkipCombatIfNoTargets,
    tutorialPhase: rule.tutorialPhase && gameState ? rule.tutorialPhase : null,
  };
};
