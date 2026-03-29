import { canAttack } from '../combat';
import {
  HEX_DIRECTIONS,
  type HexKey,
  hexAdd,
  hexDistance,
  parseHexKey,
} from '../hex';
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
import type { AIDifficulty } from './types';

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

  if (unvisited.length === 0) return player.homeBody;

  if (!shipPos) return unvisited[0];

  return unvisited.reduce((best, name) => {
    const body = map.bodies.find((candidate) => candidate.name === name);

    if (!body) return best;
    const dist = hexDistance(shipPos, body.center);
    const bestBody = map.bodies.find((candidate) => candidate.name === best);
    const bestDist = bestBody
      ? hexDistance(shipPos, bestBody.center)
      : Infinity;

    return dist < bestDist ? name : best;
  }, unvisited[0]);
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

  return threatDistance + 2 < myBestObjectiveDistance ? threat : null;
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
  difficulty: AIDifficulty,
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
): { bonus: number; tiebreak: number } => {
  if (enemyShips.length === 0) {
    return { bonus: 0, tiebreak: -Infinity };
  }

  const focusTargets = getInterceptFocusTargets(enemyShips);
  const assignedTarget =
    difficulty === 'hard' && focusTargets.length > 1
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
