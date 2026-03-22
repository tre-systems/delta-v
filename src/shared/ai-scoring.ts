/**
 * Decomposed AI scoring strategies for course
 * evaluation. Each function scores one concern
 * independently — the combiner adds them.
 */

import type { AIDifficultyConfig } from './ai-config';
import { must } from './assert';
import { getCombatStrength } from './combat';
import { hexAdd, hexDistance, hexVecLength } from './hex';
import { applyPendingGravityEffects } from './movement';
import type { CourseResult, Ship, SolarSystemMap } from './types';
import { minBy } from './util';

// --- Individual scoring strategies ---

/** Maximize distance from center + velocity. */
export const scoreEscape = (
  ship: Ship,
  course: CourseResult,
  cfg: AIDifficultyConfig,
): number => {
  const mult = cfg.multiplier;
  let score = 0;
  const distFromCenter = hexDistance(course.destination, { q: 0, r: 0 });
  score += distFromCenter * cfg.escapeDistWeight * mult;
  const speed = hexVecLength(course.newVelocity);
  score += speed * cfg.escapeSpeedWeight * mult;
  // Never stay landed when trying to escape
  if (
    ship.lifecycle === 'landed' &&
    course.destination.q === ship.position.q &&
    course.destination.r === ship.position.r
  ) {
    score -= cfg.escapeLandedPenalty * mult;
  }
  return score;
};

/** Navigate toward a target body/hex. */
export const scoreNavigation = (
  ship: Ship,
  course: CourseResult,
  targetHex: { q: number; r: number },
  targetBody: string,
  cfg: AIDifficultyConfig,
): number => {
  const mult = cfg.multiplier;
  let score = 0;
  const currentDist = hexDistance(ship.position, targetHex);
  const newDist = hexDistance(course.destination, targetHex);
  // Reward getting closer to target
  score += (currentDist - newDist) * cfg.navDistWeight * mult;
  // Bonus for landing on target body (not home!)
  if (targetBody && course.landedAt === targetBody) {
    score += cfg.navTargetLandingBonus;
  } else if (course.landedAt && !targetBody) {
    // Fuel-seeking: landing at any base is great
    score += cfg.navBaseLandingBonus;
  } else if (course.landedAt) {
    score -= cfg.navWrongBodyPenalty * mult;
  }
  // Heavy penalty for staying landed at home
  if (
    ship.lifecycle === 'landed' &&
    course.destination.q === ship.position.q &&
    course.destination.r === ship.position.r
  ) {
    score -= cfg.navStayLandedPenalty * mult;
  }
  // Velocity alignment: prefer velocity pointing
  // toward target
  const velDist = hexDistance(
    hexAdd(course.destination, course.newVelocity),
    targetHex,
  );
  score -= velDist * cfg.navVelocityAlignWeight * mult;
  // Penalty for overshooting (velocity too high
  // near target)
  if (newDist < cfg.navOvershootRange) {
    const speed = hexVecLength(course.newVelocity);
    if (speed > newDist + 1) {
      score -= (speed - newDist) * cfg.navOvershootPenalty * mult;
    }
  }
  return score;
};

/** Penalize high speed near gravity wells in races. */
export const scoreRaceDanger = (
  course: CourseResult,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  cfg: AIDifficultyConfig,
): number => {
  if (course.landedAt) return 0;
  let score = 0;
  const speed = hexVecLength(course.newVelocity);
  for (const body of map.bodies) {
    const bodyDist = hexDistance(course.destination, body.center);
    const dangerZone = body.surfaceRadius + cfg.gravityDangerPadding;
    if (
      bodyDist < dangerZone &&
      speed > Math.max(1, bodyDist - body.surfaceRadius)
    ) {
      score -=
        (speed - bodyDist + body.surfaceRadius + 1) *
        cfg.gravityDangerSpeedPenalty;
    }
  }
  // Must be nearly stopped to land
  if (targetHex) {
    const newDist = hexDistance(course.destination, targetHex);
    if (newDist < 3 && speed > 1) {
      score -= speed * cfg.navBrakingPenalty;
    }
  }
  return score;
};

