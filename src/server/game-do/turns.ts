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
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
} from './message-builders';

export interface TurnTimeoutOutcome {
  state: GameState;
  primaryMessage?: StatefulServerMessage;
  events: EngineEvent[];
}

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

    const result = processAstrogation(gameState, playerId, orders, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result),
          events: result.engineEvents,
        };
  }

  if (phase === 'ordnance') {
    const result = skipOrdnance(gameState, playerId, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result, 'stateUpdate'),
          events: result.engineEvents,
        };
  }

  if (phase === 'combat') {
    const result = skipCombat(gameState, playerId, map, rng);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveCombatBroadcast(result),
          events: result.engineEvents,
        };
  }

  return null;
};
