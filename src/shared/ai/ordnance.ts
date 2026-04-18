import { canAttack, getCombatStrength } from '../combat';
import { SHIP_STATS } from '../constants';
import { validateOrdnanceLaunch } from '../engine/util';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  type HexVec,
  hexAdd,
  hexDistance,
  hexEqual,
  hexLineDraw,
  hexSubtract,
  hexVecLength,
} from '../hex';
import {
  applyPendingGravityEffects,
  collectEnteredGravityEffects,
} from '../movement';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  GameState,
  GravityEffect,
  OrdnanceLaunch,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { maxBy, minBy } from '../util';
import { resolveAIConfig } from './config';
import type { AIDifficulty } from './types';

interface ScoredEnemyTarget {
  enemy: Ship;
  currentDistance: number;
  predictedDistance: number;
  predictedPosition: { q: number; r: number };
  score: number;
}

type InterceptResult = {
  hasIntercept: boolean;
  turnsToIntercept: number;
};

const projectBallisticStep = (
  position: HexCoord,
  velocity: HexVec,
  pendingGravityEffects: GravityEffect[],
  map: SolarSystemMap,
): {
  to: HexCoord;
  path: HexCoord[];
  newVelocity: HexVec;
  pendingGravityEffects: GravityEffect[];
} => {
  const rawDest = hexAdd(position, velocity);
  const destination = applyPendingGravityEffects(
    rawDest,
    pendingGravityEffects,
  );
  const path = hexLineDraw(position, destination);
  return {
    to: destination,
    path,
    newVelocity: hexSubtract(destination, position),
    pendingGravityEffects: collectEnteredGravityEffects(path, map),
  };
};

const findBallisticIntercept = (
  ordnanceStart: HexCoord,
  ordnanceVelocity: HexVec,
  enemy: Ship,
  map: SolarSystemMap,
  turns = 5,
): InterceptResult => {
  let ordPos: HexCoord = { ...ordnanceStart };
  let ordVel: HexVec = { ...ordnanceVelocity };
  let ordPending: GravityEffect[] = [];
  let enemyPos: HexCoord = { ...enemy.position };
  let enemyVel: HexVec = { ...enemy.velocity };
  let enemyPending: GravityEffect[] = (enemy.pendingGravityEffects ?? []).map(
    (e) => ({
      ...e,
      hex: { ...e.hex },
    }),
  );

  for (let turn = 1; turn <= turns; turn++) {
    const ordStep = projectBallisticStep(ordPos, ordVel, ordPending, map);
    const enemyStep = projectBallisticStep(
      enemyPos,
      enemyVel,
      enemyPending,
      map,
    );

    const ordPathKeys = new Set(ordStep.path.map((hex) => `${hex.q},${hex.r}`));
    const intersects = enemyStep.path.some((hex) =>
      ordPathKeys.has(`${hex.q},${hex.r}`),
    );

    if (intersects) {
      return { hasIntercept: true, turnsToIntercept: turn };
    }

    ordPos = ordStep.to;
    ordVel = ordStep.newVelocity;
    ordPending = ordStep.pendingGravityEffects;
    enemyPos = enemyStep.to;
    enemyVel = enemyStep.newVelocity;
    enemyPending = enemyStep.pendingGravityEffects;
  }

  return { hasIntercept: false, turnsToIntercept: Number.POSITIVE_INFINITY };
};

const pickTorpedoInterceptVector = (
  ship: Ship,
  enemy: Ship,
  map: SolarSystemMap,
): { direction: number; steps: 1 | 2 } | null => {
  let best: { direction: number; steps: 1 | 2; turns: number } | null = null;

  for (let direction = 0; direction < 6; direction++) {
    const dirVec = HEX_DIRECTIONS[direction];
    for (const steps of [1, 2] as const) {
      const velocity = {
        dq: ship.velocity.dq + dirVec.dq * steps,
        dr: ship.velocity.dr + dirVec.dr * steps,
      };
      const intercept = findBallisticIntercept(
        ship.position,
        velocity,
        enemy,
        map,
      );
      if (!intercept.hasIntercept) continue;
      if (
        best === null ||
        intercept.turnsToIntercept < best.turns ||
        (intercept.turnsToIntercept === best.turns && steps < best.steps)
      ) {
        best = { direction, steps, turns: intercept.turnsToIntercept };
      }
    }
  }

  return best ? { direction: best.direction, steps: best.steps } : null;
};

const scoreEnemyTarget = (
  ship: Ship,
  enemy: Ship,
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): ScoredEnemyTarget => {
  const player = state.players[playerId];
  const predictedPosition = hexAdd(enemy.position, enemy.velocity);
  const currentDistance = hexDistance(ship.position, enemy.position);
  const predictedDistance = hexDistance(ship.position, predictedPosition);
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : null;
  const targetThreat =
    targetHex == null
      ? 0
      : Math.max(
          0,
          8 -
            Math.min(
              hexDistance(enemy.position, targetHex),
              hexDistance(predictedPosition, targetHex),
            ),
        ) * 10;
  const escapeThreat = player.escapeWins
    ? Math.max(0, 8 - currentDistance) * 8
    : 0;
  const passengerThreat = (enemy.passengersAboard ?? 0) > 0 ? 30 : 0;
  const combatThreat = canAttack(enemy) ? 24 : 6;
  const strengthThreat = getCombatStrength([enemy]) * 8;

  return {
    enemy,
    currentDistance,
    predictedDistance,
    predictedPosition,
    score:
      strengthThreat +
      combatThreat +
      targetThreat +
      escapeThreat +
      passengerThreat -
      predictedDistance * 6 -
      currentDistance * 2 +
      enemy.damage.disabledTurns * 4,
  };
};