/** Score deferred gravity effects one turn ahead. */
export const scoreGravityLookAhead = (
  course: CourseResult,
  escapeWins: boolean,
  targetHex: { q: number; r: number } | null,
  enemyShips: Ship[],
  cfg: AIDifficultyConfig,
): number => {
  if (course.landedAt || course.enteredGravityEffects.length === 0) {
    return 0;
  }
  const mult = cfg.multiplier;
  const nextTurnDest = applyPendingGravityEffects(
    hexAdd(course.destination, course.newVelocity),
    course.enteredGravityEffects,
  );
  if (escapeWins) {
    return (
      (hexDistance(nextTurnDest, { q: 0, r: 0 }) -
        hexDistance(course.destination, {
          q: 0,
          r: 0,
        })) *
      cfg.gravityEscapeWeight *
      mult
    );
  }
  if (targetHex) {
    return (
      (hexDistance(course.destination, targetHex) -
        hexDistance(nextTurnDest, targetHex)) *
      cfg.gravityNavWeight *
      mult
    );
  }
  if (enemyShips.length > 0) {
    const closest = must(
      minBy(enemyShips, (enemy) => hexDistance(nextTurnDest, enemy.position)),
    );
    return (
      Math.max(
        0,
        cfg.gravityCombatProximity -
          hexDistance(nextTurnDest, closest.position),
      ) * mult
    );
  }
  return 0;
};

/** Combat positioning: interception, engagement,
 * or objective-balanced fighting. */
export const scoreCombatPositioning = (
  ship: Ship,
  course: CourseResult,
  enemyShips: Ship[],
  escapeWins: boolean,
  targetHex: { q: number; r: number } | null,
  enemyEscaping: boolean,
  shipIndex: number,
  difficulty: string,
  cfg: AIDifficultyConfig,
): number => {
  if (enemyShips.length === 0) return 0;
  const mult = cfg.multiplier;
  const noPrimaryObjective = !escapeWins && !targetHex;
  let score = 0;
  const myStrength = getCombatStrength([ship]);
  const intercepting = enemyEscaping && noPrimaryObjective;
  // Distribute ships across targets on hard
  // difficulty to avoid all chasing the same one
  const assignedTarget =
    intercepting && difficulty === 'hard' && enemyShips.length > 1
      ? enemyShips[shipIndex % enemyShips.length]
      : null;

  for (const enemy of enemyShips) {
    const dist = hexDistance(course.destination, enemy.position);
    const enemyStr = getCombatStrength([enemy]);

    if (intercepting) {
      const predicted = hexAdd(enemy.position, enemy.velocity);
      if (dist <= cfg.interceptCloseRange) {
        // Close range: aggressive combat positioning
        score += Math.max(0, 50 - dist) * cfg.interceptCloseWeight * mult;
        if (dist <= 3) {
          score += cfg.interceptCloseBonus * mult;
        }
        const nextPos = hexAdd(course.destination, course.newVelocity);
        const nextDist = hexDistance(nextPos, enemy.position);
        score += (dist - nextDist) * cfg.interceptImprovementWeight * mult;
        // Match velocity to maintain engagement
        const velMatchDist = hexDistance(
          {
            q: course.newVelocity.dq,
            r: course.newVelocity.dr,
          },
          {
            q: enemy.velocity.dq,
            r: enemy.velocity.dr,
          },
        );
        score -= velMatchDist * cfg.interceptVelocityPenalty * mult;
      } else {
        // Far range: intercept predicted position
        const interceptDist = hexDistance(course.destination, predicted);
        score +=
          Math.max(0, 50 - interceptDist) * cfg.interceptFarWeight * mult;
        if (interceptDist <= 3) {
          score += cfg.interceptFarBonus * mult;
        }
        const nextPos = hexAdd(course.destination, course.newVelocity);
        const nextIntDist = hexDistance(nextPos, predicted);
        score +=
          (interceptDist - nextIntDist) * cfg.interceptImprovementWeight * mult;
      }
      // Hard AI: focus on assigned target
      if (assignedTarget && enemy !== assignedTarget) {
        score -= Math.max(0, 50 - dist) * cfg.interceptAssignedPenalty * mult;
      }
    } else if (noPrimaryObjective) {
      // Pure combat mode
      score += Math.max(0, 50 - dist) * cfg.combatClosingWeight * mult;
      if (dist <= cfg.combatCloseRange) {
        score += cfg.combatCloseBonus * mult;
      }
      const nextPos = hexAdd(course.destination, course.newVelocity);
      const nextDist = hexDistance(nextPos, enemy.position);
      score += (dist - nextDist) * cfg.combatImprovementWeight * mult;
      // Velocity matching at close range
      if (dist < cfg.combatVelocityMatchRange) {
        const velMatchDist = hexDistance(
          {
            q: course.newVelocity.dq,
            r: course.newVelocity.dr,
          },
          {
            q: enemy.velocity.dq,
            r: enemy.velocity.dr,
          },
        );
        score -=
          velMatchDist *
          (dist < cfg.combatCloseRange ? 4 : cfg.combatVelocityPenalty) *
          mult;
      }
      // Speed management near enemies
      const speed = hexVecLength(course.newVelocity);
      if (
        dist < cfg.combatSpeedManageRange &&
        speed > cfg.combatSpeedThreshold
      ) {
        const enemySpeed = hexVecLength(enemy.velocity);
        if (speed > enemySpeed + 2) {
          score -= (speed - enemySpeed) * cfg.combatSpeedDiffPenalty * mult;
        }
      }
    } else if (myStrength > 0) {
      // Has objective but also can fight
      if (myStrength >= enemyStr) {
        score += Math.max(0, 10 - dist) * cfg.objectiveStrongWeight * mult;
      } else {
        score += Math.min(dist, 8) * cfg.objectiveWeakWeight * mult;
      }
    }
  }
  return score;
};

