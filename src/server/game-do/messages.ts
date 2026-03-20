import type {
  CombatPhaseResult,
  MovementResult,
  StateUpdateResult,
} from '../../shared/engine/game-engine';
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
