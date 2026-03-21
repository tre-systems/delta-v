import type { GameState } from '../../shared/types/domain';
import { getUnambiguousLaunchableShipId } from './ordnance';
import type { ClientState } from './phase';

export interface ClientStateEntryPlan {
  stopTurnTimer: boolean;
  startTurnTimer: boolean;
  hideTutorial: boolean;
  resetCamera: boolean;
  showHUD: boolean;
  showMovementStatus: boolean;
  updateHUD: boolean;
  frameOnShips: boolean;
  clearAstrogationPlanning: boolean;
  selectedShipId: string | null | undefined;
  resetCombatState: boolean;
  clearAttackButton: boolean;
  startCombatTargetWatch: boolean;
  tutorialPhase: 'astrogation' | 'ordnance' | 'combat' | null;
}

const getUnambiguousOwnedShipId = (
  gameState: GameState | null,
  playerId: number,
): string | null => {
  if (!gameState) return null;
  const alive = gameState.ships.filter(
    (ship) => ship.owner === playerId && !ship.destroyed,
  );
  return alive.length === 1 ? alive[0].id : null;
};

export const deriveClientStateEntryPlan = (
  state: ClientState,
  gameState: GameState | null,
  playerId: number,
): ClientStateEntryPlan => {
  switch (state) {
    case 'menu':
      return {
        stopTurnTimer: false,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: true,
        showHUD: false,
        showMovementStatus: false,
        updateHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
    case 'playing_astrogation':
      return {
        stopTurnTimer: false,
        startTurnTimer: true,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        updateHUD: true,
        frameOnShips: true,
        clearAstrogationPlanning: true,
        selectedShipId: getUnambiguousOwnedShipId(gameState, playerId),
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: gameState ? 'astrogation' : null,
      };
    case 'playing_ordnance':
      return {
        stopTurnTimer: false,
        startTurnTimer: true,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        updateHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: getUnambiguousLaunchableShipId(
          gameState ?? { ships: [], scenarioRules: {} },
          playerId,
        ),
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: gameState ? 'ordnance' : null,
      };
    case 'playing_logistics':
      return {
        stopTurnTimer: false,
        startTurnTimer: true,
        hideTutorial: true,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        updateHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
    case 'playing_combat':
      return {
        stopTurnTimer: false,
        startTurnTimer: true,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        updateHUD: true,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: true,
        clearAttackButton: true,
        startCombatTargetWatch: true,
        tutorialPhase: gameState ? 'combat' : null,
      };
    case 'playing_movementAnim':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: true,
        updateHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
    case 'playing_opponentTurn':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        updateHUD: true,
        frameOnShips: true,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
    case 'gameOver':
      return {
        stopTurnTimer: true,
        startTurnTimer: false,
        hideTutorial: true,
        resetCamera: false,
        showHUD: false,
        showMovementStatus: false,
        updateHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
    default:
      return {
        stopTurnTimer: false,
        startTurnTimer: false,
        hideTutorial: false,
        resetCamera: false,
        showHUD: false,
        showMovementStatus: false,
        updateHUD: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: undefined,
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: null,
      };
  }
};
