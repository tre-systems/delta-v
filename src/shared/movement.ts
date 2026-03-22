import { SHIP_STATS } from './constants';
import {
  analyzeHexLine,
  HEX_DIRECTIONS,
  type HexCoord,
  type HexVec,
  hexAdd,
  hexDirectionToward,
  hexKey,
  hexLineDraw,
  hexSubtract,
  hexVecLength,
} from './hex';
import { bodyHasGravity } from './map-data';
import type {
  CourseResult,
  GravityEffect,
  Ship,
  SolarSystemMap,
} from './types';

export interface CourseOptions {
  overload?: number | null;
  weakGravityChoices?: Record<string, boolean>;
  destroyedBases?: string[];
}

/**
 * Apply pending gravity deflections entered on the
 * previous turn.
 */
export const applyPendingGravityEffects = (
  destination: HexCoord,
  effects: GravityEffect[] | undefined,
): HexCoord =>
  (effects ?? []).reduce(
    (dest, effect) =>
      effect.ignored ? dest : hexAdd(dest, HEX_DIRECTIONS[effect.direction]),
    destination,
  );

/**
 * Collect gravity hexes entered during this move.
 *
 * The starting hex is skipped because its effect would
 * already have been queued on a previous turn. The
 * destination hex is included because entering it now
 * means its gravity applies on the following turn.
 *
 * Weak gravity: player may choose to ignore a single
 * weak gravity hex. Two consecutive weak gravity hexes
 * from the same body = mandatory on the second.
 */
export const collectEnteredGravityEffects = (
  path: HexCoord[],
  map: SolarSystemMap,
  weakGravityChoices: Record<string, boolean> = {},
): GravityEffect[] => {
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
};

const canLandAtPlanetaryBase = (
  ship: Ship,
  bodyName: string,
  fuelSpent: number,
  map: SolarSystemMap,
  destroyedBases: Set<string>,
): boolean => {
  if (fuelSpent !== 1) return false;
  if (hexVecLength(ship.velocity) !== 1) return false;

  const currentHex = map.hexes.get(hexKey(ship.position));
  if (currentHex?.gravity?.bodyName !== bodyName) {
    return false;
  }

  const projectedDrift = applyPendingGravityEffects(
    hexAdd(ship.position, ship.velocity),
    ship.pendingGravityEffects,
  );
  const projectedHex = map.hexes.get(hexKey(projectedDrift));

  if (projectedHex?.gravity?.bodyName === bodyName) {
    return true;
  }

  return (
    projectedHex?.base?.bodyName === bodyName &&
    !destroyedBases.has(hexKey(projectedDrift))
  );
};

/**
 * Check whether the ship completes a legal landing.
 */
const checkLanding = (
  ship: Ship,
  destination: HexCoord,
  newVelocity: HexVec,
  fuelSpent: number,
  map: SolarSystemMap,
  destroyedBases: Set<string>,
): string | null => {
  const key = hexKey(destination);
  const hex = map.hexes.get(key);

  if (hex?.base && !destroyedBases.has(key)) {
    if (bodyHasGravity(hex.base.bodyName, map)) {
      return canLandAtPlanetaryBase(
        ship,
        hex.base.bodyName,
        fuelSpent,
        map,
        destroyedBases,
      )
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
};

/**
 * Check if any hex in the path causes a crash.
 * Intermediate body hexes = crash (except skipBody
 * for takeoff). Final hex: destructive bodies crash,
 * non-destructive = landing.
 */
const checkCrash = (
  path: HexCoord[],
  map: SolarSystemMap,
  landedAt: string | null,
  skipBody?: string,
): { crashed: boolean; crashBody: string | null } => {
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));

    if (hex?.body) {
      if (i < path.length - 1) {
        if (skipBody && hex.body.name === skipBody) {
          continue;
        }

        return {
          crashed: true,
          crashBody: hex.body.name,
        };
      }

      if (hex.body.destructive || landedAt === null) {
        return {
          crashed: true,
          crashBody: hex.body.name,
        };
      }
    }
  }

  return { crashed: false, crashBody: null };
};

