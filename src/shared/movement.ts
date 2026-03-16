import {
  type HexCoord,
  type HexVec,
  HEX_DIRECTIONS,
  hexAdd,
  hexSubtract,
  analyzeHexLine,
  hexLineDraw,
  hexKey,
  hexDirectionToward,
  hexVecLength,
} from './hex';
import type { Ship, CourseResult, GravityEffect, SolarSystemMap } from './types';
import { SHIP_STATS } from './constants';
import { bodyHasGravity } from './map-data';

export interface CourseOptions {
  overload?: number | null; // second burn direction (warships only)
  weakGravityChoices?: Record<string, boolean>; // hexKey -> true to ignore
  destroyedBases?: string[];
}

/**
 * Compute the course for a ship given a burn direction.
 *
 * Algorithm:
 * 1. Predicted destination = position + velocity
 * 2. Apply burn (optional): shift destination by 1 hex in burn direction
 * 3. Apply overload (optional, warships only): shift by another hex, 2 fuel total
 * 4. Apply pending gravity entered on the previous turn
 * 5. Trace the actual path for this turn
 * 6. Record gravity hexes entered this turn for the next turn
 */
export function computeCourse(
  ship: Ship,
  burn: number | null,
  map: SolarSystemMap,
  options?: CourseOptions,
): CourseResult {
  let destination: HexCoord;
  let fuelSpent = 0;
  const overload = options?.overload ?? null;
  const weakGravityChoices = options?.weakGravityChoices ?? {};
  const destroyedBases = new Set(options?.destroyedBases ?? []);

  if (ship.landed) {
    // No burn = stay landed (ship remains at the base)
    if (burn === null) {
      return {
        destination: ship.position,
        path: [ship.position],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        enteredGravityEffects: [],
        crashed: false,
        crashBody: null,
        landedAt: null,
      };
    }

    // Takeoff: boosters move ship 1 hex away from planet center.
    // Gravity cancels this, leaving ship stationary in the gravity hex.
    // Then the player's burn is applied from there.
    const baseHex = map.hexes.get(hexKey(ship.position));
    const bodyName = baseHex?.base?.bodyName ?? baseHex?.body?.name;

    let launchHex = ship.position;
    if (bodyName) {
      const body = map.bodies.find(b => b.name === bodyName);
      if (body) {
        const awayDir = hexDirectionToward(body.center, ship.position);
        const awayNeighbor = hexAdd(ship.position, HEX_DIRECTIONS[awayDir]);
        const nh = map.hexes.get(hexKey(awayNeighbor));
        if (!nh?.body) {
          launchHex = awayNeighbor;
        } else {
          for (let d = 0; d < 6; d++) {
            const neighbor = hexAdd(ship.position, HEX_DIRECTIONS[d]);
            const nh2 = map.hexes.get(hexKey(neighbor));
            if (nh2?.gravity?.bodyName === bodyName) {
              launchHex = neighbor;
              break;
            }
            if (!nh2?.body && launchHex === ship.position) {
              launchHex = neighbor;
            }
          }
        }
      }
    }

    // After booster + gravity cancel, ship is stationary at launchHex.
    destination = hexAdd(launchHex, HEX_DIRECTIONS[burn]);
    fuelSpent = 1;

    // Overload on takeoff
    if (overload !== null) {
      const stats = SHIP_STATS[ship.type];
      if (stats?.canOverload && ship.fuel >= 2) {
        destination = hexAdd(destination, HEX_DIRECTIONS[overload]);
        fuelSpent = 2;
      }
    }

    // Takeoff enters the launch gravity hex before the ship's burn resolves.
    const takeoffGravityEffects = collectEnteredGravityEffects(
      [ship.position, launchHex],
      map,
      weakGravityChoices,
    );
    const gravityEffects = [...takeoffGravityEffects];
    destination = applyPendingGravityEffects(destination, gravityEffects);

    const finalPath = hexLineDraw(launchHex, destination);
    const enteredGravityEffects = collectEnteredGravityEffects(finalPath, map, weakGravityChoices);
    const newVelocity = hexSubtract(destination, launchHex);

    const landedAt = checkLanding(ship, destination, newVelocity, fuelSpent, map, destroyedBases);
    const { crashed, crashBody } = checkCrash(finalPath, map, landedAt, bodyName ?? undefined);

    return {
      destination,
      path: finalPath,
      newVelocity,
      fuelSpent,
      gravityEffects,
      enteredGravityEffects,
      crashed,
      crashBody,
      landedAt,
    };
  }

  // Normal movement: destination = position + velocity
  destination = hexAdd(ship.position, ship.velocity);

  // Apply burn
  if (burn !== null && ship.fuel > 0) {
    destination = hexAdd(destination, HEX_DIRECTIONS[burn]);
    fuelSpent = 1;
  }

  // Apply overload (warships only, costs 2 fuel total)
  if (overload !== null && burn !== null) {
    const stats = SHIP_STATS[ship.type];
    if (stats?.canOverload && ship.fuel >= 2) {
      destination = hexAdd(destination, HEX_DIRECTIONS[overload]);
      fuelSpent = 2;
    }
  }

  // Gravity applies one turn after entry, so only previously queued gravity affects this move.
  const gravityEffects = (ship.pendingGravityEffects ?? []).map(effect => ({ ...effect }));
  destination = applyPendingGravityEffects(destination, gravityEffects);

  const finalPath = hexLineDraw(ship.position, destination);
  const enteredGravityEffects = collectEnteredGravityEffects(finalPath, map, weakGravityChoices);
  const newVelocity = hexSubtract(destination, ship.position);

  const landedAt = checkLanding(ship, destination, newVelocity, fuelSpent, map, destroyedBases);
  const { crashed, crashBody } = checkCrash(finalPath, map, landedAt);

  return {
    destination,
    path: finalPath,
    newVelocity,
    fuelSpent,
    gravityEffects,
    enteredGravityEffects,
    crashed,
    crashBody,
    landedAt,
  };
}

