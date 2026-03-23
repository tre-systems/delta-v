import {
  type CombatPhaseResult,
  hasCombatResults,
  isMovementResult,
  type MovementResult,
  type StateUpdateResult,
} from '../../shared/engine/game-engine';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
export type StatefulServerMessage = Extract<
  S2C,
  {
    state: GameState;
  }
>;
type MovementResolution = MovementResult | StateUpdateResult;
type CombatResolution =
  | StateUpdateResult
  | CombatPhaseResult
  | {
      state: GameState;
      results?: CombatResult[];
    };
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
export const toGameStartMessage = (
  state: GameState,
): Extract<
  S2C,
  {
    type: 'gameStart';
  }
> => ({
  type: 'gameStart',
  state,
});
export const toStateUpdateMessage = (
  state: GameState,
): StatefulServerMessage => ({
  type: 'stateUpdate',
  state,
});
export const resolveStateBearingMessage = (
  state: GameState,
  primaryMessage?: StatefulServerMessage,
): StatefulServerMessage => primaryMessage ?? toStateUpdateMessage(state);
export const resolveMovementBroadcast = (
  result: MovementResolution,
  fallback: 'none' | 'stateUpdate' = 'none',
): StatefulServerMessage | undefined => {
  if (isMovementResult(result)) {
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
  if (hasCombatResults(result)) {
    return toCombatResultMessage(
      result.state,
      (result as CombatPhaseResult).results,
    );
  }
  return fallback === 'stateUpdate'
    ? toStateUpdateMessage(result.state)
    : undefined;
};
