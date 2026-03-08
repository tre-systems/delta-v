import {
  type HexCoord,
  type HexVec,
  HEX_DIRECTIONS,
  hexAdd,
  hexSubtract,
  hexLineDraw,
  hexKey,
  hexDirectionToward,
} from './hex';
import type { Ship, CourseResult, GravityEffect, SolarSystemMap } from './types';
import { SHIP_STATS } from './constants';

export interface CourseOptions {
  overload?: number | null; // second burn direction (warships only)
  weakGravityChoices?: Record<string, boolean>; // hexKey -> true to ignore
}

/**
 * Compute the course for a ship given a burn direction.
 *
 * Algorithm:
 * 1. Predicted destination = position + velocity
 * 2. Apply burn (optional): shift destination by 1 hex in burn direction
 * 3. Apply overload (optional, warships only): shift by another hex, 2 fuel total
 * 4. Trace path from position to destination
 * 5. Apply gravity: each gravity hex in path deflects the destination
 * 6. Compute final path and new velocity
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

  if (ship.landed) {
    // No burn = stay landed (ship remains at the base)
    if (burn === null) {
      return {
        destination: ship.position,
        path: [ship.position],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
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

    const path = hexLineDraw(launchHex, destination);
    const gravityEffects: GravityEffect[] = [];
    applyGravity(path, destination, map, gravityEffects, weakGravityChoices, (d) => { destination = d; });

    const finalPath = hexLineDraw(launchHex, destination);
    const newVelocity = hexSubtract(destination, launchHex);

    const { crashed, crashBody } = checkCrash(finalPath, map, newVelocity, bodyName ?? undefined);
    const landedAt = checkLanding(destination, map);

    return { destination, path: finalPath, newVelocity, fuelSpent, gravityEffects, crashed, crashBody, landedAt };
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

  // Trace path and apply gravity
  const rawPath = hexLineDraw(ship.position, destination);
  const gravityEffects: GravityEffect[] = [];
  applyGravity(rawPath, destination, map, gravityEffects, weakGravityChoices, (d) => { destination = d; });

  // Compute final path with gravity-adjusted destination
  const finalPath = hexLineDraw(ship.position, destination);
  const newVelocity = hexSubtract(destination, ship.position);

  const { crashed, crashBody } = checkCrash(finalPath, map, newVelocity);
  const landedAt = checkLanding(destination, map);

  return { destination, path: finalPath, newVelocity, fuelSpent, gravityEffects, crashed, crashBody, landedAt };
}

/**
 * Apply gravity deflections along the path.
 *
 * Applies at starting hex (stationary ships drift).
 * Skips destination hex (gravity there affects next turn).
 *
 * Weak gravity: player may choose to ignore a single weak gravity hex.
 * Two consecutive weak gravity hexes from the same body = mandatory on the second.
 */
function applyGravity(
  path: HexCoord[],
  destination: HexCoord,
  map: SolarSystemMap,
  effects: GravityEffect[],
  weakGravityChoices: Record<string, boolean>,
  setDestination: (d: HexCoord) => void,
): void {
  let dest = destination;
  let prevWeakBody: string | null = null;

  const end = path.length === 1 ? path.length : path.length - 1;
  for (let i = 0; i < end; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (!hex?.gravity) {
      prevWeakBody = null;
      continue;
    }

    const grav = hex.gravity;
    const key = hexKey(path[i]);

    if (grav.strength === 'weak') {
      const isConsecutiveWeak = prevWeakBody === grav.bodyName;
      const playerIgnores = weakGravityChoices[key] === true;

      if (!isConsecutiveWeak && playerIgnores) {
        effects.push({ hex: path[i], direction: grav.direction, bodyName: grav.bodyName, strength: 'weak', ignored: true });
        prevWeakBody = grav.bodyName;
        continue;
      }
      prevWeakBody = grav.bodyName;
    } else {
      prevWeakBody = null;
    }

    const deflection = HEX_DIRECTIONS[grav.direction];
    dest = hexAdd(dest, deflection);
    effects.push({ hex: path[i], direction: grav.direction, bodyName: grav.bodyName, strength: grav.strength, ignored: false });
  }

  setDestination(dest);
}

/**
 * Check if any hex in the path causes a crash.
 * Intermediate body hexes = crash (except skipBody for takeoff).
 * Final hex: destructive bodies crash, non-destructive = landing.
 */
function checkCrash(
  path: HexCoord[],
  map: SolarSystemMap,
  newVelocity: HexVec,
  skipBody?: string,
): { crashed: boolean; crashBody: string | null } {
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.body) {
      if (i < path.length - 1) {
        if (skipBody && hex.body.name === skipBody) continue;
        return { crashed: true, crashBody: hex.body.name };
      }
      if (hex.body.destructive) {
        return { crashed: true, crashBody: hex.body.name };
      }
    }
  }
  return { crashed: false, crashBody: null };
}

/**
 * Check if the ship lands at a base or body surface.
 * Base hexes: always land (docking catches the ship at any velocity).
 * Non-destructive body surface: also lands (ship touches down).
 */
function checkLanding(
  destination: HexCoord,
  map: SolarSystemMap,
): string | null {
  const hex = map.hexes.get(hexKey(destination));
  if (hex?.base) return hex.base.bodyName;
  if (hex?.body && !hex.body.destructive) return hex.body.name;
  return null;
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
  return hexAdd(ship.position, ship.velocity);
}
