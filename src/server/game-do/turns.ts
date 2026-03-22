import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  processAstrogation,
  skipCombat,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type {
  AstrogationOrder,
  GameState,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
} from './messages';

export interface TurnTimeoutOutcome {
  state: GameState;
  primaryMessage?: StatefulServerMessage;
  events: EngineEvent[];
}

export const resolveTurnTimeoutOutcome = (
  gameState: GameState,
  map: SolarSystemMap,
): TurnTimeoutOutcome | null => {
  const { activePlayer: playerId, phase } = gameState;

  if (phase === 'astrogation') {
    const orders: AstrogationOrder[] = gameState.ships
      .filter((ship) => ship.owner === playerId)
      .map((ship) => ({ shipId: ship.id, burn: null }));

    const result = processAstrogation(
      gameState,
      playerId,
      orders,
      map,
      Math.random,
    );

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result),
          events: result.engineEvents,
        };
  }

  if (phase === 'ordnance') {
    const result = skipOrdnance(gameState, playerId, map, Math.random);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result, 'stateUpdate'),
          events: result.engineEvents,
        };
  }

  if (phase === 'combat') {
    const result = skipCombat(gameState, playerId, map, Math.random);

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