/**
 * Apply pending gravity deflections entered on the previous turn.
 */
export function applyPendingGravityEffects(
  destination: HexCoord,
  effects: GravityEffect[] | undefined,
): HexCoord {
  let dest = destination;
  for (const effect of effects ?? []) {
    if (effect.ignored) continue;
    const deflection = HEX_DIRECTIONS[effect.direction];
    dest = hexAdd(dest, deflection);
  }
  return dest;
}

/**
 * Collect gravity hexes entered during this move.
 *
 * The starting hex is skipped because its effect would already have been queued
 * on a previous turn. The destination hex is included because entering it now
 * means its gravity applies on the following turn.
 *
 * Weak gravity: player may choose to ignore a single weak gravity hex.
 * Two consecutive weak gravity hexes from the same body = mandatory on the second.
 */
export function collectEnteredGravityEffects(
  path: HexCoord[],
  map: SolarSystemMap,
  weakGravityChoices: Record<string, boolean> = {},
): GravityEffect[] {
  const effects: GravityEffect[] = [];
  let prevWeakBody: string | null = null;
  if (path.length < 2) return effects;
  const line = analyzeHexLine(path[0], path[path.length - 1]);

  for (let i = 1; i < line.definite.length; i++) {
    const coord = line.definite[i];
    const hex = map.hexes.get(hexKey(coord));
    if (!hex?.gravity) {
      prevWeakBody = null;
      continue;
    }

    const grav = hex.gravity;
    const key = hexKey(coord);
    let ignored = false;

    if (grav.strength === 'weak') {
      const isConsecutiveWeak = prevWeakBody === grav.bodyName;
      ignored = !isConsecutiveWeak && weakGravityChoices[key] === true;
      prevWeakBody = grav.bodyName;
    } else {
      prevWeakBody = null;
    }

    effects.push({
      hex: coord,
      direction: grav.direction,
      bodyName: grav.bodyName,
      strength: grav.strength,
      ignored,
    });
  }

  return effects;
}

/**
 * Check if any hex in the path causes a crash.
 * Intermediate body hexes = crash (except skipBody for takeoff).
 * Final hex: destructive bodies crash, non-destructive = landing.
 */
function checkCrash(
  path: HexCoord[],
  map: SolarSystemMap,
  landedAt: string | null,
  skipBody?: string,
): { crashed: boolean; crashBody: string | null } {
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.body) {
      if (i < path.length - 1) {
        if (skipBody && hex.body.name === skipBody) continue;
        return { crashed: true, crashBody: hex.body.name };
      }
      if (hex.body.destructive || landedAt === null) {
        return { crashed: true, crashBody: hex.body.name };
      }
    }
  }
  return { crashed: false, crashBody: null };
}

/**
 * Check whether the ship completes a legal landing.
 */
function checkLanding(
  ship: Ship,
  destination: HexCoord,
  newVelocity: HexVec,
  fuelSpent: number,
  map: SolarSystemMap,
  destroyedBases: Set<string>,
): string | null {
  const key = hexKey(destination);
  const hex = map.hexes.get(key);
  if (hex?.base && !destroyedBases.has(key)) {
    if (bodyHasGravity(hex.base.bodyName, map)) {
      return canLandAtPlanetaryBase(ship, hex.base.bodyName, fuelSpent, map, destroyedBases)
        ? hex.base.bodyName
        : null;
    }
    return hexVecLength(newVelocity) === 0 ? hex.base.bodyName : null;
  }

  if (hex?.body && !hex.body.destructive) {
    if (bodyHasGravity(hex.body.name, map)) {
      return null;
    }
    return hexVecLength(newVelocity) === 0 ? hex.body.name : null;
  }
  return null;
}


function canLandAtPlanetaryBase(
  ship: Ship,
  bodyName: string,
  fuelSpent: number,
  map: SolarSystemMap,
  destroyedBases: Set<string>,
): boolean {
  if (fuelSpent !== 1) return false;
  if (hexVecLength(ship.velocity) !== 1) return false;

  const currentHex = map.hexes.get(hexKey(ship.position));
  if (currentHex?.gravity?.bodyName !== bodyName) return false;

  const projectedDrift = applyPendingGravityEffects(
    hexAdd(ship.position, ship.velocity),
    ship.pendingGravityEffects,
  );
  const projectedHex = map.hexes.get(hexKey(projectedDrift));
  if (projectedHex?.gravity?.bodyName === bodyName) return true;
  return projectedHex?.base?.bodyName === bodyName && !destroyedBases.has(hexKey(projectedDrift));
}

/**
 * Check if a ship can burn fuel.
 */
export function canBurn(ship: Ship): boolean {
  return ship.fuel > 0;
}

/**
 * Predict where a ship will be next turn with no burn (for display).
 */
export function predictDestination(ship: Ship): HexCoord {
  if (ship.landed) return ship.position;
  return applyPendingGravityEffects(
    hexAdd(ship.position, ship.velocity),
    ship.pendingGravityEffects,
  );
}
