import { canAttack } from '../combat';
import {
  HEX_DIRECTIONS,
  type HexKey,
  hexAdd,
  hexDistance,
  hexVecLength,
  parseHexKey,
} from '../hex';
import { findBaseHexes } from '../map-data';
import { computeCourse } from '../movement';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  CourseResult,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { minBy } from '../util';
import type { AIDifficultyConfig } from './config';

export const findDirectionToward = (
  from: {
    q: number;
    r: number;
  },
  to: {
    q: number;
    r: number;
  },
): number => {
  const { dir } = HEX_DIRECTIONS.reduce(
    (best, dirVec, d) => {
      const dist = hexDistance(hexAdd(from, dirVec), to);
      return dist < best.dist ? { dir: d, dist } : best;
    },
    { dir: 0, dist: Infinity },
  );

  return dir;
};

export const findNearestBase = (
  shipPos: {
    q: number;
    r: number;
  },
  playerBases: HexKey[],
  _map: SolarSystemMap,
): {
  q: number;
  r: number;
} | null => {
  const nearest = minBy(playerBases, (baseKey) =>
    hexDistance(shipPos, parseHexKey(baseKey)),
  );

  return nearest ? parseHexKey(nearest) : null;
};

export const findNearestRefuelBase = (
  shipPos: {
    q: number;
    r: number;
  },
  playerBases: HexKey[],
  sharedBaseBodies: readonly string[],
  map: SolarSystemMap,
): {
  q: number;
  r: number;
} | null => {
  const candidateBases = [
    ...playerBases.map((baseKey) => parseHexKey(baseKey)),
    ...sharedBaseBodies.flatMap((bodyName) => findBaseHexes(map, bodyName)),
  ];
  const nearest = minBy(candidateBases, (base) => hexDistance(shipPos, base));

  return nearest ?? null;
};

// `findNearestRefuelBase` picks by raw hex distance, which lies when the
// ship has momentum carrying it away from the "closest" base — the picker
// commits to a target the ship physically cannot reach in a few turns
// without burning more fuel than it owns. This variant runs the bounded
// short-horizon planner (which threads through `computeCourse`, so it
// honours velocity and gravity) against each candidate and returns the
// closest base that has an actual reachable plan within the fuel the ship
// already has. Returns null when no candidate is reachable; callers can
// fall back to `findNearestRefuelBase` to keep moving rather than stall.
export const findReachableRefuelBase = (
  ship: Ship,
  playerBases: HexKey[],
  sharedBaseBodies: readonly string[],
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
  maxTurns = 3,
): {
  q: number;
  r: number;
} | null => {
  const candidateBases = [
    ...playerBases.map((baseKey) => parseHexKey(baseKey)),
    ...sharedBaseBodies.flatMap((bodyName) => findBaseHexes(map, bodyName)),
  ];
  if (candidateBases.length === 0) return null;

  // Sort by hex distance first so we evaluate near-misses cheapest-first,
  // and so a tie in plan quality favours the geometrically closer base.
  const ordered = [...candidateBases].sort(
    (a, b) => hexDistance(ship.position, a) - hexDistance(ship.position, b),
  );

  let best: {
    base: { q: number; r: number };
    finalDistance: number;
    fuelSpent: number;
  } | null = null;

  for (const base of ordered) {
    const plan = planShortHorizonMovementToHex(
      ship,
      base,
      map,
      destroyedBases,
      maxTurns,
    );
    if (!plan) continue;
    if (plan.fuelSpent > ship.fuel) continue;
    if (
      best === null ||
      plan.finalDistance < best.finalDistance ||
      (plan.finalDistance === best.finalDistance &&
        plan.fuelSpent < best.fuelSpent)
    ) {
      best = {
        base,
        finalDistance: plan.finalDistance,
        fuelSpent: plan.fuelSpent,
      };
    }
  }

  return best ? best.base : null;
};

export const estimateFuelForTravelDistance = (
  distance: number,
  currentSpeed = 0,
): number => Math.ceil((distance * 2) / 3) + currentSpeed + 1;

export interface ShortHorizonMovementPlan {
  firstBurn: number | null;
  turns: number;
  finalDistance: number;
  finalSpeed: number;
  fuelSpent: number;
}

export interface MovementCostToHex {
  firstBurn: number | null;
  planned: boolean;
  turns: number;
  finalDistance: number;
  finalSpeed: number;
  fuelSpent: number;
  estimatedFuelCost: number;
  score: number;
  reachableWithinFuel: boolean;
}

