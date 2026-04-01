import { SHIP_STATS } from './constants';
import {
  analyzeHexLine,
  HEX_DIRECTIONS,
  type HexCoord,
  type HexVec,
  hexAdd,
  hexDistance,
  hexKey,
  hexLineDraw,
  hexSubtract,
  hexVecLength,
} from './hex';
import { bodyHasGravity, findBaseHexes } from './map-data';
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
  land?: boolean;
}

// Apply pending gravity deflections entered on the
// previous turn.
export const applyPendingGravityEffects = (
  destination: HexCoord,
  effects: GravityEffect[] | undefined,
): HexCoord =>
  (effects ?? []).reduce(
    (dest, effect) =>
      effect.ignored ? dest : hexAdd(dest, HEX_DIRECTIONS[effect.direction]),
    destination,
  );

// Collect gravity hexes entered during this move.
//
// The starting hex is skipped because its effect would
// already have been queued on a previous turn. The
// destination hex is included because entering it now
// means its gravity applies on the following turn.
//
// Weak gravity: player may choose to ignore a single
// weak gravity hex. Two consecutive weak gravity hexes
// from the same body = mandatory on the second.
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

// Detect whether a ship is in orbit around a gravity
// body. Orbit = speed 1, positioned in a gravity hex,
// and natural drift (velocity + pending gravity) would
// keep the ship near the same body. Returns the body
// name if in orbit, null otherwise.
export const detectOrbit = (ship: Ship, map: SolarSystemMap): string | null => {
  if (hexVecLength(ship.velocity) !== 1) return null;

  const currentHex = map.hexes.get(hexKey(ship.position));

  if (!currentHex?.gravity) return null;

  const { bodyName } = currentHex.gravity;

  if (!bodyHasGravity(bodyName, map)) return null;

  const projectedDrift = applyPendingGravityEffects(
    hexAdd(ship.position, ship.velocity),
    ship.pendingGravityEffects,
  );
  const projectedHex = map.hexes.get(hexKey(projectedDrift));

  if (projectedHex?.gravity?.bodyName === bodyName) {
    return bodyName;
  }

  if (projectedHex?.base?.bodyName === bodyName) {
    return bodyName;
  }

  return null;
};

// Find the closest non-destroyed base hex for a body.
const findLandingBase = (
  bodyName: string,
  shipPosition: HexCoord,
  map: SolarSystemMap,
  destroyedBases: Set<string>,
): HexCoord | null => {
  const bases = findBaseHexes(map, bodyName).filter(
    (b) => !destroyedBases.has(hexKey(b)),
  );

  if (bases.length === 0) return null;

  return bases.reduce((closest, b) =>
    hexDistance(shipPosition, b) < hexDistance(shipPosition, closest)
      ? b
      : closest,
  );
};

// Check whether the ship completes a legal landing.
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

// Check if any hex in the path causes a crash.
// Intermediate body hexes = crash (except skipBody
// for takeoff). Final hex: destructive bodies crash,
// non-destructive = landing.
const checkCrash = (
  path: HexCoord[],
  map: SolarSystemMap,
  landedAt: string | null,
  skipBody?: string,
): { crashed: true; crashBody: string; crashHex: HexCoord } | null => {
  for (let i = 1; i < path.length; i++) {
    const coord = path[i];
    const hex = map.hexes.get(hexKey(coord));

    if (hex?.body) {
      if (i < path.length - 1) {
        if (skipBody && hex.body.name === skipBody) {
          continue;
        }

        return {
          crashed: true,
          crashBody: hex.body.name,
          crashHex: coord,
        };
      }

      if (hex.body.destructive || landedAt === null) {
        return {
          crashed: true,
          crashBody: hex.body.name,
          crashHex: coord,
        };
      }
    }
  }

  return null;
};

// Compute the course for a ship given a burn direction.
//
// Pipeline (order matters — each stage feeds the next):
// 1. Predict destination = position + velocity (inertia)
// 2. Apply burn (optional): shift destination by 1 hex
// 3. Apply overload (optional, warships only): shift
//    by another hex, costs 2 fuel total
// 4. Apply pending gravity from hexes entered last turn
//    (gravity is always one turn delayed)
// 5. Trace the path via hexLineDraw and collect new
//    gravity hexes entered this turn (queued for step 4
//    next turn). Weak gravity choices are resolved here:
//    one weak hex per turn may be ignored, but two
//    consecutive weak hexes from the same body forces
//    the second.
// 6. Determine outcome: crash (path crosses a body),
//    landing (speed 1 at a gravity hex + base), or
//    normal movement. Takeoff is a special case that
//    replaces steps 1-3 with a booster launch.
type ComputeCourseInput = {
  ship: Ship;
  burn: number | null;
  map: SolarSystemMap;
  overload: number | null;
  weakGravityChoices: Record<string, boolean>;
  destroyedBases: Set<string>;
  land: boolean;
};

