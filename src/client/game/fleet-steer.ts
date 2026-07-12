import { type HexCoord, type HexKey, hexDistance } from '../../shared/hex';
import { computeCourse } from '../../shared/movement';
import type { Ship, SolarSystemMap } from '../../shared/types/domain';

// One resolved steering decision for a ship: the burn direction (0-5) or
// null for a free drift, chosen to move the ship as close as possible to
// the target hex this turn.
export interface FleetSteerOrder {
  shipId: string;
  burn: number | null;
}

// Candidate burns evaluated for each ship: a free drift plus each of the
// six thrust directions. computeCourse handles fuel (a burn a ship cannot
// afford is treated as drift), gravity, and landed takeoffs, so we do not
// re-derive those rules here.
const CANDIDATE_BURNS: (number | null)[] = [null, 0, 1, 2, 3, 4, 5];

// Pick the burn that brings `ship` closest to `targetHex` after one turn of
// movement. Crash courses are excluded. Ties prefer a free drift (null),
// then the lower direction index, for determinism. Returns undefined when
// the ship has no legal non-crash course (caller skips it).
export const chooseSteerBurn = (
  ship: Ship,
  targetHex: HexCoord,
  map: SolarSystemMap,
  destroyedBases: HexKey[],
): number | null | undefined => {
  let best: { burn: number | null; distance: number } | undefined;

  for (const burn of CANDIDATE_BURNS) {
    const course = computeCourse(ship, burn, map, { destroyedBases });

    if (course.outcome === 'crash') {
      continue;
    }

    const distance = hexDistance(course.destination, targetHex);

    // Strictly-less keeps the earliest candidate on ties; because null is
    // evaluated first, a drift wins a tie over any burn, and lower burn
    // indices win over higher ones.
    if (!best || distance < best.distance) {
      best = { burn, distance };
    }
  }

  return best?.burn;
};

// Resolve steering orders for a group of ships toward one target hex.
// Ships with no legal non-crash course are omitted from the result.
export const planFleetSteer = (
  ships: Ship[],
  targetHex: HexCoord,
  map: SolarSystemMap,
  destroyedBases: HexKey[],
): FleetSteerOrder[] => {
  const orders: FleetSteerOrder[] = [];

  for (const ship of ships) {
    const burn = chooseSteerBurn(ship, targetHex, map, destroyedBases);

    if (burn === undefined) {
      continue;
    }

    orders.push({ shipId: ship.id, burn });
  }

  return orders;
};
