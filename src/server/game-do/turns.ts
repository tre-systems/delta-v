import {
  processAstrogation,
  skipCombat,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type { GameEvent } from '../../shared/events';
import type {
  AstrogationOrder,
  GameState,
  SolarSystemMap,
} from '../../shared/types';
import {
  deriveCombatEvents,
  deriveMovementEvents,
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
} from './messages';

export interface TurnTimeoutOutcome {
  state: GameState;
  primaryMessage?: StatefulServerMessage;
  events: GameEvent[];
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
          events: deriveMovementEvents(result),
        };
  }

  if (phase === 'ordnance') {
    const result = skipOrdnance(gameState, playerId, map, Math.random);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveMovementBroadcast(result, 'stateUpdate'),
          events: deriveMovementEvents(result),
        };
  }

  if (phase === 'combat') {
    const result = skipCombat(gameState, playerId, map, Math.random);

    return 'error' in result
      ? null
      : {
          state: result.state,
          primaryMessage: resolveCombatBroadcast(result),
          events: deriveCombatEvents(result),
        };
  }

  return null;
};
