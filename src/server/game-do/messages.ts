import type {
  CombatPhaseResult,
  MovementResult,
  StateUpdateResult,
} from '../../shared/engine/game-engine';
import type { GameEvent } from '../../shared/events';
import type { CombatResult, GameState, S2C } from '../../shared/types';

export type StatefulServerMessage = Extract<S2C, { state: GameState }>;

type MovementResolution = MovementResult | StateUpdateResult;

type CombatResolution =
  | StateUpdateResult
  | CombatPhaseResult
  | { state: GameState; results?: CombatResult[] };

export const toMovementResultMessage = ({
  movements,
  ordnanceMovements,
  events,
  state,
}: MovementResult): StatefulServerMessage => ({
  type: 'movementResult',
  movements,
  ordnanceMovements,
  events,
  state,
});

export const toCombatResultMessage = (
  state: GameState,
  results: CombatResult[],
): StatefulServerMessage => ({
  type: 'combatResult',
  results,
  state,
});

export const toStateUpdateMessage = (
  state: GameState,
): StatefulServerMessage => ({
  type: 'stateUpdate',
  state,
});

export const resolveMovementBroadcast = (
  result: MovementResolution,
  fallback: 'none' | 'stateUpdate' = 'none',
): StatefulServerMessage | undefined => {
  if ('movements' in result) {
    return toMovementResultMessage(result);
  }

  return fallback === 'stateUpdate'
    ? toStateUpdateMessage(result.state)
    : undefined;
};

export const resolveCombatBroadcast = (
  result: CombatResolution,
  fallback: 'none' | 'stateUpdate' = 'none',
): StatefulServerMessage | undefined => {
  const results = 'results' in result ? result.results : undefined;

  if (results && results.length > 0) {
    return toCombatResultMessage(result.state, results);
  }

  return fallback === 'stateUpdate'
    ? toStateUpdateMessage(result.state)
    : undefined;
};

// --- Event log derivation ---

export const deriveMovementEvents = (
  result: MovementResolution,
): GameEvent[] => {
  const { state } = result;
  const events: GameEvent[] = [];

  if ('movements' in result) {
    events.push({
      type: 'movementResolved',
      turn: state.turnNumber,
      phase: state.phase,
      activePlayer: state.activePlayer,
      movements: result.movements,
      ordnanceMovements: result.ordnanceMovements,
      events: result.events,
    });
  }

  events.push({
    type: 'phaseChanged',
    turn: state.turnNumber,
    phase: state.phase,
    activePlayer: state.activePlayer,
  });

  if (state.phase === 'gameOver') {
    events.push({
      type: 'gameOver',
      turn: state.turnNumber,
      winner: state.winner!,
      reason: state.winReason!,
    });
  }

  return events;
};

export const deriveCombatEvents = (result: CombatResolution): GameEvent[] => {
  const { state } = result;
  const results = 'results' in result ? result.results : undefined;
  const events: GameEvent[] = [];

  if (results && results.length > 0) {
    events.push({
      type: 'combatResolved',
      turn: state.turnNumber,
      phase: state.phase,
      activePlayer: state.activePlayer,
      results,
    });
  }

  events.push({
    type: 'phaseChanged',
    turn: state.turnNumber,
    phase: state.phase,
    activePlayer: state.activePlayer,
  });

  if (state.phase === 'gameOver') {
    events.push({
      type: 'gameOver',
      turn: state.turnNumber,
      winner: state.winner!,
      reason: state.winReason!,
    });
  }

  return events;
};

export const derivePhaseChangeEvents = (state: GameState): GameEvent[] => {
  const events: GameEvent[] = [
    {
      type: 'phaseChanged',
      turn: state.turnNumber,
      phase: state.phase,
      activePlayer: state.activePlayer,
    },
  ];

  if (state.phase === 'gameOver') {
    events.push({
      type: 'gameOver',
      turn: state.turnNumber,
      winner: state.winner!,
      reason: state.winReason!,
    });
  }

  return events;
};
