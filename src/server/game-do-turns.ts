import { processAstrogation, skipCombat, skipOrdnance } from '../shared/game-engine';
import type { AstrogationOrder, GameState, SolarSystemMap } from '../shared/types';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
} from './game-do-messages';

export interface TurnTimeoutOutcome {
  state: GameState;
  primaryMessage?: StatefulServerMessage;
}

export function resolveTurnTimeoutOutcome(
  gameState: GameState,
  map: SolarSystemMap,
): TurnTimeoutOutcome | null {
  const playerId = gameState.activePlayer;

  if (gameState.phase === 'astrogation') {
    const orders: AstrogationOrder[] = gameState.ships
      .filter(ship => ship.owner === playerId)
      .map(ship => ({ shipId: ship.id, burn: null }));
    const result = processAstrogation(gameState, playerId, orders, map);
    return 'error' in result
      ? null
      : { state: result.state, primaryMessage: resolveMovementBroadcast(result) };
  }

  if (gameState.phase === 'ordnance') {
    const result = skipOrdnance(gameState, playerId, map);
    return 'error' in result
      ? null
      : { state: result.state, primaryMessage: resolveMovementBroadcast(result, 'stateUpdate') };
  }

  if (gameState.phase === 'combat') {
    const result = skipCombat(gameState, playerId, map);
    return 'error' in result
      ? null
      : { state: result.state, primaryMessage: resolveCombatBroadcast(result) };
  }

  return null;
}
