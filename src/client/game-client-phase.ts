import type { GameState } from '../shared/types';

export type ClientState =
  | 'menu'
  | 'connecting'
  | 'waitingForOpponent'
  | 'playing_fleetBuilding'
  | 'playing_astrogation'
  | 'playing_ordnance'
  | 'playing_combat'
  | 'playing_movementAnim'
  | 'playing_opponentTurn'
  | 'gameOver';

export interface PhaseTransitionPlan {
  nextState: ClientState | null;
  banner: string | null;
  playPhaseSound: boolean;
  beginCombatPhase: boolean;
  runLocalAI: boolean;
  turnLogNumber: number | null;
  turnLogPlayerLabel: string | null;
}

const hasPendingOwnedAsteroidHazards = (state: GameState, playerId: number): boolean => {
  return state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find((candidate) => candidate.id === hazard.shipId);
    return ship?.owner === playerId && !ship.destroyed;
  });
};

export const derivePhaseTransition = (
  state: GameState,
  playerId: number,
  lastLoggedTurn: number,
  isLocalGame: boolean,
): PhaseTransitionPlan => {
  const shouldLogTurn = state.phase === 'astrogation' && state.turnNumber !== lastLoggedTurn;
  const turnLogPlayerLabel = shouldLogTurn ? (state.activePlayer === playerId ? 'You' : 'Opponent') : null;
  const turnLogNumber = shouldLogTurn ? state.turnNumber : null;

  if (state.phase === 'fleetBuilding') {
    return {
      nextState: state.players[playerId].ready ? null : 'playing_fleetBuilding',
      banner: null,
      playPhaseSound: false,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber,
      turnLogPlayerLabel,
    };
  }

  const isMyTurn = state.activePlayer === playerId;
  if (state.phase === 'combat' && isMyTurn) {
    if (hasPendingOwnedAsteroidHazards(state, playerId)) {
      return {
        nextState: null,
        banner: null,
        playPhaseSound: false,
        beginCombatPhase: true,
        runLocalAI: false,
        turnLogNumber,
        turnLogPlayerLabel,
      };
    }
    return {
      nextState: 'playing_combat',
      banner: 'COMBAT',
      playPhaseSound: true,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber,
      turnLogPlayerLabel,
    };
  }

  if (state.phase === 'ordnance' && isMyTurn) {
    return {
      nextState: 'playing_ordnance',
      banner: 'ORDNANCE',
      playPhaseSound: true,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber,
      turnLogPlayerLabel,
    };
  }

  if (state.phase === 'astrogation' && isMyTurn) {
    return {
      nextState: 'playing_astrogation',
      banner: 'YOUR TURN',
      playPhaseSound: true,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber,
      turnLogPlayerLabel,
    };
  }

  return {
    nextState: 'playing_opponentTurn',
    banner: null,
    playPhaseSound: false,
    beginCombatPhase: false,
    runLocalAI: isLocalGame && state.activePlayer !== playerId,
    turnLogNumber,
    turnLogPlayerLabel,
  };
};
