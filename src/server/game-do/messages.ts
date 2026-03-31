import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  hasCombatResults,
  isMovementResult,
  type MovementResult,
  type StateUpdateResult,
} from '../../shared/engine/game-engine';
import { filterLogisticsTransferLogEvents } from '../../shared/engine/transfer-log-events';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';

export type StatefulServerMessage = Extract<
  S2C,
  {
    state: GameState;
  }
>;

type GameStartMessage = Extract<
  S2C,
  {
    type: 'gameStart';
  }
>;

type BroadcastFallback = 'none' | 'stateUpdate';
type MovementResolution = MovementResult | StateUpdateResult;
type CombatResolution = {
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
export const toCombatSingleResultMessage = (
  state: GameState,
  result: CombatResult,
): StatefulServerMessage => ({
  type: 'combatSingleResult',
  result,
  state,
});
export const toGameStartMessage = (state: GameState): GameStartMessage => ({
  type: 'gameStart',
  state,
});

export const toStateUpdateMessage = (
  state: GameState,
  engineEventsForTransferLog?: readonly EngineEvent[],
): StatefulServerMessage => {
  if (engineEventsForTransferLog === undefined) {
    return {
      type: 'stateUpdate',
      state,
    };
  }

  const transferEvents = filterLogisticsTransferLogEvents(
    engineEventsForTransferLog,
  );

  if (transferEvents.length === 0) {
    return {
      type: 'stateUpdate',
      state,
    };
  }

  return {
    type: 'stateUpdate',
    state,
    transferEvents,
  };
};

export const resolveStateBearingMessage = (
  state: GameState,
  primaryMessage?: StatefulServerMessage,
): StatefulServerMessage => primaryMessage ?? toStateUpdateMessage(state);

export const resolveMovementBroadcast = (
  result: MovementResolution,
  fallback: BroadcastFallback = 'none',
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
  fallback: BroadcastFallback = 'none',
): StatefulServerMessage | undefined => {
  if (hasCombatResults(result)) {
    return toCombatResultMessage(result.state, result.results);
  }

  return fallback === 'stateUpdate'
    ? toStateUpdateMessage(result.state)
    : undefined;
};
