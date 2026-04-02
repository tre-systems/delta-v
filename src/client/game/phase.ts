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

type TransitionPlanOverrides = Omit<
  PhaseTransitionPlan,
  'turnLogNumber' | 'turnLogPlayerLabel'
>;

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

const DEFAULT_TRANSITION_PLAN: TransitionPlanOverrides = {
  nextState: null,
  banner: null,
  playPhaseSound: false,
  beginCombatPhase: false,
  runLocalAI: false,
};

const SPECTATOR_PHASE_TRANSITIONS: Partial<
  Record<GameState['phase'], Partial<TransitionPlanOverrides>>
> = {
  fleetBuilding: {
    nextState: 'playing_fleetBuilding',
  },
};

const ACTIVE_TURN_PHASE_TRANSITIONS: Record<
  ActiveTurnPhase,
  Partial<TransitionPlanOverrides>
> = {
  astrogation: {
    nextState: 'playing_astrogation',
    banner: 'YOUR TURN',
    playPhaseSound: true,
  },
  ordnance: {
    nextState: 'playing_ordnance',
    banner: 'ORDNANCE',
    playPhaseSound: true,
  },
  logistics: {
    nextState: 'playing_logistics',
    banner: 'LOGISTICS',
    playPhaseSound: true,
  },
  combat: {
    nextState: 'playing_combat',
    banner: 'COMBAT',
    playPhaseSound: true,
  },
};

const createPhaseTransitionPlan = (
  overrides: Partial<TransitionPlanOverrides>,
  turnLogNumber: number | null,
  turnLogPlayerLabel: string | null,
): PhaseTransitionPlan => ({
  ...DEFAULT_TRANSITION_PLAN,
  ...overrides,
  turnLogNumber,
  turnLogPlayerLabel,
});

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
    const spectatorTurnLabel = shouldLogTurn
      ? `Player ${state.activePlayer}`
      : null;

    return createPhaseTransitionPlan(
      state.phase === 'fleetBuilding'
        ? (SPECTATOR_PHASE_TRANSITIONS[state.phase] ?? {})
        : { nextState: 'playing_opponentTurn' },
      turnLogNumber,
      spectatorTurnLabel,
    );
  }

  const turnLogPlayerLabel = shouldLogTurn
    ? state.activePlayer === playerId
      ? 'You'
      : 'Opponent'
    : null;

  if (state.phase === 'fleetBuilding') {
    return createPhaseTransitionPlan(
      {
        nextState: state.players[playerId].ready
          ? null
          : 'playing_fleetBuilding',
      },
      turnLogNumber,
      turnLogPlayerLabel,
    );
  }

  const isMyTurn = state.activePlayer === playerId;

  if (isMyTurn) {
    if (
      state.phase === 'combat' &&
      hasPendingOwnedAsteroidHazards(state, playerId)
    ) {
      return createPhaseTransitionPlan(
        {
          beginCombatPhase: true,
        },
        turnLogNumber,
        turnLogPlayerLabel,
      );
    }

    const activeTurnPhaseTransition =
      ACTIVE_TURN_PHASE_TRANSITIONS[state.phase as ActiveTurnPhase];
    if (activeTurnPhaseTransition) {
      return createPhaseTransitionPlan(
        activeTurnPhaseTransition,
        turnLogNumber,
        turnLogPlayerLabel,
      );
    }
  }

  return createPhaseTransitionPlan(
    {
      nextState: 'playing_opponentTurn',
      runLocalAI: isLocalGame && state.activePlayer !== playerId,
    },
    turnLogNumber,
    turnLogPlayerLabel,
  );
};
