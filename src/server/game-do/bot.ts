import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from '../../shared/ai';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { GameStateActionMessage } from './actions';

const buildIdleAstrogationOrders = (
  state: GameState,
  playerId: PlayerId,
): Extract<GameStateActionMessage, { type: 'astrogation' }>['orders'] =>
  state.ships
    .filter((ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed')
    .map((ship) => ({
      shipId: ship.id,
      burn: null,
      overload: null,
    }));

const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
): boolean =>
  state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });

/** Delay before the server autoplayer acts for an `agent_` seat; keep below LLM turn budgets. */
export const BOT_THINK_TIME_MS = 15_000;

/** Default for server-scheduled agent seats (matches single-player / lobby). */
export const SERVER_AGENT_AI_DIFFICULTY: AIDifficulty = 'normal';

export const buildBotAction = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = SERVER_AGENT_AI_DIFFICULTY,
  // The caller should pass the match RNG (same one used by action
  // processing) so the bot's passenger-escort lookahead stays deterministic
  // with the authoritative resolution. Callers without a RNG fall back to a
  // mid-bias fixed function rather than `Math.random`.
  rng: () => number = () => 0.5,
): GameStateActionMessage | null => {
  switch (state.phase) {
    case 'waiting':
    case 'gameOver':
      return null;
    case 'fleetBuilding':
      return {
        type: 'fleetReady',
        purchases: buildAIFleetPurchases(state, playerId, difficulty),
      };
    case 'astrogation': {
      const orders = aiAstrogation(state, playerId, map, difficulty, rng);
      return {
        type: 'astrogation',
        orders:
          orders.length > 0
            ? orders
            : buildIdleAstrogationOrders(state, playerId),
      };
    }
    case 'ordnance': {
      const launches = aiOrdnance(state, playerId, map, difficulty, rng);
      return launches.length > 0
        ? { type: 'ordnance', launches }
        : { type: 'skipOrdnance' };
    }
    case 'combat': {
      if (hasOwnedPendingAsteroidHazards(state, playerId)) {
        return { type: 'beginCombat' };
      }

      const attacks = aiCombat(state, playerId, map, difficulty);
      return attacks.length > 0
        ? { type: 'combat', attacks }
        : { type: 'skipCombat' };
    }
    case 'logistics': {
      const transfers = aiLogistics(state, playerId, map, difficulty);
      return transfers.length > 0
        ? { type: 'logistics', transfers }
        : { type: 'skipLogistics' };
    }
    default: {
      const _exhaustive: never = state.phase;
      return _exhaustive;
    }
  }
};
