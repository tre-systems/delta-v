import {
  canAttack,
  computeGroupRangeModToTarget,
  computeGroupVelocityModToTarget,
  getCombatStrength,
  hasLineOfSightToTarget,
  lookupGunCombat,
} from '../combat';
import { ANTI_NUKE_ODDS, SHIP_STATS } from '../constants';
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
  Ordnance,
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

// Rulebook ordnance prices (Triplanetary 2018, equipment table): nuke 300 MCr,
// torpedo 20 MCr. When both are geometrically viable, the AI should not spend
// the nuke premium for marginal target value.
const NUKE_SCORE_FLOOR = 70;
const NUKE_SCORE_FLOOR_WHEN_TORPEDO_VIABLE = 115;
const NUKE_STRENGTH_RATIO_WHEN_TORPEDO_VIABLE = 2;

export type LaunchInterceptAssessment = {
  hasIntercept: boolean;
  turnsToIntercept: number;
  targetShipId: Ship['id'] | null;
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

const clonePendingEffects = (
  entity: Pick<Ship | Ordnance, 'pendingGravityEffects'>,
): GravityEffect[] =>
  (entity.pendingGravityEffects ?? []).map((e) => ({
    ...e,
    hex: { ...e.hex },
  }));

/** Same stepping as `findBallisticIntercept`, plus lane risk from friendlies,
 *  other enemy ships, and enemy ordnance in flight (rulebook: nuke detonates
 *  on contact with ships, mines, torpedoes, etc. — not a clean shot at the
 *  intended target if something else occupies the ballistic hexes first).
 */
const assessNukeBallisticToEnemy = (
  launcher: Ship,
  enemy: Ship,
  allyBlockers: Ship[],
  otherEnemyShips: Ship[],
  enemyOrdnanceInFlight: Ordnance[],
  map: SolarSystemMap,
  turns = 5,
): {
  hasIntercept: boolean;
  turnsToIntercept: number;
  blockedByFriendly: boolean;
  blockedByOtherEnemy: boolean;
  blockedByEnemyOrdnance: boolean;
} => {
  let ordPos: HexCoord = { ...launcher.position };
  let ordVel: HexVec = { ...launcher.velocity };
  let ordPending: GravityEffect[] = [];
  let enemyPos: HexCoord = { ...enemy.position };
  let enemyVel: HexVec = { ...enemy.velocity };
  let enemyPending: GravityEffect[] = clonePendingEffects(enemy);

  const allyStates = allyBlockers.map((ally) => ({
    pos: { ...ally.position } as HexCoord,
    vel: { ...ally.velocity } as HexVec,
    pending: clonePendingEffects(ally),
  }));
  const otherEnemyStates = otherEnemyShips.map((s) => ({
    pos: { ...s.position } as HexCoord,
    vel: { ...s.velocity } as HexVec,
    pending: clonePendingEffects(s),
  }));
  const enemyOrdStates = enemyOrdnanceInFlight.map((o) => ({
    pos: { ...o.position } as HexCoord,
    vel: { ...o.velocity } as HexVec,
    pending: clonePendingEffects(o),
  }));

  for (let turn = 1; turn <= turns; turn++) {
    const ordStep = projectBallisticStep(ordPos, ordVel, ordPending, map);
    const enemyStep = projectBallisticStep(
      enemyPos,
      enemyVel,
      enemyPending,
      map,
    );
    const allySteps = allyStates.map((a) =>
      projectBallisticStep(a.pos, a.vel, a.pending, map),
    );

    const ordPathKeys = new Set(ordStep.path.map((hex) => `${hex.q},${hex.r}`));

    for (const allyStep of allySteps) {
      const crossesFriendly = allyStep.path.some((hex) =>
        ordPathKeys.has(`${hex.q},${hex.r}`),
      );
      if (crossesFriendly) {
        return {
          hasIntercept: false,
          turnsToIntercept: Number.POSITIVE_INFINITY,
          blockedByFriendly: true,
          blockedByOtherEnemy: false,
          blockedByEnemyOrdnance: false,
        };
      }
    }

    const otherEnemySteps = otherEnemyStates.map((s) =>
      projectBallisticStep(s.pos, s.vel, s.pending, map),
    );
    for (const otherStep of otherEnemySteps) {
      const crossesOtherEnemy = otherStep.path.some((hex) =>
        ordPathKeys.has(`${hex.q},${hex.r}`),
      );
      if (crossesOtherEnemy) {
        return {
          hasIntercept: false,
          turnsToIntercept: Number.POSITIVE_INFINITY,
          blockedByFriendly: false,
          blockedByOtherEnemy: true,
          blockedByEnemyOrdnance: false,
        };
      }
    }

    const enemyOrdSteps = enemyOrdStates.map((s) =>
      projectBallisticStep(s.pos, s.vel, s.pending, map),
    );
    for (const ordStepBlock of enemyOrdSteps) {
      const crossesEnemyOrd = ordStepBlock.path.some((hex) =>
        ordPathKeys.has(`${hex.q},${hex.r}`),
      );
      if (crossesEnemyOrd) {
        return {
          hasIntercept: false,
          turnsToIntercept: Number.POSITIVE_INFINITY,
          blockedByFriendly: false,
          blockedByOtherEnemy: false,
          blockedByEnemyOrdnance: true,
        };
      }
    }

    const intersectsEnemy = enemyStep.path.some((hex) =>
      ordPathKeys.has(`${hex.q},${hex.r}`),
    );

    if (intersectsEnemy) {
      return {
        hasIntercept: true,
        turnsToIntercept: turn,
        blockedByFriendly: false,
        blockedByOtherEnemy: false,
        blockedByEnemyOrdnance: false,
      };
    }

    ordPos = ordStep.to;
    ordVel = ordStep.newVelocity;
    ordPending = ordStep.pendingGravityEffects;
    enemyPos = enemyStep.to;
    enemyVel = enemyStep.newVelocity;
    enemyPending = enemyStep.pendingGravityEffects;
    for (let i = 0; i < allyStates.length; i++) {
      const step = allySteps[i];
      const st = allyStates[i];
      st.pos = step.to;
      st.vel = step.newVelocity;
      st.pending = step.pendingGravityEffects;
    }
    for (let i = 0; i < otherEnemyStates.length; i++) {
      const step = otherEnemySteps[i];
      const st = otherEnemyStates[i];
      st.pos = step.to;
      st.vel = step.newVelocity;
      st.pending = step.pendingGravityEffects;
    }
    for (let i = 0; i < enemyOrdStates.length; i++) {
      const step = enemyOrdSteps[i];
      const st = enemyOrdStates[i];
      st.pos = step.to;
      st.vel = step.newVelocity;
      st.pending = step.pendingGravityEffects;
    }
  }

  return {
    hasIntercept: false,
    turnsToIntercept: Number.POSITIVE_INFINITY,
    blockedByFriendly: false,
    blockedByOtherEnemy: false,
    blockedByEnemyOrdnance: false,
  };
};

const groupedAntiNukeVolleyDestroyProbability = (
  attackers: Ship[],
  target: Pick<Ship | Ordnance, 'position' | 'velocity'>,
): number => {
  if (attackers.length === 0) return 0;
  const rangeMod = computeGroupRangeModToTarget(attackers, target);
  const velocityMod = computeGroupVelocityModToTarget(attackers, target);
  let destroyOutcomes = 0;
  for (let die = 1; die <= 6; die++) {
    const result = lookupGunCombat(
      ANTI_NUKE_ODDS,
      die - rangeMod - velocityMod,
    );
    if (result.type !== 'none') {
      destroyOutcomes += 1;
    }
  }
  return destroyOutcomes / 6;
};

const estimateNukeReachSurvival = (
  ship: Ship,
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  turnsToIntercept: number,
): number => {
  if (!Number.isFinite(turnsToIntercept) || turnsToIntercept <= 0) {
    return 0;
  }
  const synthetic: Pick<Ship | Ordnance, 'position' | 'velocity'> = {
    position: ship.position,
    velocity: ship.velocity,
  };
  const attackers = state.ships.filter(
    (s) =>
      s.owner !== playerId &&
      s.lifecycle === 'active' &&
      canAttack(s) &&
      hasLineOfSightToTarget(s, synthetic, map),
  );
  const pVolley = groupedAntiNukeVolleyDestroyProbability(attackers, synthetic);
  const pSurvive = 1 - pVolley;
  const volleyCount = Math.min(5, Math.max(1, Math.ceil(turnsToIntercept)));
  return pSurvive ** volleyCount;
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

export const evaluateOrdnanceLaunchIntercept = (
  state: GameState,
  playerId: PlayerId,
  launch: OrdnanceLaunch,
  map: SolarSystemMap,
): LaunchInterceptAssessment => {
  const ship = state.ships.find(
    (candidate) =>
      candidate.id === launch.shipId &&
      candidate.owner === playerId &&
      candidate.lifecycle === 'active',
  );
  if (!ship) {
    return {
      hasIntercept: false,
      turnsToIntercept: Number.POSITIVE_INFINITY,
      targetShipId: null,
    };
  }
  const ordnanceVelocity =
    launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null
      ? (() => {
          const dir = HEX_DIRECTIONS[launch.torpedoAccel];
          const steps = launch.torpedoAccelSteps === 2 ? 2 : 1;
          return {
            dq: ship.velocity.dq + dir.dq * steps,
            dr: ship.velocity.dr + dir.dr * steps,
          };
        })()
      : { ...ship.velocity };
  let bestTurns = Number.POSITIVE_INFINITY;
  let bestTarget: Ship['id'] | null = null;
  for (const enemy of state.ships) {
    if (enemy.owner === ship.owner || enemy.lifecycle === 'destroyed') continue;
    const intercept = findBallisticIntercept(
      ship.position,
      ordnanceVelocity,
      enemy,
      map,
    );
    if (!intercept.hasIntercept) continue;
    if (intercept.turnsToIntercept < bestTurns) {
      bestTurns = intercept.turnsToIntercept;
      bestTarget = enemy.id;
    }
  }
  return {
    hasIntercept: Number.isFinite(bestTurns),
    turnsToIntercept: bestTurns,
    targetShipId: bestTarget,
  };
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
    const allyNukeBlockers = state.ships.filter(
      (other) =>
        other.id !== ship.id &&
        other.owner === playerId &&
        other.lifecycle === 'active',
    );
    const otherEnemyLaneShips = enemyShips.filter((s) => s.id !== bestEnemy.id);
    const enemyOrdnanceLane = state.ordnance.filter(
      (o) => o.owner !== playerId && o.lifecycle === 'active',
    );
    const nukeIntercept = assessNukeBallisticToEnemy(
      ship,
      bestEnemy,
      allyNukeBlockers,
      otherEnemyLaneShips,
      enemyOrdnanceLane,
      map,
    );
    const torpedoVector = pickTorpedoInterceptVector(ship, bestEnemy, map);
    const canLaunchNuke =
      validateOrdnanceLaunch(state, ship, 'nuke', map) === null &&
      !hasFriendlyLaunchStack &&
      (ship.passengersAboard ?? 0) === 0 &&
      nukeIntercept.hasIntercept &&
      !nukeIntercept.blockedByFriendly &&
      !nukeIntercept.blockedByOtherEnemy &&
      !nukeIntercept.blockedByEnemyOrdnance;
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
      const torpedoAlsoViable =
        canLaunchTorpedo &&
        Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange;
      const nukeScoreFloor = torpedoAlsoViable
        ? NUKE_SCORE_FLOOR_WHEN_TORPEDO_VIABLE
        : NUKE_SCORE_FLOOR;
      const strengthOutgunsForNuke =
        enemyStrength >= myStrength &&
        (!torpedoAlsoViable ||
          enemyStrength >=
            myStrength * NUKE_STRENGTH_RATIO_WHEN_TORPEDO_VIABLE);
      const shouldUseNuke =
        bestEnemyTarget.score >= nukeScoreFloor ||
        (strengthOutgunsForNuke &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange) ||
        ((bestEnemy.passengersAboard ?? 0) > 0 &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange);

      const nukeReachSurvival =
        cfg.nukeMinReachProbability > 0
          ? estimateNukeReachSurvival(
              ship,
              state,
              playerId,
              map,
              nukeIntercept.turnsToIntercept,
            )
          : 1;
      const antiNukeGateOk =
        cfg.nukeMinReachProbability <= 0 ||
        nukeReachSurvival >= cfg.nukeMinReachProbability;

      if (
        shouldUseNuke &&
        bestEnemyCurrentDist <= cfg.nukeStrengthRange &&
        antiNukeGateOk
      ) {
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