// --- Combiner ---

export interface ScoreCourseParams {
  ship: Ship;
  course: CourseResult;
  targetHex: { q: number; r: number } | null;
  targetBody: string;
  escapeWins: boolean;
  enemyShips: Ship[];
  cfg: AIDifficultyConfig;
  difficulty: string;
  map?: SolarSystemMap;
  isRace?: boolean;
  enemyEscaping?: boolean;
  shipIndex?: number;
}

/** Combine all scoring strategies into a single
 * course score. */
export const scoreCourse = (p: ScoreCourseParams): number => {
  const {
    ship,
    course,
    targetHex,
    targetBody,
    escapeWins,
    enemyShips,
    cfg,
    difficulty,
    map,
    isRace,
    enemyEscaping,
    shipIndex,
  } = p;
  const noPrimaryObjective = !escapeWins && !targetHex;
  let score = 0;

  // Primary strategy
  if (escapeWins) {
    score += scoreEscape(ship, course, cfg);
  } else if (targetHex) {
    score += scoreNavigation(ship, course, targetHex, targetBody, cfg);
  }

  // Race danger
  if (isRace && map) {
    score += scoreRaceDanger(course, map, targetHex, cfg);
  }

  // Combat-only stay-landed penalty
  if (
    noPrimaryObjective &&
    ship.lifecycle === 'landed' &&
    course.destination.q === ship.position.q &&
    course.destination.r === ship.position.r
  ) {
    score -= cfg.combatStayLandedPenalty * cfg.multiplier;
  }

  // Gravity look-ahead
  score += scoreGravityLookAhead(
    course,
    escapeWins,
    targetHex,
    enemyShips,
    cfg,
  );

  // Combat positioning
  score += scoreCombatPositioning(
    ship,
    course,
    enemyShips,
    escapeWins,
    targetHex,
    !!enemyEscaping,
    shipIndex ?? 0,
    difficulty,
    cfg,
  );

  return score;
};
