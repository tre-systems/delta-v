import { type HexKey, hexDistance, hexKey, hexVecLength } from '../../hex';
import type { GameState, Ship, SolarSystemMap } from '../../types';
import { findNearestRefuelBase, findReachableRefuelBase } from '../common';
import { chooseBestPlan, type PlanDecision } from '.';

export interface ReachableRefuelTargetAction {
  type: 'navigationTargetOverride';
  shipId: Ship['id'];
  targetHex: { q: number; r: number };
  targetBody: string;
  seekingFuel: true;
}

export const chooseReachableRefuelTargetPlan = (
  state: GameState,
  ship: Ship,
  bases: readonly HexKey[],
  sharedBases: readonly string[],
  map: SolarSystemMap,
  currentTargetHex: { q: number; r: number },
  fuelForTrip: number,
  continuationFuel: number,
): PlanDecision<ReachableRefuelTargetAction> | null => {
  if (ship.fuel >= fuelForTrip + continuationFuel) {
    return null;
  }

  const reachableBase = findReachableRefuelBase(
    ship,
    [...bases],
    [...sharedBases],
    map,
    state.destroyedBases,
  );
  const basePos =
    reachableBase ??
    findNearestRefuelBase(ship.position, [...bases], [...sharedBases], map);

  if (!basePos) {
    return null;
  }

  const baseDist = hexDistance(ship.position, basePos);
  const distToTarget = hexDistance(ship.position, currentTargetHex);
  const speed = hexVecLength(ship.velocity);
  const planSaysReachable = reachableBase != null;
  const heuristicSaysReachable =
    baseDist < distToTarget && baseDist <= ship.fuel + speed + 2;

  if (!planSaysReachable && !heuristicSaysReachable) {
    return null;
  }

  const baseBody = map.hexes.get(hexKey(basePos))?.base?.bodyName ?? '';

  return chooseBestPlan([
    {
      id: `reachable-refuel-target:${ship.id}:${baseBody}:${hexKey(basePos)}`,
      intent: 'refuelAtReachableBase',
      action: {
        type: 'navigationTargetOverride',
        shipId: ship.id,
        targetHex: basePos,
        targetBody: baseBody,
        seekingFuel: true,
      },
      evaluation: {
        feasible: true,
        objective: 20,
        survival: 15,
        landing: 0,
        fuel: ship.fuel - Math.min(ship.fuel, baseDist),
        combat: 0,
        formation: 0,
        tempo: distToTarget - baseDist,
        risk: planSaysReachable ? 0 : 1,
        effort: baseDist,
      },
      diagnostics: [
        {
          reason: 'ship diverts to a reachable refuel base',
          detail: `${ship.id} targets ${baseBody || hexKey(basePos)}`,
        },
      ],
    },
  ]);
};
