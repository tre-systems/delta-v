/**
 * Socket payload builders for the Game DO.
 * Keep message formatting here so action/alarm/publication code only chooses
 * which state-bearing message to send.
 */

import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  hasCombatResults,
  isMovementResult,
  type MovementResult,
  type StateUpdateResult,
} from '../../shared/engine/game-engine';
import { filterLogisticsTransferLogEvents } from '../../shared/engine/transfer-log-events';
import type {
  CombatResult,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';

export type StatefulServerMessage = Extract<
  S2C,
  {
    state: GameState;
  }
>;

/** Third argument to `GameDO.publishStateChange` and action-handler publish. */
export type PublishStateChangeOptions = {
  actor?: PlayerId | null;
  restartTurnTimer?: boolean;
  events?: EngineEvent[];
  /** MCP-only one-shot notice: seat whose turn was advanced by the turn timer. */
  lastTurnAutoPlayed?: {
    seat: PlayerId;
    index: number;
    reason: 'timeout';
  };
};

type BroadcastFallback = 'none' | 'stateUpdate';
type MovementResolution = MovementResult | StateUpdateResult;
type CombatResolution = {
  state: GameState;
  results?: CombatResult[];
};

export const STATEFUL_SERVER_MESSAGE_TYPES = [
  'gameStart',
  'movementResult',
  'combatResult',
  'combatSingleResult',
  'stateUpdate',
] as const satisfies readonly StatefulServerMessage['type'][];

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
    const { movements, ordnanceMovements, events, state } = result;
    return {
      type: 'movementResult',
      movements,
      ordnanceMovements,
      events,
      state,
    };
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
    return {
      type: 'combatResult',
      results: result.results,
      state: result.state,
    };
  }

  return fallback === 'stateUpdate'
    ? toStateUpdateMessage(result.state)
    : undefined;
};