export const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  // rng is required — no default. Same rationale as `aiAstrogation`:
  // passing an explicit RNG keeps ordnance dice resolution deterministic
  // with the caller, and forgetting is a compile error rather than a
  // silent `Math.random` leak.
  rng: () => number,
): OrdnanceLaunch[] => {
  const cfg = resolveAIConfig(
    difficulty,
    state.scenarioRules?.aiConfigOverrides as
      | Parameters<typeof resolveAIConfig>[1]
      | undefined,
  );
  const launches: OrdnanceLaunch[] = [];
  const caps = deriveCapabilities(state.scenarioRules);

  if (cfg.ordnanceSkipChance > 0 && rng() < cfg.ordnanceSkipChance) {
    return launches;
  }

  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );

  if (enemyShips.length === 0) return launches;

  const torpedoRange = cfg.torpedoRange;
  const mineRange = cfg.mineRange;

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle !== 'active') {
      continue;
    }

    if (ship.damage.disabledTurns > 0) continue;
    if (caps.targetWinRequiresPassengers && (ship.passengersAboard ?? 0) > 0) {
      continue;
    }

    if (!SHIP_STATS[ship.type]) continue;

    const hasFriendlyLaunchStack = state.ships.some(
      (other) =>
        other.id !== ship.id &&
        other.owner === playerId &&
        other.lifecycle !== 'destroyed' &&
        hexEqual(other.position, ship.position),
    );
    const nearestEnemy = minBy(enemyShips, (enemy) =>
      hexDistance(ship.position, enemy.position),
    );
    const bestEnemyTarget = maxBy(
      enemyShips.map((enemy) =>
        scoreEnemyTarget(ship, enemy, state, playerId, map),
      ),
      (target) => target.score,
    );

    if (!nearestEnemy || !bestEnemyTarget) continue;

    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
    const bestEnemy = bestEnemyTarget.enemy;
    const bestEnemyCurrentDist = bestEnemyTarget.currentDistance;
    const bestEnemyPredictedDist = bestEnemyTarget.predictedDistance;
    const nukeIntercept = findBallisticIntercept(
      ship.position,
      ship.velocity,
      bestEnemy,
      map,
    );
    const torpedoVector = pickTorpedoInterceptVector(ship, bestEnemy, map);
    const canLaunchNuke =
      validateOrdnanceLaunch(state, ship, 'nuke', map) === null &&
      !hasFriendlyLaunchStack &&
      (ship.passengersAboard ?? 0) === 0 &&
      nukeIntercept.hasIntercept;
    const canLaunchTorpedo =
      validateOrdnanceLaunch(state, ship, 'torpedo', map) === null &&
      torpedoVector !== null;
    const canLaunchMine =
      validateOrdnanceLaunch(state, ship, 'mine', map) === null;

    // Early-turn nuke guard ported from scripts/llm-agent-coach.ts:
    // in the first two turns, a nuke is only considered when the enemy is
    // already point-blank (≤ 2 hexes). Before this guard the in-engine bot
    // and local single-player AI would open with nukes from 6 hexes away,
    // which makes duel matches swingy and unfun (see AGENT_IMPROVEMENTS_LOG
    // 2026-04-15 session notes). Hard difficulty is still aggressive once
    // past turn 2 or in close range.
    const earlyTurnNukeAllowed =
      state.turnNumber > 2 ||
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= 2;

    // Parity-deficit guard: if we already have ≤ 1 operational ship, a
    // failed nuke exchange loses the match. Hold fire unless the target is
    // already in point-blank so the nuke can't be shot down before arrival.
    const ownOperationalShips = state.ships.filter(
      (candidate) =>
        candidate.owner === playerId &&
        candidate.lifecycle === 'active' &&
        candidate.damage.disabledTurns === 0,
    ).length;
    const parityDeficitNukeAllowed =
      ownOperationalShips > 1 || bestEnemyCurrentDist <= 1;

    if (
      cfg.willCommitNukes &&
      earlyTurnNukeAllowed &&
      parityDeficitNukeAllowed &&
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      canLaunchNuke
    ) {
      const enemyStrength = getCombatStrength([bestEnemy]);
      const myStrength = getCombatStrength([ship]);
      const shouldUseNuke =
        bestEnemyTarget.score >= 70 ||
        (enemyStrength >= myStrength &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange) ||
        ((bestEnemy.passengersAboard ?? 0) > 0 &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange);

      if (shouldUseNuke && bestEnemyCurrentDist <= cfg.nukeStrengthRange) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
        continue;
      }
    }

    if (
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      canLaunchTorpedo
    ) {
      const bestDir = torpedoVector?.direction ?? 0;
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps: torpedoVector?.steps ?? 1,
      });
      continue;
    }

    if (nearestDist <= mineRange && canLaunchMine) {
      launches.push({
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      });
      continue;
    }

    const player = state.players[playerId];

    if (player?.escapeWins && nearestDist <= 8 && canLaunchMine) {
      const speed = hexVecLength(ship.velocity);

      if (speed >= 2 && difficulty !== 'easy') {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
      }
    }
  }

  return launches;
};