export const planShortHorizonMovementToHex = (
  ship: Ship,
  targetHex: { q: number; r: number },
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
  maxTurns = 3,
): ShortHorizonMovementPlan | null => {
  const initialDistance = hexDistance(ship.position, targetHex);
  const directions = [null, 0, 1, 2, 3, 4, 5] as const;
  const queue: Array<{
    ship: Ship;
    firstBurn: number | null;
    turns: number;
    fuelSpent: number;
  }> = [{ ship, firstBurn: null, turns: 0, fuelSpent: 0 }];
  const seen = new Set<string>();
  let bestPlan: ShortHorizonMovementPlan | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.turns >= maxTurns) continue;

    for (const burn of directions) {
      if (burn !== null && current.ship.fuel <= 0) continue;

      const course = computeCourse(current.ship, burn, map, {
        destroyedBases,
      });

      if (course.outcome === 'crash') continue;

      const projectedShip = projectShipAfterCourse(current.ship, course);
      const turns = current.turns + 1;
      const firstBurn = current.turns === 0 ? burn : current.firstBurn;
      const fuelSpent = current.fuelSpent + course.fuelSpent;
      const finalDistance = hexDistance(course.destination, targetHex);
      const speed =
        Math.abs(course.newVelocity.dq) + Math.abs(course.newVelocity.dr);
      const cost = finalDistance * 100 + turns * 8 + speed * 4 + fuelSpent;

      if (finalDistance < initialDistance && cost < bestCost) {
        bestCost = cost;
        bestPlan = {
          firstBurn,
          turns,
          finalDistance,
          finalSpeed: speed,
          fuelSpent,
        };
      }

      const key = JSON.stringify({
        p: projectedShip.position,
        v: projectedShip.velocity,
        f: projectedShip.fuel,
        turns,
      });

      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        ship: projectedShip,
        firstBurn,
        turns,
        fuelSpent,
      });
    }
  }

  return bestPlan;
};

export const estimateMovementCostToHex = (
  ship: Ship,
  targetHex: { q: number; r: number },
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
  maxTurns = 4,
): MovementCostToHex => {
  const directDistance = hexDistance(ship.position, targetHex);
  const directSpeed = hexVecLength(ship.velocity);
  const heuristicFuelCost = estimateFuelForTravelDistance(
    directDistance,
    directSpeed,
  );
  const fallback: MovementCostToHex = {
    firstBurn: null,
    planned: false,
    turns: Math.max(
      1,
      Math.ceil(directDistance / Math.max(1, directSpeed + 1)),
    ),
    finalDistance: directDistance,
    finalSpeed: directSpeed,
    fuelSpent: 0,
    estimatedFuelCost: heuristicFuelCost,
    score: directDistance * 85 + directSpeed * 16 + heuristicFuelCost * 45,
    reachableWithinFuel: heuristicFuelCost <= ship.fuel,
  };
  const plan = planShortHorizonMovementToHex(
    ship,
    targetHex,
    map,
    destroyedBases,
    maxTurns,
  );

  if (plan == null) {
    return fallback;
  }

  const remainingFuelCost =
    plan.finalDistance === 0 && plan.finalSpeed === 0
      ? 0
      : estimateFuelForTravelDistance(plan.finalDistance, plan.finalSpeed);
  const estimatedFuelCost = plan.fuelSpent + remainingFuelCost;

  return {
    firstBurn: plan.firstBurn,
    planned: true,
    turns: plan.turns,
    finalDistance: plan.finalDistance,
    finalSpeed: plan.finalSpeed,
    fuelSpent: plan.fuelSpent,
    estimatedFuelCost,
    score:
      plan.turns * 35 +
      plan.finalDistance * 85 +
      plan.finalSpeed * 16 +
      estimatedFuelCost * 45,
    reachableWithinFuel: estimatedFuelCost <= ship.fuel,
  };
};

const GRAND_TOUR_CHECKPOINT_SET = new Set([
  'Sol',
  'Mercury',
  'Venus',
  'Terra',
  'Mars',
  'Jupiter',
  'Io',
  'Callisto',
]);

const GRAND_TOUR_ROUTE_BY_HOME: Record<string, readonly string[]> = {
  Luna: [
    'Sol',
    'Terra',
    'Mercury',
    'Venus',
    'Mars',
    'Io',
    'Jupiter',
    'Callisto',
  ],
  Mars: [
    'Callisto',
    'Jupiter',
    'Io',
    'Terra',
    'Mercury',
    'Sol',
    'Venus',
    'Mars',
  ],
};

