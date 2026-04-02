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

export const deriveClientStateEntryPlan = (
  state: ClientState,
  gameState: GameState | null,
  playerId: PlayerId | -1,
  isLocalGame = false,
): ClientStateEntryPlan => {
  switch (state) {
    case 'menu':
      return {
        stopTurnTimer: false,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: true,

        frameOnShips: false,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_astrogation':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,

        frameOnShips: true,
        planningPhaseEntry: {
          phase: 'astrogation',
          selectedShipId: getFirstActionableShipId(gameState, playerId),
        },
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: gameState ? 'astrogation' : null,
      };
    case 'playing_ordnance':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: {
          phase: 'ordnance',
          selectedShipId: getFirstLaunchableShipId(
            gameState ?? {
              ships: [],
              scenarioRules: {},
              pendingAstrogationOrders: null,
            },
            playerId as PlayerId,
          ),
        },
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: gameState ? 'ordnance' : null,
      };
    case 'playing_logistics':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: true,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_combat':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: {
          phase: 'combat',
          selectedShipId: getFirstActionableShipId(gameState, playerId),
        },
        autoSkipCombatIfNoTargets: true,
        tutorialPhase: gameState ? 'combat' : null,
      };
    case 'playing_movementAnim':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_opponentTurn':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,

        frameOnShips: true,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'gameOver':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    default:
      return {
        stopTurnTimer: false,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,

        frameOnShips: false,
        planningPhaseEntry: null,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
  }
};
