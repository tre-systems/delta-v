import {
  getOrderableShipsForPlayer,
  isOrderableShip,
} from '../../shared/engine/util';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import type { AstrogationOrdersPlanningSnapshot } from './types';

export const buildAstrogationOrders = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: AstrogationOrdersPlanningSnapshot,
): AstrogationOrder[] => {
  if (playerId < 0) return [];
  const pid = playerId as PlayerId;
  return getOrderableShipsForPlayer(state, pid)
    .filter(isOrderableShip)
    .map((ship) => {
      const burn = planning.burns.get(ship.id) ?? null;
      const overload = planning.overloads.get(ship.id) ?? null;
      const weakGravityChoices = planning.weakGravityChoices.get(ship.id);

      const order: AstrogationOrder = {
        shipId: ship.id,
        burn,
        overload,
      };

      if (planning.landingShips.has(ship.id)) {
        order.land = true;
      }

      if (weakGravityChoices && Object.keys(weakGravityChoices).length > 0) {
        order.weakGravityChoices = weakGravityChoices;
      }

      return order;
    });
};
