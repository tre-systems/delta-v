import { buildCandidates } from '../../shared/agent/candidates';
import { buildAIFleetPurchases } from '../../shared/ai';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  processAstrogation,
  processFleetReady,
  skipCombat,
  skipLogistics,
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
  toStateUpdateMessage,
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

  if (phase === 'fleetBuilding') {
    // Fleet building blocks on per-player readiness, not the active player,
    // so force-ready one non-ready seat per timeout (preferring the active
    // player). The publication pipeline re-arms the turn timer after this
    // outcome publishes, so a second idle seat is auto-readied on the next
    // firing instead of stalling the match.
    const otherPlayer: PlayerId = playerId === 0 ? 1 : 0;
    const seat = [playerId, otherPlayer].find(
      (p) => !gameState.players[p].ready,
    );

    if (seat === undefined) {
      return null;
    }
    // Ready the seat with the built-in AI's fleet, matching what the server
    // bot would buy. Fall back to an empty purchase list (legal when the seat
    // already owns ships) so the phase still advances if the AI purchase is
    // rejected.
    const aiPurchases = buildAIFleetPurchases(gameState, seat, 'normal');
    let purchases = aiPurchases;
    let result = processFleetReady(gameState, seat, purchases, map);

    if ('error' in result && aiPurchases.length > 0) {
      purchases = [];
      result = processFleetReady(gameState, seat, purchases, map);
    }

    if ('error' in result) {
      return null;
    }
    const applied: C2S = { type: 'fleetReady', purchases };
    const index = candidateIndexForAppliedAction(gameState, seat, map, applied);

    return {
      state: result.state,
      events: result.engineEvents,
      lastTurnAutoPlayed: { seat, index, reason: 'timeout' },
    };
  }

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

  if (phase === 'logistics') {
    const applied: C2S = { type: 'skipLogistics' };
    const index = candidateIndexForAppliedAction(
      gameState,
      playerId,
      map,
      applied,
    );
    const result = skipLogistics(gameState, playerId, map);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: toStateUpdateMessage(
            result.state,
            result.engineEvents,
          ),
          events: result.engineEvents,
          lastTurnAutoPlayed: { seat: playerId, index, reason: 'timeout' },
        };
  }

  return null;
};
