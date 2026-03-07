import {
  type HexCoord,
  type HexVec,
  HEX_DIRECTIONS,
  hexAdd,
  hexSubtract,
  hexLineDraw,
  hexKey,
  hexEqual,
  hexVecLength,
} from './hex';
import type { Ship, CourseResult, GravityEffect, SolarSystemMap, MapHex } from './types';

/**
 * Compute the course for a ship given a burn direction.
 *
 * Algorithm:
 * 1. Predicted destination = position + velocity
 * 2. Apply burn (optional): shift destination by 1 hex in burn direction
 * 3. Trace path from position to destination
 * 4. Apply gravity: each gravity hex in path deflects the destination
 * 5. Compute final path and new velocity
 */
export function computeCourse(
  ship: Ship,
  burn: number | null,
  map: SolarSystemMap,
): CourseResult {
  let destination: HexCoord;
  let fuelSpent = 0;

  if (ship.landed) {
    // Takeoff: ship starts at a base on a planet surface.
    // Boosters move ship 1 hex away from planet center.
    // Gravity of that hex pulls it back, so net velocity is 0.
    // The ship ends up stationary in the gravity hex above the base.
    // We find the gravity hex adjacent to the ship that has gravity pointing at this body.
    // Then apply the burn from there.
    const baseHex = map.hexes.get(hexKey(ship.position));
    const bodyName = baseHex?.base?.bodyName ?? baseHex?.body?.name;

    // Find which direction is "away" from the body — look for the adjacent gravity hex
    let launchHex = ship.position;
    if (bodyName) {
      // The base hex might be on the surface; find an adjacent gravity hex for this body
      for (let d = 0; d < 6; d++) {
        const neighbor = hexAdd(ship.position, HEX_DIRECTIONS[d]);
        const nh = map.hexes.get(hexKey(neighbor));
        if (nh?.gravity?.bodyName === bodyName) {
          launchHex = neighbor;
          break;
        }
        // If no gravity hex found (e.g., asteroids), just use any non-surface neighbor
        if (!nh?.body && launchHex === ship.position) {
          launchHex = neighbor;
        }
      }
    }

    // After booster + gravity cancel, ship is stationary at launchHex
    destination = launchHex;

    // Now apply the player's burn from the launch hex
    if (burn !== null && ship.fuel > 0) {
      destination = hexAdd(destination, HEX_DIRECTIONS[burn]);
      fuelSpent = 1;
    }

    // Trace path and apply gravity from launch hex
    const path = hexLineDraw(launchHex, destination);
    const gravityEffects: GravityEffect[] = [];
    applyGravity(path, destination, map, gravityEffects, (newDest) => { destination = newDest; });

    const finalPath = hexLineDraw(launchHex, destination);
    const newVelocity = hexSubtract(destination, launchHex);

    const { crashed, crashBody } = checkCrash(finalPath, map);
    const landedAt = checkLanding(destination, newVelocity, map);

    return {
      destination,
      path: finalPath,
      newVelocity,
      fuelSpent,
      gravityEffects,
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

  // Trace path and apply gravity
  const rawPath = hexLineDraw(ship.position, destination);
  const gravityEffects: GravityEffect[] = [];

  applyGravity(rawPath, destination, map, gravityEffects, (newDest) => { destination = newDest; });

  // Compute final path with gravity-adjusted destination
  const finalPath = hexLineDraw(ship.position, destination);
  const newVelocity = hexSubtract(destination, ship.position);

  const { crashed, crashBody } = checkCrash(finalPath, map);
  const landedAt = checkLanding(destination, newVelocity, map);

  return {
    destination,
    path: finalPath,
    newVelocity,
    fuelSpent,
    gravityEffects,
    crashed,
    crashBody,
    landedAt,
  };
}

/**
 * Walk the path and apply gravity deflections to the destination.
 * Gravity hexes deflect the endpoint by 1 hex in the gravity direction.
 * Skip the starting hex (gravity applies after entering a hex).
 */
function applyGravity(
  path: HexCoord[],
  destination: HexCoord,
  map: SolarSystemMap,
  effects: GravityEffect[],
  setDestination: (d: HexCoord) => void,
): void {
  let dest = destination;

  // Skip index 0 (starting position — gravity doesn't apply on departure hex)
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.gravity) {
      const grav = hex.gravity;

      // Weak gravity: player can ignore a single weak gravity hex
      // For now, always apply (weak gravity choice will be added later as a UI option)
      // TODO: Add weak gravity player choice

      const deflection = HEX_DIRECTIONS[grav.direction];
      dest = hexAdd(dest, deflection);
      effects.push({
        hex: path[i],
        direction: grav.direction,
        bodyName: grav.bodyName,
      });
    }
  }

  setDestination(dest);
}

/**
 * Check if any hex in the path would result in a crash (ship hits a planetary body).
 * Skip the first hex (departure) and last hex (destination is checked separately for landing).
 */
function checkCrash(path: HexCoord[], map: SolarSystemMap): { crashed: boolean; crashBody: string | null } {
  // Check intermediate hexes (not start, not end) for body collisions
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.body) {
      // Ship hit a body — it crashes unless it's landing (handled by checkLanding)
      // For intermediate hexes, it's always a crash
      if (i < path.length - 1) {
        return { crashed: true, crashBody: hex.body.name };
      }
      // For the final hex, it's a crash unless the ship is stopping (velocity = 0)
      // This is handled by the caller checking landedAt
      if (hex.body.destructive) {
        return { crashed: true, crashBody: hex.body.name };
      }
    }
  }
  return { crashed: false, crashBody: null };
}

/**
 * Check if the ship lands: velocity is zero and destination has a base.
 */
function checkLanding(
  destination: HexCoord,
  velocity: HexVec,
  map: SolarSystemMap,
): string | null {
  if (velocity.dq !== 0 || velocity.dr !== 0) return null;

  const hex = map.hexes.get(hexKey(destination));
  if (hex?.base) {
    return hex.base.bodyName;
  }
  // Stopped on a body surface without a base — also counts as landing for some bodies
  // (asteroids like Ceres you can stop at)
  if (hex?.body && !hex.body.destructive) {
    return hex.body.name;
  }
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