const resolveGrandTourRoute = (
  player: {
    homeBody: string;
  },
  checkpoints: readonly string[],
): readonly string[] | null => {
  if (
    checkpoints.length !== GRAND_TOUR_CHECKPOINT_SET.size ||
    checkpoints.some((body) => !GRAND_TOUR_CHECKPOINT_SET.has(body))
  ) {
    return null;
  }

  return GRAND_TOUR_ROUTE_BY_HOME[player.homeBody] ?? null;
};

export const pickNextCheckpoint = (
  player: {
    visitedBodies?: string[];
    homeBody: string;
  },
  checkpoints: readonly string[],
  map: SolarSystemMap,
  shipPos?: {
    q: number;
    r: number;
  },
): string | null => {
  const visited = new Set(player.visitedBodies ?? []);
  const unvisited = checkpoints.filter((body) => !visited.has(body));
  const scriptedGrandTourRoute = resolveGrandTourRoute(player, checkpoints);

  if (unvisited.length === 0) return player.homeBody;
  if (scriptedGrandTourRoute) {
    const nextWaypoint = scriptedGrandTourRoute.find(
      (body) => !visited.has(body),
    );
    if (nextWaypoint) {
      return nextWaypoint;
    }
    return player.homeBody;
  }

  if (!shipPos) return unvisited[0];

  const bodyCenters = new Map(
    map.bodies.map((body) => [body.name, body.center] as const),
  );
  const homeCenter = bodyCenters.get(player.homeBody);
  const routeBodies = unvisited.filter((body) => bodyCenters.has(body));

  const getRemainingTourCost = createRemainingTourCostEstimator(
    routeBodies,
    bodyCenters,
    homeCenter,
  );

  if (!homeCenter || routeBodies.length === 0) {
    return unvisited.reduce((best, name) => {
      const body = bodyCenters.get(name);
      const bestBody = bodyCenters.get(best);

      if (!body) return best;

      return hexDistance(shipPos, body) <
        hexDistance(shipPos, bestBody ?? shipPos)
        ? name
        : best;
    }, unvisited[0]);
  }

  let bestBody = routeBodies[0];
  let bestCost = Number.POSITIVE_INFINITY;
  let bestDirectDist = Number.POSITIVE_INFINITY;
  const fullMask = (1 << routeBodies.length) - 1;

  for (let i = 0; i < routeBodies.length; i++) {
    const nextBody = routeBodies[i];
    const nextCenter = bodyCenters.get(nextBody);

    if (!nextCenter) {
      continue;
    }

    const directDist = hexDistance(shipPos, nextCenter);
    const totalCost =
      directDist + getRemainingTourCost(nextBody, fullMask ^ (1 << i));

    if (
      totalCost < bestCost ||
      (totalCost === bestCost && directDist < bestDirectDist)
    ) {
      bestBody = nextBody;
      bestCost = totalCost;
      bestDirectDist = directDist;
    }
  }

  return bestBody;
};

const createRemainingTourCostEstimator = (
  routeBodies: readonly string[],
  bodyCenters: ReadonlyMap<string, { q: number; r: number }>,
  homeCenter: { q: number; r: number } | undefined,
): ((fromBody: string, remainingMask: number) => number) => {
  const memo = new Map<string, number>();
  const getRemainingTourCost = (
    fromBody: string,
    remainingMask: number,
  ): number => {
    const cacheKey = `${fromBody}|${remainingMask}`;
    const cached = memo.get(cacheKey);

    if (cached != null) {
      return cached;
    }

    const fromCenter = bodyCenters.get(fromBody);

    if (!fromCenter || !homeCenter) {
      return Number.POSITIVE_INFINITY;
    }

    if (remainingMask === 0) {
      const finalLeg = hexDistance(fromCenter, homeCenter);

      memo.set(cacheKey, finalLeg);
      return finalLeg;
    }

    let bestCost = Number.POSITIVE_INFINITY;

    for (let i = 0; i < routeBodies.length; i++) {
      if ((remainingMask & (1 << i)) === 0) {
        continue;
      }

      const nextBody = routeBodies[i];
      const nextCenter = bodyCenters.get(nextBody);

      if (!nextCenter) {
        continue;
      }

      const candidateCost =
        hexDistance(fromCenter, nextCenter) +
        getRemainingTourCost(nextBody, remainingMask ^ (1 << i));

      if (candidateCost < bestCost) {
        bestCost = candidateCost;
      }
    }

    memo.set(cacheKey, bestCost);
    return bestCost;
  };

  return getRemainingTourCost;
};

