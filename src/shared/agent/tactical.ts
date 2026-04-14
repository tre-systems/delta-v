// Derived tactical features for the Observation v2 payload. Pure; safe to
// import from browser, Worker, or Node. LLM agents get a cheap summary of
// the state's strategic shape without having to compute distances themselves.

import { hexDistance } from '../hex';
import type {
  CelestialBody,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types/domain';

export interface TacticalFeatures {
  // Shortest hex distance from any of your operational ships to the nearest
  // detected enemy ship. null when no enemy is detected.
  nearestEnemyDistance: number | null;
  // Total operational fuel you have minus total fuel of detected enemy ships.
  // Positive = you have the endurance advantage.
  fuelAdvantage: number;
  // Shortest distance from any of your operational ships to your targetBody.
  // null when no targetBody is set for the scenario or the body is missing.
  objectiveDistance: number | null;
  // Shortest distance from any detected enemy ship to your HOME body. null if
  // no enemies detected or home body not resolvable.
  enemyObjectiveDistance: number | null;
  // Compass label of the primary threat direction (from your fleet centroid to
  // the nearest detected enemy). null when no enemies detected.
  threatAxis: string | null;
  // Integer lower-bound estimate of turns-to-reach targetBody given your
  // current best velocity toward it. null when not computable.
  turnsToObjective: number | null;
}

const OPERATIONAL_LIFECYCLES: ReadonlySet<Ship['lifecycle']> = new Set([
  'active',
  'landed',
]);

const isOperational = (ship: Ship): boolean =>
  OPERATIONAL_LIFECYCLES.has(ship.lifecycle);

const findBody = (
  bodies: readonly CelestialBody[],
  name: string,
): CelestialBody | null => {
  if (!name) return null;
  return bodies.find((body) => body.name === name) ?? null;
};

// Compass rose used for the threatAxis hint. Axial→screen: E is +q, N is -r.
const axisLabel = (dq: number, dr: number): string => {
  if (dq === 0 && dr === 0) return 'here';
  const angle = Math.atan2(dr, dq) * (180 / Math.PI);
  // Map [-180, 180] into 8-point compass, starting at E=0deg.
  const compass = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const normalized = ((angle + 360) % 360) / 45;
  return compass[Math.round(normalized) % 8];
};

const fleetCentroid = (ships: readonly Ship[]): { q: number; r: number } => {
  let q = 0;
  let r = 0;
  let count = 0;
  for (const ship of ships) {
    q += ship.position.q;
    r += ship.position.r;
    count++;
  }
  if (count === 0) return { q: 0, r: 0 };
  return { q: q / count, r: r / count };
};

// Speed magnitude in hexes/turn along the axial axis (max of the three cube
// components). Matches describeVelocity()'s convention.
const speed = (ship: Ship): number =>
  Math.max(
    Math.abs(ship.velocity.dq),
    Math.abs(ship.velocity.dr),
    Math.abs(ship.velocity.dq + ship.velocity.dr),
  );

// Best-case "turns to reach target" estimate: use the fastest own ship's
// speed component along the vector toward the target. Very rough — just a
// hint, not a promise. Returns null when the target or any input is missing.
const estimateTurnsToObjective = (
  ownShips: readonly Ship[],
  targetBody: CelestialBody | null,
): number | null => {
  if (!targetBody || ownShips.length === 0) return null;

  let best: number | null = null;
  for (const ship of ownShips) {
    const dist = hexDistance(ship.position, targetBody.center);
    if (dist === 0) return 0;
    const s = speed(ship);
    // Ship stationary: assume at least one burn to get moving → worst case
    // dist turns. Ship moving: dist / speed rounded up.
    const turns = s === 0 ? dist : Math.max(1, Math.ceil(dist / s));
    if (best === null || turns < best) best = turns;
  }
  return best;
};

export const buildTacticalFeatures = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): TacticalFeatures => {
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const ownShips = state.ships.filter(
    (ship) => ship.owner === playerId && isOperational(ship),
  );
  const enemyShips = state.ships.filter(
    (ship) => ship.owner === opponentId && isOperational(ship) && ship.detected,
  );

  // Nearest detected enemy
  let nearestEnemyDistance: number | null = null;
  let nearestEnemyPos: { q: number; r: number } | null = null;
  for (const own of ownShips) {
    for (const enemy of enemyShips) {
      const dist = hexDistance(own.position, enemy.position);
      if (nearestEnemyDistance === null || dist < nearestEnemyDistance) {
        nearestEnemyDistance = dist;
        nearestEnemyPos = enemy.position;
      }
    }
  }

  // Fuel advantage (infinite-fuel ships excluded from both sides to keep the
  // number meaningful).
  const totalFuel = (ships: readonly Ship[]): number =>
    ships.reduce(
      (sum, ship) => (Number.isFinite(ship.fuel) ? sum + ship.fuel : sum),
      0,
    );
  const fuelAdvantage = totalFuel(ownShips) - totalFuel(enemyShips);

  // Objective / home distances
  const player = state.players[playerId];
  const opponent = state.players[opponentId];
  const targetBody = findBody(map.bodies, player.targetBody);
  const ownHomeBody = findBody(map.bodies, player.homeBody);

  let objectiveDistance: number | null = null;
  if (targetBody) {
    for (const own of ownShips) {
      const dist = hexDistance(own.position, targetBody.center);
      if (objectiveDistance === null || dist < objectiveDistance) {
        objectiveDistance = dist;
      }
    }
  }

  let enemyObjectiveDistance: number | null = null;
  // Some scenarios have no home body (race scenarios etc.). In those cases the
  // agent's home is not a meaningful defensive point, so skip the calculation.
  const enemyHomeTarget = opponent
    ? findBody(map.bodies, opponent.targetBody)
    : null;
  const defendTarget = enemyHomeTarget ?? ownHomeBody;
  if (defendTarget) {
    for (const enemy of enemyShips) {
      const dist = hexDistance(enemy.position, defendTarget.center);
      if (enemyObjectiveDistance === null || dist < enemyObjectiveDistance) {
        enemyObjectiveDistance = dist;
      }
    }
  }

  // Threat axis: compass direction from fleet centroid to nearest enemy.
  let threatAxis: string | null = null;
  if (nearestEnemyPos && ownShips.length > 0) {
    const centroid = fleetCentroid(ownShips);
    threatAxis = axisLabel(
      nearestEnemyPos.q - centroid.q,
      nearestEnemyPos.r - centroid.r,
    );
  }

  const turnsToObjective = estimateTurnsToObjective(ownShips, targetBody);

  return {
    nearestEnemyDistance,
    fuelAdvantage,
    objectiveDistance,
    enemyObjectiveDistance,
    threatAxis,
    turnsToObjective,
  };
};
