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

const BASE_ENTRY_PLAN: ClientStateEntryPlan = {
  stopTurnTimer: false,
  startTurnTimer: false,
  hideTutorial: false,
  resetCamera: false,
  frameOnShips: false,
  planningPhaseEntry: null,
  autoSkipCombatIfNoTargets: false,
  tutorialPhase: null,
};

export const deriveClientStateEntryPlan = (
  state: ClientState,
  gameState: GameState | null,
  playerId: PlayerId | -1,
  isLocalGame = false,
  map?: SolarSystemMap | null,
): ClientStateEntryPlan => {
  switch (state) {
    case 'menu':
      return {
        ...BASE_ENTRY_PLAN,
        hideTutorial: true,
        resetCamera: true,
      };
    case 'playing_astrogation':
      return {
        ...BASE_ENTRY_PLAN,
        startTurnTimer: !isLocalGame,
        frameOnShips: true,
        planningPhaseEntry: {
          phase: 'astrogation',
          selectedShipId: getFirstActionableShipId(gameState, playerId),
        },
        tutorialPhase: gameState ? 'astrogation' : null,
      };
    case 'playing_ordnance':
      return {
        ...BASE_ENTRY_PLAN,
        startTurnTimer: !isLocalGame,
        planningPhaseEntry: {
          phase: 'ordnance',
          selectedShipId:
            gameState && playerId >= 0
              ? getFirstOrdnanceActionableShipId(
                  gameState,
                  playerId as PlayerId,
                  map,
                )
              : null,
        },
        tutorialPhase: gameState ? 'ordnance' : null,
      };
    case 'playing_logistics':
      return {
        ...BASE_ENTRY_PLAN,
        startTurnTimer: !isLocalGame,
        hideTutorial: true,
      };
    case 'playing_combat':
      return {
        ...BASE_ENTRY_PLAN,
        startTurnTimer: !isLocalGame,
        planningPhaseEntry: {
          phase: 'combat',
          selectedShipId: getFirstActionableShipId(gameState, playerId),
        },
        autoSkipCombatIfNoTargets: true,
        tutorialPhase: gameState ? 'combat' : null,
      };
    case 'playing_movementAnim':
      return {
        ...BASE_ENTRY_PLAN,
        stopTurnTimer: true,
        hideTutorial: true,
      };
    case 'playing_opponentTurn':
      return {
        ...BASE_ENTRY_PLAN,
        stopTurnTimer: true,
        hideTutorial: true,
        frameOnShips: true,
      };
    case 'gameOver':
      return {
        ...BASE_ENTRY_PLAN,
        stopTurnTimer: true,
        hideTutorial: true,
      };
    case 'connecting':
    case 'waitingForOpponent':
    case 'playing_fleetBuilding':
      return BASE_ENTRY_PLAN;
  }
};
