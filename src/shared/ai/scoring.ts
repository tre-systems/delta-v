// Decomposed AI scoring strategies for course
// evaluation. Each function scores one concern
// independently — the combiner adds them.

import { must } from '../assert';
import { getCombatStrength } from '../combat';
import { hexAdd, hexDistance, hexVecLength } from '../hex';
import { applyPendingGravityEffects } from '../movement';
import type { CourseResult, Ship, SolarSystemMap } from '../types';
import { minBy } from '../util';
import type { AIDifficultyConfig } from './config';

const ESCAPE_MARGIN = 4;

const getEscapeDistance = (
  pos: { q: number; r: number },
  bounds: SolarSystemMap['bounds'],
  escapeEdge: 'any' | 'north',
): number => {
  if (escapeEdge === 'north') {
    return pos.r - (bounds.minR - ESCAPE_MARGIN);
  }

  return Math.min(
    pos.q - (bounds.minQ - ESCAPE_MARGIN),
    bounds.maxQ + ESCAPE_MARGIN - pos.q,
    pos.r - (bounds.minR - ESCAPE_MARGIN),
    bounds.maxR + ESCAPE_MARGIN - pos.r,
  );
};

// --- Individual scoring strategies ---

// Push escape ships toward the scenario's actual escape edge.
export const scoreEscape = (
  ship: Ship,
  course: CourseResult,
  cfg: AIDifficultyConfig,
  map?: SolarSystemMap,
  escapeEdge: 'any' | 'north' = 'any',
): number => {
  const mult = cfg.multiplier;
  let score = 0;

  if (map) {
    const currentEscapeDist = getEscapeDistance(
      ship.position,
      map.bounds,
      escapeEdge,
    );
    const newEscapeDist = getEscapeDistance(
      course.destination,
      map.bounds,
      escapeEdge,
    );
    const driftEscapeDist = getEscapeDistance(
      hexAdd(course.destination, course.newVelocity),
      map.bounds,
      escapeEdge,
    );

    score +=
      (currentEscapeDist - newEscapeDist) * cfg.escapeDistWeight * mult * 4;
    score +=
      (newEscapeDist - driftEscapeDist) * cfg.escapeSpeedWeight * mult * 3;

    if (escapeEdge === 'north' && course.newVelocity.dr > 0) {
      score -= course.newVelocity.dr * cfg.escapeSpeedWeight * mult * 4;
    }
  } else {
    const distFromCenter = hexDistance(course.destination, { q: 0, r: 0 });
    score += distFromCenter * cfg.escapeDistWeight * mult;
    const speed = hexVecLength(course.newVelocity);
    score += speed * cfg.escapeSpeedWeight * mult;
  }

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

// Navigate toward a target body/hex.
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
  const currentProjectedDist = hexDistance(
    hexAdd(ship.position, ship.velocity),
    targetHex,
  );
  const nextTurnDist = hexDistance(
    hexAdd(course.destination, course.newVelocity),
    targetHex,
  );
  // Reward getting closer to target
  score += (currentDist - newDist) * cfg.navDistWeight * mult;
  // Bonus for landing on target body (not home!)
  if (
    targetBody &&
    course.outcome === 'landing' &&
    course.landedAt === targetBody
  ) {
    score += cfg.navTargetLandingBonus;
  } else if (course.outcome === 'landing' && !targetBody) {
    // Fuel-seeking: landing at any base is great
    score += cfg.navBaseLandingBonus;
  } else if (course.outcome === 'landing') {
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

  if (
    ship.lifecycle !== 'landed' &&
    course.outcome !== 'landing' &&
    hexVecLength(ship.velocity) === 0 &&
    hexVecLength(course.newVelocity) === 0
  ) {
    score -= cfg.navStayLandedPenalty * 5 * mult;
  }

  // Velocity alignment: prefer velocity pointing
  // toward target
  const velDist = hexDistance(
    hexAdd(course.destination, course.newVelocity),
    targetHex,
  );
  score -= velDist * cfg.navVelocityAlignWeight * mult;
  score += (newDist - nextTurnDist) * cfg.navVelocityAlignWeight * mult;
  score +=
    (currentProjectedDist - nextTurnDist) * cfg.navFinalApproachWeight * mult;

  if (
    targetBody &&
    nextTurnDist <= cfg.navImminentLandingRange &&
    hexVecLength(course.newVelocity) <= 1
  ) {
    score += cfg.navImminentLandingBonus * mult;
  } else if (
    currentProjectedDist <= cfg.navImminentLandingRange &&
    nextTurnDist > cfg.navImminentLandingRange
  ) {
    score -= cfg.navImminentLandingBonus * mult;
  }

  if (newDist > currentDist && nextTurnDist > currentDist) {
    score -= (nextTurnDist - currentDist) * cfg.navDistWeight * mult;
  }

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

// Penalize high speed near gravity wells in races.
export const scoreRaceDanger = (
  course: CourseResult,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  cfg: AIDifficultyConfig,
): number => {
  if (course.outcome === 'landing') return 0;
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
    const nextTurnDist = hexDistance(
      hexAdd(course.destination, course.newVelocity),
      targetHex,
    );

    if (newDist < 3 && speed > 1) {
      score -= speed * cfg.navBrakingPenalty;
    }

    if (nextTurnDist < 5 && speed > 1) {
      score -=
        (5 - nextTurnDist) * Math.max(0, speed - 1) * cfg.navBrakingPenalty;
    }
  }
  return score;
};

// Score deferred gravity effects one turn ahead.
export const scoreGravityLookAhead = (
  course: CourseResult,
  escapeWins: boolean,
  targetHex: { q: number; r: number } | null,
  enemyShips: Ship[],
  cfg: AIDifficultyConfig,
): number => {
  if (
    course.outcome === 'landing' ||
    course.enteredGravityEffects.length === 0
  ) {
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

// Combat positioning: interception, engagement,
// or objective-balanced fighting.
export const scoreCombatPositioning = (
  ship: Ship,
  course: CourseResult,
  enemyShips: Ship[],
  escapeWins: boolean,
  targetHex: { q: number; r: number } | null,
  enemyEscaping: boolean,
  shipIndex: number,
  cfg: AIDifficultyConfig,
  enemyHasPassengerObjective = false,
  enemyHasTargetObjective = false,
): number => {
  if (enemyShips.length === 0) return 0;
  const mult = cfg.multiplier;
  const noPrimaryObjective = !escapeWins && !targetHex;
  let score = 0;
  const myStrength = getCombatStrength([ship]);
  const intercepting =
    (enemyEscaping || enemyHasPassengerObjective || enemyHasTargetObjective) &&
    noPrimaryObjective;
  // Distribute ships across targets to avoid
  // all chasing the same one (config-driven)
  const assignedTarget =
    intercepting && cfg.distributeInterceptTargets && enemyShips.length > 1
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
      const objectiveContested = targetHex
        ? (() => {
            const predictedEnemy = hexAdd(enemy.position, enemy.velocity);
            const currentTargetDist = hexDistance(
              hexAdd(course.destination, course.newVelocity),
              targetHex,
            );
            const enemyTargetDist = Math.min(
              hexDistance(enemy.position, targetHex),
              hexDistance(predictedEnemy, targetHex),
            );
            const interceptDistance = hexDistance(
              hexAdd(course.destination, course.newVelocity),
              predictedEnemy,
            );

            return (
              enemyTargetDist + 1 < currentTargetDist ||
              (enemyTargetDist <= currentTargetDist &&
                interceptDistance <= 2 &&
                dist <= 3)
            );
          })()
        : true;

      if (!objectiveContested) {
        continue;
      }

      if (targetHex) {
        const predictedEnemy = hexAdd(enemy.position, enemy.velocity);
        const currentTargetDist = hexDistance(
          hexAdd(course.destination, course.newVelocity),
          targetHex,
        );
        const enemyTargetDist = Math.min(
          hexDistance(enemy.position, targetHex),
          hexDistance(predictedEnemy, targetHex),
        );
        const raceLead = enemyTargetDist - currentTargetDist;

        score += raceLead * 12 * mult;

        if (raceLead >= 2) {
          score += 30 * mult;
        } else if (raceLead <= -2) {
          score -= 24 * mult;
        }

        if (raceLead >= 0 && dist <= 3) {
          score -= (4 - dist) * 24 * mult;
        }
      }

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
  escapeEdge?: 'any' | 'north';
  enemyShips: Ship[];
  cfg: AIDifficultyConfig;
  map?: SolarSystemMap;
  isRace?: boolean;
  enemyEscaping?: boolean;
  enemyHasPassengerObjective?: boolean;
  enemyHasTargetObjective?: boolean;
  shipIndex?: number;
}

// Combine all scoring strategies into a single
// course score.
export const scoreCourse = (p: ScoreCourseParams): number => {
  const {
    ship,
    course,
    targetHex,
    targetBody,
    escapeWins,
    escapeEdge,
    enemyShips,
    cfg,
    map,
    isRace,
    enemyEscaping,
    shipIndex,
  } = p;
  const noPrimaryObjective = !escapeWins && !targetHex;
  let score = 0;

  // Primary strategy
  if (escapeWins) {
    score += scoreEscape(ship, course, cfg, map, escapeEdge);
  } else if (targetHex) {
    score += scoreNavigation(ship, course, targetHex, targetBody, cfg);
  }

  // Race danger
  if (isRace && map) {
    score += scoreRaceDanger(course, map, targetHex, cfg);
  }

  // Map boundary avoidance — heavily penalize courses near the edge.
  // Ships that end their turn off the map are destroyed per the rules,
  // so the AI must steer well clear.
  if (map && course.outcome !== 'crash') {
    const { minQ, maxQ, minR, maxR } = map.bounds;
    const d = course.destination;
    const edgeDist = Math.min(d.q - minQ, maxQ - d.q, d.r - minR, maxR - d.r);
    if (edgeDist < cfg.boundaryAvoidanceThreshold) {
      // Exponential penalty: mild at threshold-1 hexes, catastrophic at 0
      const severity = cfg.boundaryAvoidanceThreshold - edgeDist;
      score -=
        severity *
        severity *
        cfg.boundaryAvoidanceSeverityMultiplier *
        cfg.multiplier;
    }
    // Extra penalty if velocity is pointing toward the nearest edge
    const v = course.newVelocity;
    const speed = hexVecLength(v);
    if (speed > 0 && edgeDist < cfg.boundaryVelocityThreshold) {
      const nextQ = d.q + v.dq;
      const nextR = d.r + v.dr;
      const nextEdgeDist = Math.min(
        nextQ - minQ,
        maxQ - nextQ,
        nextR - minR,
        maxR - nextR,
      );
      if (nextEdgeDist < edgeDist) {
        score -=
          (edgeDist - nextEdgeDist) *
          cfg.boundaryVelocityPenalty *
          cfg.multiplier;
      }

      if (
        !escapeWins &&
        isRace &&
        nextEdgeDist < cfg.boundaryAvoidanceThreshold
      ) {
        const projectedSeverity =
          cfg.boundaryAvoidanceThreshold - nextEdgeDist + 1;
        score -=
          projectedSeverity *
          projectedSeverity *
          cfg.boundaryAvoidanceSeverityMultiplier *
          cfg.multiplier *
          2;
      }
    }
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
    cfg,
    !!p.enemyHasPassengerObjective,
    !!p.enemyHasTargetObjective,
  );

  return score;
};