/**
 * Compute the course for a ship given a burn direction.
 *
 * Pipeline (order matters — each stage feeds the next):
 * 1. Predict destination = position + velocity (inertia)
 * 2. Apply burn (optional): shift destination by 1 hex
 * 3. Apply overload (optional, warships only): shift
 *    by another hex, costs 2 fuel total
 * 4. Apply pending gravity from hexes entered last turn
 *    (gravity is always one turn delayed)
 * 5. Trace the path via hexLineDraw and collect new
 *    gravity hexes entered this turn (queued for step 4
 *    next turn). Weak gravity choices are resolved here:
 *    one weak hex per turn may be ignored, but two
 *    consecutive weak hexes from the same body forces
 *    the second.
 * 6. Determine outcome: crash (path crosses a body),
 *    landing (speed 1 at a gravity hex + base), or
 *    normal movement. Takeoff is a special case that
 *    replaces steps 1-3 with a booster launch.
 */
export const computeCourse = (
  ship: Ship,
  burn: number | null,
  map: SolarSystemMap,
  options?: CourseOptions,
): CourseResult => {
  const {
    overload = null,
    weakGravityChoices = {},
    destroyedBases: destroyedBasesList = [],
  } = options ?? {};

  const destroyedBases = new Set(destroyedBasesList);

  if (ship.lifecycle === 'landed') {
    // No burn = stay landed
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

    // Takeoff: boosters move ship 1 hex away from planet
    // center. Gravity cancels this, leaving ship
    // stationary in the gravity hex. Then the player's
    // burn is applied from there.
    const baseHex = map.hexes.get(hexKey(ship.position));
    const bodyName = baseHex?.base?.bodyName ?? baseHex?.body?.name;

    let launchHex = ship.position;

    if (bodyName) {
      const body = map.bodies.find((b) => b.name === bodyName);

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

    // After booster + gravity cancel, ship is stationary
    // at launchHex.
    let destination: HexCoord = hexAdd(launchHex, HEX_DIRECTIONS[burn]);
    let fuelSpent = 1;

    // Overload on takeoff
    if (overload !== null) {
      const stats = SHIP_STATS[ship.type];

      if (stats?.canOverload && ship.fuel >= 2) {
        destination = hexAdd(destination, HEX_DIRECTIONS[overload]);
        fuelSpent = 2;
      }
    }

    // Takeoff enters the launch gravity hex before the
    // ship's burn resolves.
    const takeoffGravityEffects = collectEnteredGravityEffects(
      [ship.position, launchHex],
      map,
      weakGravityChoices,
    );
    const gravityEffects = [...takeoffGravityEffects];

    destination = applyPendingGravityEffects(destination, gravityEffects);

    const finalPath = hexLineDraw(launchHex, destination);
    const enteredGravityEffects = collectEnteredGravityEffects(
      finalPath,
      map,
      weakGravityChoices,
    );
    const newVelocity = hexSubtract(destination, launchHex);

    const landedAt = checkLanding(
      ship,
      destination,
      newVelocity,
      fuelSpent,
      map,
      destroyedBases,
    );
    const { crashed, crashBody } = checkCrash(
      finalPath,
      map,
      landedAt,
      bodyName ?? undefined,
    );

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
  let destination: HexCoord = hexAdd(ship.position, ship.velocity);
  let fuelSpent = 0;

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

  // Gravity applies one turn after entry, so only
  // previously queued gravity affects this move.
  const gravityEffects = (ship.pendingGravityEffects ?? []).map((effect) => ({
    ...effect,
  }));

  destination = applyPendingGravityEffects(destination, gravityEffects);

  const finalPath = hexLineDraw(ship.position, destination);
  const enteredGravityEffects = collectEnteredGravityEffects(
    finalPath,
    map,
    weakGravityChoices,
  );
  const newVelocity = hexSubtract(destination, ship.position);

  const landedAt = checkLanding(
    ship,
    destination,
    newVelocity,
    fuelSpent,
    map,
    destroyedBases,
  );
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
};

/**
 * Check if a ship can burn fuel.
 */
export const canBurn = (ship: Ship): boolean => ship.fuel > 0;

/**
 * Predict where a ship will be next turn with no burn
 * (for display).
 */
export const predictDestination = (ship: Ship): HexCoord => {
  if (ship.lifecycle === 'landed') return ship.position;

  return applyPendingGravityEffects(
    hexAdd(ship.position, ship.velocity),
    ship.pendingGravityEffects,
  );
};
