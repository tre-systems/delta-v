import type { CombatPhaseResult, MovementResult, StateUpdateResult } from '../shared/game-engine';
import type { CombatResult, GameState, S2C } from '../shared/types';

export type StatefulServerMessage = Extract<S2C, { state: GameState }>;

type MovementResolution = MovementResult | StateUpdateResult;
type CombatResolution = StateUpdateResult | CombatPhaseResult | { state: GameState; results?: CombatResult[] };

export function toMovementResultMessage(result: MovementResult): StatefulServerMessage {
  return {
    type: 'movementResult',
    movements: result.movements,
    ordnanceMovements: result.ordnanceMovements,
    events: result.events,
    state: result.state,
  };
}

export function toCombatResultMessage(state: GameState, results: CombatResult[]): StatefulServerMessage {
  return {
    type: 'combatResult',
    results,
    state,
  };
}

export function toStateUpdateMessage(state: GameState): StatefulServerMessage {
  return { type: 'stateUpdate', state };
}

export function resolveMovementBroadcast(
  result: MovementResolution,
  fallback: 'none' | 'stateUpdate' = 'none',
): StatefulServerMessage | undefined {
  if ('movements' in result) {
    return toMovementResultMessage(result);
  }
  return fallback === 'stateUpdate' ? toStateUpdateMessage(result.state) : undefined;
}

export function resolveCombatBroadcast(
  result: CombatResolution,
  fallback: 'none' | 'stateUpdate' = 'none',
): StatefulServerMessage | undefined {
  const results = 'results' in result ? result.results : undefined;
  if (results && results.length > 0) {
    return toCombatResultMessage(result.state, results);
  }
  return fallback === 'stateUpdate' ? toStateUpdateMessage(result.state) : undefined;
}