export const estimateRemainingCheckpointTourCost = (
  player: {
    visitedBodies?: string[];
    homeBody: string;
  },
  checkpoints: readonly string[],
  map: SolarSystemMap,
  shipPos?: {
    q: number;
    r: number;
  },
): number => {
  if (!shipPos) {
    return Number.POSITIVE_INFINITY;
  }

  const visited = new Set(player.visitedBodies ?? []);
  const unvisited = checkpoints.filter((body) => !visited.has(body));
  const bodyCenters = new Map(
    map.bodies.map((body) => [body.name, body.center] as const),
  );
  const homeCenter = bodyCenters.get(player.homeBody);

  if (!homeCenter) {
    return Number.POSITIVE_INFINITY;
  }

  if (unvisited.length === 0) {
    return hexDistance(shipPos, homeCenter);
  }

  const routeBodies = unvisited.filter((body) => bodyCenters.has(body));

  if (routeBodies.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const getRemainingTourCost = createRemainingTourCostEstimator(
    routeBodies,
    bodyCenters,
    homeCenter,
  );
  const fullMask = (1 << routeBodies.length) - 1;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let i = 0; i < routeBodies.length; i++) {
    const nextBody = routeBodies[i];
    const nextCenter = bodyCenters.get(nextBody);

    if (!nextCenter) {
      continue;
    }

    const candidateCost =
      hexDistance(shipPos, nextCenter) +
      getRemainingTourCost(nextBody, fullMask ^ (1 << i));

    if (candidateCost < bestCost) {
      bestCost = candidateCost;
    }
  }

  return bestCost;
};

export const projectShipAfterCourse = (
  ship: Ship,
  course: CourseResult,
): Ship => ({
  ...ship,
  position: course.destination,
  velocity: course.newVelocity,
  fuel: Math.max(0, ship.fuel - course.fuelSpent),
  pendingGravityEffects: course.enteredGravityEffects,
  lifecycle: course.outcome === 'landing' ? 'landed' : 'active',
});

export const estimateTurnsToTargetLanding = (
  ship: Ship,
  targetBody: string,
  map: SolarSystemMap,
  destroyedBases: HexKey[],
  maxAdditionalTurns = 2,
): number | null => {
  if (!targetBody) {
    return null;
  }

  const directions = [null, 0, 1, 2, 3, 4, 5] as const;
  const queue: Array<{ ship: Ship; turns: number }> = [{ ship, turns: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    const key = JSON.stringify({
      position: current.ship.position,
      velocity: current.ship.velocity,
      fuel: current.ship.fuel,
      lifecycle: current.ship.lifecycle,
      pendingGravityEffects: current.ship.pendingGravityEffects,
      turns: current.turns,
    });

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (current.turns >= maxAdditionalTurns) {
      continue;
    }

    for (const burn of directions) {
      for (const land of [false, true]) {
        const nextCourse = computeCourse(current.ship, burn, map, {
          land,
          destroyedBases,
        });

        if (nextCourse.outcome === 'crash') {
          continue;
        }

        if (
          nextCourse.outcome === 'landing' &&
          nextCourse.landedAt === targetBody
        ) {
          return current.turns + 1;
        }

        queue.push({
          ship: projectShipAfterCourse(current.ship, nextCourse),
          turns: current.turns + 1,
        });
      }
    }
  }

  return null;
};

const isSingleShipObjectiveDuel = (state: GameState): boolean => {
  const caps = deriveCapabilities(state.scenarioRules);
  if (caps.isCheckpointRace || caps.targetWinRequiresPassengers) {
    return false;
  }

  return state.players.every((player, playerId) => {
    if (!player.targetBody || !player.homeBody) {
      return false;
    }

    const activeCombatShips = state.ships.filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        ship.baseStatus !== 'emplaced' &&
        canAttack(ship),
    );

    return activeCombatShips.length === 1;
  });
};