const computeNormalCourse = ({
  ship,
  burn,
  map,
  overload,
  weakGravityChoices,
  destroyedBases,
  land,
}: ComputeCourseInput): CourseResult => {
  // A landed ship with no burn stays landed
  if (ship.lifecycle === 'landed' && burn === null) {
    const hex = map.hexes.get(hexKey(ship.position));
    const bodyName = hex?.base?.bodyName ?? hex?.body?.name ?? '';
    return {
      destination: ship.position,
      path: [ship.position],
      newVelocity: { dq: 0, dr: 0 },
      fuelSpent: 0,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'landing',
      landedAt: bodyName,
    };
  }

  let destination: HexCoord = hexAdd(ship.position, ship.velocity);
  let fuelSpent = 0;

  if (burn !== null && ship.fuel > 0) {
    destination = hexAdd(destination, HEX_DIRECTIONS[burn]);
    fuelSpent = 1;
  }

  if (overload !== null && burn !== null) {
    const stats = SHIP_STATS[ship.type];

    if (stats?.canOverload && ship.fuel >= 2) {
      destination = hexAdd(destination, HEX_DIRECTIONS[overload]);
      fuelSpent = 2;
    }
  }

  // Orbital landing: per Triplanetary rules, a ship in
  // orbit that burns 1 fuel lands at the planet's base.
  // The burn direction is irrelevant — landing is a
  // special action that overrides normal trajectory.
  // The player must explicitly choose to land (land
  // flag) rather than continuing in orbit.
  //
  // We check orbit on both the current state and the
  // post-burn state so that a ship can burn into orbit
  // and land in the same turn (avoiding an extra turn
  // of base defense fire).
  if (land && fuelSpent === 1) {
    const dir = burn !== null ? HEX_DIRECTIONS[burn] : { dq: 0, dr: 0 };
    const postBurnShip: Ship = {
      ...ship,
      position: destination,
      velocity: {
        dq: ship.velocity.dq + dir.dq,
        dr: ship.velocity.dr + dir.dr,
      },
      pendingGravityEffects: [],
    };
    const orbitBody = detectOrbit(ship, map) ?? detectOrbit(postBurnShip, map);

    if (orbitBody) {
      const baseHex = findLandingBase(
        orbitBody,
        ship.position,
        map,
        destroyedBases,
      );

      if (baseHex) {
        const landPath = hexLineDraw(ship.position, baseHex);

        return {
          destination: baseHex,
          path: landPath,
          newVelocity: hexSubtract(baseHex, ship.position),
          fuelSpent,
          gravityEffects: (ship.pendingGravityEffects ?? []).map((e) => ({
            ...e,
          })),
          enteredGravityEffects: collectEnteredGravityEffects(
            landPath,
            map,
            weakGravityChoices,
          ),
          outcome: 'landing' as const,
          landedAt: orbitBody,
        };
      }
    }
  }

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
  const crash = checkCrash(finalPath, map, landedAt);

  const base = {
    destination,
    path: finalPath,
    newVelocity,
    fuelSpent,
    gravityEffects,
    enteredGravityEffects,
  };

  if (crash) {
    return {
      ...base,
      outcome: 'crash' as const,
      crashBody: crash.crashBody,
      crashHex: crash.crashHex,
    };
  }
  if (landedAt) {
    return { ...base, outcome: 'landing' as const, landedAt };
  }
  return { ...base, outcome: 'normal' as const };
};

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
    land = false,
  } = options ?? {};

  const input: ComputeCourseInput = {
    ship,
    burn,
    map,
    overload,
    weakGravityChoices,
    destroyedBases: new Set(destroyedBasesList),
    land,
  };

  return computeNormalCourse(input);
};

// Check if a ship can burn fuel.
export const canBurn = (ship: Ship): boolean => ship.fuel > 0;

// Predict where an entity (ship or ordnance) will be next turn with
// no burn (for display).
export const predictDestination = (entity: {
  position: HexCoord;
  velocity: HexVec;
  lifecycle?: string;
  pendingGravityEffects?: GravityEffect[];
}): HexCoord => {
  if (entity.lifecycle === 'landed') return entity.position;

  return applyPendingGravityEffects(
    hexAdd(entity.position, entity.velocity),
    entity.pendingGravityEffects,
  );
};
