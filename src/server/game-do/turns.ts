import { buildCandidates } from '../../shared/agent/candidates';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  processAstrogation,
  skipCombat,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import { getOrderableShipsForPlayer } from '../../shared/engine/util';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { C2S } from '../../shared/types/protocol';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
} from './message-builders';

export interface TurnTimeoutOutcome {
  state: GameState;
  primaryMessage?: StatefulServerMessage;
  events: EngineEvent[];
  lastTurnAutoPlayed: {
    seat: PlayerId;
    index: number;
    reason: 'timeout';
  };
}

const candidateIndexForAppliedAction = (
  gameState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  applied: C2S,
): number => {
  const candidates = buildCandidates(gameState, playerId, map);
  const key = JSON.stringify(applied);
  const idx = candidates.findIndex((c) => JSON.stringify(c) === key);
  return idx >= 0 ? idx : 0;
};

export const resolveTurnTimeoutOutcome = (
  gameState: GameState,
  map: SolarSystemMap,
  rng: () => number,
): TurnTimeoutOutcome | null => {
  const { activePlayer: playerId, phase } = gameState;

  if (phase === 'astrogation') {
    const orders: AstrogationOrder[] = getOrderableShipsForPlayer(
      gameState,
      playerId,
    ).map((ship) => ({ shipId: ship.id, burn: null, overload: null }));
    const applied: C2S = { type: 'astrogation', orders };
    const index = candidateIndexForAppliedAction(
      gameState,
      playerId,
      map,
      applied,
    );

    const result = processAstrogation(gameState, playerId, orders, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result),
          events: result.engineEvents,
          lastTurnAutoPlayed: { seat: playerId, index, reason: 'timeout' },
        };
  }

  if (phase === 'ordnance') {
    const applied: C2S = { type: 'skipOrdnance' };
    const index = candidateIndexForAppliedAction(
      gameState,
      playerId,
      map,
      applied,
    );
    const result = skipOrdnance(gameState, playerId, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result, 'stateUpdate'),
          events: result.engineEvents,
          lastTurnAutoPlayed: { seat: playerId, index, reason: 'timeout' },
        };
  }

  if (phase === 'combat') {
    const applied: C2S = { type: 'skipCombat' };
    const index = candidateIndexForAppliedAction(
      gameState,
      playerId,
      map,
      applied,
    );
    const result = skipCombat(gameState, playerId, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveCombatBroadcast(result),
          events: result.engineEvents,
          lastTurnAutoPlayed: { seat: playerId, index, reason: 'timeout' },
        };
  }

  return null;
};