export const getHomeDefenseThreat = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  enemyShips: Ship[],
): Ship | null => {
  const HOME_DEFENSE_EMERGENCY_RANGE = 4;
  const HOME_DEFENSE_MIN_OBJECTIVE_ADVANTAGE = 5;

  if (!isSingleShipObjectiveDuel(state)) {
    return null;
  }

  const player = state.players[playerId];
  const homeHex = map.bodies.find(
    (body) => body.name === player.homeBody,
  )?.center;
  const targetHex = map.bodies.find(
    (body) => body.name === player.targetBody,
  )?.center;

  if (!homeHex || !targetHex) {
    return null;
  }

  const myCombatShips = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.baseStatus !== 'emplaced' &&
      canAttack(ship),
  );
  const enemyCombatShips = enemyShips.filter(canAttack);

  if (myCombatShips.length === 0 || enemyCombatShips.length === 0) {
    return null;
  }

  const myBestObjectiveDistance = Math.min(
    ...myCombatShips.map((ship) =>
      hexDistance(hexAdd(ship.position, ship.velocity), targetHex),
    ),
  );
  const threat = minBy(enemyCombatShips, (enemy) =>
    hexDistance(hexAdd(enemy.position, enemy.velocity), homeHex),
  );

  if (!threat) {
    return null;
  }

  const threatDistance = hexDistance(
    hexAdd(threat.position, threat.velocity),
    homeHex,
  );

  return threatDistance <= HOME_DEFENSE_EMERGENCY_RANGE &&
    threatDistance + HOME_DEFENSE_MIN_OBJECTIVE_ADVANTAGE <
      myBestObjectiveDistance
    ? threat
    : null;
};

export const scoreObjectiveHomeDefenseCourse = (
  ship: Ship,
  course: CourseResult,
  threat: Ship,
  homeHex: { q: number; r: number },
): number => {
  const predictedThreat = hexAdd(threat.position, threat.velocity);
  const currentInterceptDistance = hexDistance(
    hexAdd(ship.position, ship.velocity),
    predictedThreat,
  );
  const nextInterceptDistance = hexDistance(
    hexAdd(course.destination, course.newVelocity),
    predictedThreat,
  );
  const threatToHomeDistance = hexDistance(predictedThreat, homeHex);
  let score = (currentInterceptDistance - nextInterceptDistance) * 18;

  if (threatToHomeDistance <= 10) {
    score += Math.max(0, 8 - nextInterceptDistance) * 8;
  }

  return score;
};

const getInterceptFocusTargets = (enemyShips: Ship[]): Ship[] => {
  const revealedFugitives = enemyShips.filter(
    (enemy) => enemy.identity?.revealed && enemy.identity.hasFugitives,
  );

  return revealedFugitives.length > 0 ? revealedFugitives : enemyShips;
};

export const getInterceptContinuationPreference = (
  ship: Ship,
  course: CourseResult,
  enemyShips: Ship[],
  shipIndex: number,
  cfg: AIDifficultyConfig,
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
): { bonus: number; tiebreak: number } => {
  if (enemyShips.length === 0) {
    return { bonus: 0, tiebreak: -Infinity };
  }

  const focusTargets = getInterceptFocusTargets(enemyShips);
  const assignedTarget =
    cfg.distributeInterceptTargets && focusTargets.length > 1
      ? focusTargets[shipIndex % focusTargets.length]
      : (minBy(focusTargets, (enemy) =>
          hexDistance(course.destination, enemy.position),
        ) ?? focusTargets[0]);

  if (!assignedTarget) {
    return { bonus: 0, tiebreak: -Infinity };
  }

  const predictedTargetPosition = hexAdd(
    assignedTarget.position,
    assignedTarget.velocity,
  );
  const targetVelocity = {
    q: assignedTarget.velocity.dq,
    r: assignedTarget.velocity.dr,
  };
  const simulatedShip = projectShipAfterCourse(ship, course);
  const currentDistance = hexDistance(
    course.destination,
    predictedTargetPosition,
  );
  const currentVelocityDelta = hexDistance(
    {
      q: course.newVelocity.dq,
      r: course.newVelocity.dr,
    },
    targetVelocity,
  );
  let bestFutureDistance = currentDistance;
  let bestVelocityDelta = currentVelocityDelta;

  for (const burn of [null, 0, 1, 2, 3, 4, 5] as const) {
    const followUp = computeCourse(simulatedShip, burn, map, {
      destroyedBases,
    });

    if (followUp.outcome === 'crash') {
      continue;
    }

    const futureDistance = hexDistance(
      followUp.destination,
      predictedTargetPosition,
    );
    const velocityDelta = hexDistance(
      {
        q: followUp.newVelocity.dq,
        r: followUp.newVelocity.dr,
      },
      targetVelocity,
    );

    if (
      futureDistance < bestFutureDistance ||
      (futureDistance === bestFutureDistance &&
        velocityDelta < bestVelocityDelta)
    ) {
      bestFutureDistance = futureDistance;
      bestVelocityDelta = velocityDelta;
    }
  }

  return {
    bonus:
      (currentDistance - bestFutureDistance) * 4 +
      (currentVelocityDelta - bestVelocityDelta),
    tiebreak: -bestFutureDistance * 20 - bestVelocityDelta,
  };
};
