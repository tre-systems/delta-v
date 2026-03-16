import type { GameState } from '../shared/types';
import { getFirstLaunchableShipId } from './game-client-ordnance';
import type { ClientState } from './game-client-phase';

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

function getFirstOwnedShipId(gameState: GameState | null, playerId: number): string | null {
  return gameState?.ships.find(ship => ship.owner === playerId && !ship.destroyed)?.id ?? null;
}

export function deriveClientStateEntryPlan(
  state: ClientState,
  gameState: GameState | null,
  playerId: number,
): ClientStateEntryPlan {
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
        selectedShipId: getFirstOwnedShipId(gameState, playerId),
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
        selectedShipId: getFirstLaunchableShipId(gameState ?? { ships: [] }, playerId),
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: gameState ? 'ordnance' : null,
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
    case 'connecting':
    case 'waitingForOpponent':
    case 'playing_fleetBuilding':
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
}
