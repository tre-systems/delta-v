import { SHIP_STATS } from '../shared/constants';
import { HEX_DIRECTIONS, type HexCoord, hexAdd, hexEqual, hexKey } from '../shared/hex';
import { computeCourse, predictDestination } from '../shared/movement';
import type { GameState, Ship, SolarSystemMap } from '../shared/types';
import type { PlanningState } from './renderer';

type InputPlanningSnapshot = Pick<
  PlanningState,
  'selectedShipId' | 'burns' | 'overloads' | 'weakGravityChoices' | 'torpedoAccel' | 'torpedoAccelSteps'
>;

export type AstrogationInteraction =
  | { type: 'weakGravityToggle'; shipId: string; choices: Record<string, boolean> }
  | { type: 'overloadToggle'; shipId: string; direction: number | null }
  | { type: 'burnToggle'; shipId: string; direction: number | null; clearOverload: boolean }
  | { type: 'selectShip'; shipId: string }
  | { type: 'clearSelection' };

export type OrdnanceInteraction =
  | { type: 'torpedoAccel'; torpedoAccel: number | null; torpedoAccelSteps: 1 | 2 | null }
  | { type: 'selectShip'; shipId: string; clearTorpedoAccel: true }
  | { type: 'none' };

const getShipById = (state: GameState, shipId: string | null): Ship | null => {
  return shipId ? (state.ships.find((ship) => ship.id === shipId) ?? null) : null;
};

const getOwnShipAtHex = (
  state: GameState,
  playerId: number,
  clickHex: HexCoord,
  options: { requireOperational?: boolean } = {},
) => {
  return (
    state.ships.find(
      (ship) =>
        ship.owner === playerId &&
        (!options.requireOperational || (!ship.destroyed && ship.damage.disabledTurns === 0 && !ship.landed)) &&
        hexEqual(clickHex, ship.position),
    ) ?? null
  );
};

const resolveWeakGravityToggle = (
  state: GameState,
  map: SolarSystemMap,
  ship: Ship,
  clickHex: HexCoord,
  planning: InputPlanningSnapshot,
) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;
  const overload = planning.overloads.get(ship.id) ?? null;
  const weakGravityChoices = planning.weakGravityChoices.get(ship.id) ?? {};
  const course = computeCourse(ship, currentBurn, map, {
    overload,
    weakGravityChoices,
    destroyedBases: state.destroyedBases,
  });
  for (const gravityEffect of course.enteredGravityEffects) {
    if (gravityEffect.strength !== 'weak' || !hexEqual(clickHex, gravityEffect.hex)) continue;
    const key = hexKey(gravityEffect.hex);
    return {
      type: 'weakGravityToggle' as const,
      shipId: ship.id,
      choices: {
        ...weakGravityChoices,
        [key]: !weakGravityChoices[key],
      },
    };
  }
  return null;
};

const resolveOverloadToggle = (ship: Ship, clickHex: HexCoord, planning: InputPlanningSnapshot) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;
  if (currentBurn === null) return null;
  const stats = SHIP_STATS[ship.type];
  if (!stats?.canOverload || ship.fuel < 2 || ship.overloadUsed) return null;

  const predictedDestination = ship.landed ? null : predictDestination(ship);
  const launchHex = predictedDestination ?? ship.position;
  const burnDestination = hexAdd(launchHex, HEX_DIRECTIONS[currentBurn]);
  const currentOverload = planning.overloads.get(ship.id) ?? null;

  for (let direction = 0; direction < 6; direction++) {
    if (!hexEqual(clickHex, hexAdd(burnDestination, HEX_DIRECTIONS[direction]))) continue;
    return {
      type: 'overloadToggle' as const,
      shipId: ship.id,
      direction: currentOverload === direction ? null : direction,
    };
  }
  return null;
};

const resolveBurnToggle = (
  state: GameState,
  map: SolarSystemMap,
  ship: Ship,
  clickHex: HexCoord,
  planning: InputPlanningSnapshot,
) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;
  const predictedDestination = ship.landed
    ? computeCourse(ship, null, map, { destroyedBases: state.destroyedBases }).path[0]
    : predictDestination(ship);
  for (let direction = 0; direction < 6; direction++) {
    if (!hexEqual(clickHex, hexAdd(predictedDestination, HEX_DIRECTIONS[direction]))) continue;
    return {
      type: 'burnToggle' as const,
      shipId: ship.id,
      direction: currentBurn === direction ? null : direction,
      clearOverload: currentBurn !== direction,
    };
  }
  return null;
};

export const resolveAstrogationClick = (
  state: GameState,
  map: SolarSystemMap,
  playerId: number,
  planning: InputPlanningSnapshot,
  clickHex: HexCoord,
): AstrogationInteraction => {
  const selectedShip = getShipById(state, planning.selectedShipId);
  if (selectedShip && selectedShip.fuel > 0 && selectedShip.damage.disabledTurns === 0) {
    const weakGravityToggle = resolveWeakGravityToggle(state, map, selectedShip, clickHex, planning);
    if (weakGravityToggle) return weakGravityToggle;

    const overloadToggle = resolveOverloadToggle(selectedShip, clickHex, planning);
    if (overloadToggle) return overloadToggle;

    const burnToggle = resolveBurnToggle(state, map, selectedShip, clickHex, planning);
    if (burnToggle) return burnToggle;
  }

  const ownShip = getOwnShipAtHex(state, playerId, clickHex);
  return ownShip ? { type: 'selectShip', shipId: ownShip.id } : { type: 'clearSelection' };
};

const getClickedTorpedoDirection = (ship: Ship, clickHex: HexCoord): number | null => {
  const direction = HEX_DIRECTIONS.findIndex((dir) => hexEqual(clickHex, hexAdd(ship.position, dir)));
  return direction >= 0 ? direction : null;
};

const cycleTorpedoAcceleration = (
  currentDirection: number | null,
  currentSteps: 1 | 2 | null,
  clickedDirection: number,
) => {
  if (currentDirection !== clickedDirection) {
    return { torpedoAccel: clickedDirection, torpedoAccelSteps: 1 as const };
  }
  if (currentSteps === 1) {
    return { torpedoAccel: clickedDirection, torpedoAccelSteps: 2 as const };
  }
  return { torpedoAccel: null, torpedoAccelSteps: null };
};

export const resolveOrdnanceClick = (
  state: GameState,
  playerId: number,
  planning: InputPlanningSnapshot,
  clickHex: HexCoord,
): OrdnanceInteraction => {
  const selectedShip = getShipById(state, planning.selectedShipId);
  if (selectedShip) {
    const clickedDirection = getClickedTorpedoDirection(selectedShip, clickHex);
    if (clickedDirection !== null) {
      return {
        type: 'torpedoAccel',
        ...cycleTorpedoAcceleration(planning.torpedoAccel, planning.torpedoAccelSteps, clickedDirection),
      };
    }
  }

  const ownShip = getOwnShipAtHex(state, playerId, clickHex, { requireOperational: true });
  return ownShip ? { type: 'selectShip', shipId: ownShip.id, clearTorpedoAccel: true } : { type: 'none' };
};
