import { SHIP_STATS } from '../../shared/constants';
import { isOrderableShip } from '../../shared/engine/util';
import { HEX_DIRECTIONS, hexDistance, hexKey } from '../../shared/hex';
import type { GameState, Ship } from '../../shared/types/domain';
import type { MatchVelocityPlan } from './types';

const findReachableVelocityPlan = (
  ship: Ship,
  targetVelocity: Ship['velocity'],
): Pick<MatchVelocityPlan, 'burn' | 'overload'> | null => {
  for (let burn = 0; burn < HEX_DIRECTIONS.length; burn++) {
    const burnedVelocity = {
      dq: ship.velocity.dq + HEX_DIRECTIONS[burn].dq,
      dr: ship.velocity.dr + HEX_DIRECTIONS[burn].dr,
    };

    if (
      burnedVelocity.dq === targetVelocity.dq &&
      burnedVelocity.dr === targetVelocity.dr
    ) {
      return {
        burn,
        overload: null,
      };
    }
  }

  const stats = SHIP_STATS[ship.type];
  const canOverload =
    stats?.canOverload && ship.fuel >= 2 && ship.overloadUsed === false;

  if (!canOverload) {
    return null;
  }

  for (let burn = 0; burn < HEX_DIRECTIONS.length; burn++) {
    for (let overload = 0; overload < HEX_DIRECTIONS.length; overload++) {
      const overloadedVelocity = {
        dq:
          ship.velocity.dq +
          HEX_DIRECTIONS[burn].dq +
          HEX_DIRECTIONS[overload].dq,
        dr:
          ship.velocity.dr +
          HEX_DIRECTIONS[burn].dr +
          HEX_DIRECTIONS[overload].dr,
      };

      if (
        overloadedVelocity.dq === targetVelocity.dq &&
        overloadedVelocity.dr === targetVelocity.dr
      ) {
        return {
          burn,
          overload,
        };
      }
    }
  }

  return null;
};

export const findMatchVelocityPlan = (
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
): MatchVelocityPlan | null => {
  if (state.phase !== 'astrogation' || selectedShipId === null) {
    return null;
  }

  const selectedShip = state.ships.find((ship) => ship.id === selectedShipId);

  if (
    !selectedShip ||
    selectedShip.owner !== playerId ||
    !isOrderableShip(selectedShip) ||
    selectedShip.damage.disabledTurns > 0
  ) {
    return null;
  }

  const candidates = state.ships
    .filter(
      (ship) =>
        ship.id !== selectedShip.id &&
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        hexDistance(ship.position, selectedShip.position) <= 3,
    )
    .map((ship) => ({
      ship,
      distance: hexDistance(ship.position, selectedShip.position),
      plan: findReachableVelocityPlan(selectedShip, ship.velocity),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        ship: Ship;
        distance: number;
        plan: Pick<MatchVelocityPlan, 'burn' | 'overload'>;
      } => candidate.plan !== null,
    )
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return hexKey(left.ship.position).localeCompare(
        hexKey(right.ship.position),
      );
    });

  const best = candidates[0];

  return best
    ? {
        targetShipId: best.ship.id,
        burn: best.plan.burn,
        overload: best.plan.overload,
      }
    : null;
};
