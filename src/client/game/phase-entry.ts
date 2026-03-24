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
  frameOnShips: boolean;
  clearAstrogationPlanning: boolean;
  selectedShipId: string | null | undefined;
  resetCombatState: boolean;
  clearAttackButton: boolean;
  startCombatTargetWatch: boolean;
  tutorialPhase: 'astrogation' | 'ordnance' | 'combat' | null;
}

const getFirstActionableShipId = (
  gameState: GameState | null,
  playerId: number,
): string | null => {
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
  playerId: number,
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
        showMovementStatus: false,
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
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        frameOnShips: true,
        clearAstrogationPlanning: true,
        selectedShipId: getFirstActionableShipId(gameState, playerId),
        resetCombatState: false,
        clearAttackButton: false,
        startCombatTargetWatch: false,
        tutorialPhase: gameState ? 'astrogation' : null,
      };
    case 'playing_ordnance':
      return {
        stopTurnTimer: false,
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: getUnambiguousLaunchableShipId(
          gameState ?? {
            ships: [],
            scenarioRules: {},
            pendingAstrogationOrders: null,
          },
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
        startTurnTimer: !isLocalGame,
        hideTutorial: true,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
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
        startTurnTimer: !isLocalGame,
        hideTutorial: false,
        resetCamera: false,
        showHUD: true,
        showMovementStatus: false,
        frameOnShips: false,
        clearAstrogationPlanning: false,
        selectedShipId: getFirstActionableShipId(gameState, playerId),
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
