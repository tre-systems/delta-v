import type { GameState, PlayerId } from '../../shared/types/domain';

export type ClientState =
  | 'menu'
  | 'connecting'
  | 'waitingForOpponent'
  | 'playing_fleetBuilding'
  | 'playing_astrogation'
  | 'playing_ordnance'
  | 'playing_logistics'
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

type ActiveTurnPhase = Extract<
  GameState['phase'],
  'astrogation' | 'ordnance' | 'logistics' | 'combat'
>;

const hasPendingOwnedAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
): boolean => {
  return state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });
};

const ACTIVE_TURN_PLANS: Record<
  ActiveTurnPhase,
  { nextState: ClientState; banner: string }
> = {
  astrogation: { nextState: 'playing_astrogation', banner: 'YOUR TURN' },
  ordnance: { nextState: 'playing_ordnance', banner: 'ORDNANCE' },
  logistics: { nextState: 'playing_logistics', banner: 'LOGISTICS' },
  combat: { nextState: 'playing_combat', banner: 'COMBAT' },
};

export const derivePhaseTransition = (
  state: GameState,
  playerId: number,
  lastLoggedTurn: number,
  isLocalGame: boolean,
): PhaseTransitionPlan => {
  const shouldLogTurn =
    state.phase === 'astrogation' && state.turnNumber !== lastLoggedTurn;
  const turnLogNumber = shouldLogTurn ? state.turnNumber : null;

  if (playerId < 0) {
    const turnLogPlayerLabel = shouldLogTurn
      ? `Player ${state.activePlayer}`
      : null;
    return {
      nextState:
        state.phase === 'fleetBuilding'
          ? 'playing_fleetBuilding'
          : 'playing_opponentTurn',
      banner: null,
      playPhaseSound: false,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber,
      turnLogPlayerLabel,
    };
  }

  const turnLogPlayerLabel = shouldLogTurn
    ? state.activePlayer === playerId
      ? 'You'
      : 'Opponent'
    : null;

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

  if (isMyTurn) {
    if (
      state.phase === 'combat' &&
      hasPendingOwnedAsteroidHazards(state, playerId)
    ) {
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

    const activeTurnPlan = ACTIVE_TURN_PLANS[state.phase as ActiveTurnPhase];
    if (activeTurnPlan) {
      return {
        nextState: activeTurnPlan.nextState,
        banner: activeTurnPlan.banner,
        playPhaseSound: true,
        beginCombatPhase: false,
        runLocalAI: false,
        turnLogNumber,
        turnLogPlayerLabel,
      };
    }
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
