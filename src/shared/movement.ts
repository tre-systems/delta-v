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
  hexDirectionToward,
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
        landedAt: null, // Already landed, no new landing event
      };
    }

    // Takeoff: ship starts at a base on a planet surface.
    // Boosters move ship 1 hex away from planet center.
    // Gravity of that hex pulls it back, so net velocity is 0.
    // The ship ends up stationary in the gravity hex above the base.
    // Then the player's burn is applied from there.
    const baseHex = map.hexes.get(hexKey(ship.position));
    const bodyName = baseHex?.base?.bodyName ?? baseHex?.body?.name;

    // Find the launch hex: the adjacent hex in the direction away from the body center.
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
          // Fallback: find any adjacent non-body hex
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
    // Apply the player's burn from there.
    destination = hexAdd(launchHex, HEX_DIRECTIONS[burn]);
    fuelSpent = ship.fuel > 0 ? 1 : 0;

    // Trace path and apply gravity from launch hex
    const path = hexLineDraw(launchHex, destination);
    const gravityEffects: GravityEffect[] = [];
    applyGravity(path, destination, map, gravityEffects, (newDest) => { destination = newDest; });

    const finalPath = hexLineDraw(launchHex, destination);
    const newVelocity = hexSubtract(destination, launchHex);

    // Skip crash check against the body we just took off from
    const { crashed, crashBody } = checkCrash(finalPath, map, newVelocity, bodyName ?? undefined);
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

  const { crashed, crashBody } = checkCrash(finalPath, map, newVelocity);
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
 * Applies gravity at the starting hex (a stationary ship in a gravity hex drifts).
 * Skips the destination hex — gravity there affects the next turn, not this move.
 * This ensures ships can land at base hexes in the gravity ring without being
 * pushed past the base into the planet body.
 */
function applyGravity(
  path: HexCoord[],
  destination: HexCoord,
  map: SolarSystemMap,
  effects: GravityEffect[],
  setDestination: (d: HexCoord) => void,
): void {
  let dest = destination;

  // Apply gravity at all hexes except the last (destination).
  // For a single-hex path (stationary ship), the hex is both start and destination,
  // so gravity still applies (the ship is IN the gravity field and gets pulled).
  const end = path.length === 1 ? path.length : path.length - 1;
  for (let i = 0; i < end; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.gravity) {
      const grav = hex.gravity;

      // Weak gravity: player can ignore a single weak gravity hex
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
 * Skip the first hex (departure).
 * Final hex: base hexes never crash (landing), destructive bodies always crash,
 * non-destructive bodies crash unless velocity is zero.
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
      // For intermediate hexes: skip the takeoff body, crash for all others
      if (i < path.length - 1) {
        if (skipBody && hex.body.name === skipBody) continue;
        return { crashed: true, crashBody: hex.body.name };
      }
      // For the final hex: destructive bodies (Sol) always crash.
      // Non-destructive bodies at the destination = landing (the ship arrives and sets down).
      if (hex.body.destructive) {
        return { crashed: true, crashBody: hex.body.name };
      }
    }
  }
  return { crashed: false, crashBody: null };
}

/**
 * Check if the ship lands at a base or body.
 * Base hexes: ship lands regardless of velocity (base docking catches the ship).
 * Body surface hexes (no base): ship must have zero velocity to land safely.
 */
function checkLanding(
  destination: HexCoord,
  velocity: HexVec,
  map: SolarSystemMap,
): string | null {
  const hex = map.hexes.get(hexKey(destination));

  // Base hexes: landing always succeeds (base catches the ship)
  if (hex?.base) {
    return hex.base.bodyName;
  }

  // Non-destructive body surface: landing (ship arrives and sets down)
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
