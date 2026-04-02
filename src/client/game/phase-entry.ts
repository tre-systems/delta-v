import type { GameState, PlayerId } from '../../shared/types/domain';
import { getFirstLaunchableShipId } from './ordnance';
import type { ClientState } from './phase';

export interface ClientStateEntryPlan {
  stopTurnTimer: boolean;
  startTurnTimer: boolean;
  hideTutorial: boolean;
  resetCamera: boolean;
  showHUD: boolean;
  frameOnShips: boolean;
  clearAstrogationPlanning: boolean;
  resetOrdnancePlanning: boolean;
  selectedShipId: string | null | undefined;
  resetCombatState: boolean;
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
        showHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_astrogation':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        frameOnShips: true,
        clearAstrogationPlanning: true,
        resetOrdnancePlanning: false,
        selectedShipId: getFirstActionableShipId(gameState, playerId),
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: gameState ? 'astrogation' : null,
      };
    case 'playing_ordnance':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: true,
        selectedShipId: getFirstLaunchableShipId(
          gameState ?? {
            ships: [],
            scenarioRules: {},
            pendingAstrogationOrders: null,
          },
          playerId as PlayerId,
        ),
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: gameState ? 'ordnance' : null,
      };
    case 'playing_logistics':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: true,
        resetCamera: false,
        showHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_combat':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: getFirstActionableShipId(gameState, playerId),
        resetCombatState: true,
        autoSkipCombatIfNoTargets: true,
        tutorialPhase: gameState ? 'combat' : null,
      };
    case 'playing_movementAnim':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,
        showHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'playing_opponentTurn':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        frameOnShips: true,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    case 'gameOver':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,
        showHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
    default:
      return {
        stopTurnTimer: false,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,
        showHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        resetOrdnancePlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        autoSkipCombatIfNoTargets: false,
        tutorialPhase: null,
      };
  }
};
