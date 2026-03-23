// Client-side AI opponent using rule-based heuristics.
// Runs entirely in the browser — no server cost.
//
// Difficulty levels:
// - easy:   No overloads, sometimes picks suboptimal
//           burns, skips ordnance, less aggressive
// - normal: Uses overloads, good heuristic scoring,
//           launches ordnance, reasonable combat
// - hard:   Better scoring weights, aggressive ordnance
//           use, always attacks when possible

import { AI_CONFIG } from './ai-config';
import { scoreCourse } from './ai-scoring';
import {
  canAttack,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from './combat';
import { ORDNANCE_MASS, SHIP_STATS } from './constants';
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexDistance,
  hexKey,
  hexVecLength,
  parseHexKey,
} from './hex';
import { computeCourse } from './movement';
import type {
  AstrogationOrder,
  CombatAttack,
  GameState,
  OrdnanceLaunch,
  Ship,
  SolarSystemMap,
} from './types';
import { minBy, sumBy } from './util';
export type AIDifficulty = 'easy' | 'normal' | 'hard';
// --- Helpers ---
const findDirectionToward = (
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
// Find the nearest base hex the player controls.
const findNearestBase = (
  shipPos: {
    q: number;
    r: number;
  },
  playerBases: string[],
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
// Pick the next checkpoint body to visit, or homeBody
// if all visited. Uses nearest-neighbor heuristic from
// the player's ship position.
const pickNextCheckpoint = (
  player: {
    visitedBodies?: string[];
    homeBody: string;
  },
  checkpoints: string[],
  map: SolarSystemMap,
  shipPos?: {
    q: number;
    r: number;
  },
): string | null => {
  const visited = new Set(player.visitedBodies ?? []);
  const unvisited = checkpoints.filter((b) => !visited.has(b));
  if (unvisited.length === 0) return player.homeBody;
  if (!shipPos) return unvisited[0];
  // Find nearest unvisited body
  const bestBody = unvisited.reduce((best, name) => {
    const body = map.bodies.find((b) => b.name === name);
    if (!body) return best;
    const dist = hexDistance(shipPos, body.center);
    const bestBodyObj = map.bodies.find((b) => b.name === best);
    const bestDist = bestBodyObj
      ? hexDistance(shipPos, bestBodyObj.center)
      : Infinity;
    return dist < bestDist ? name : best;
  }, unvisited[0]);
  return bestBody;
};
// Generate astrogation orders for an AI player.
// Strategy: for each ship, evaluate all 7 options
// (6 burn directions + no burn) and pick the one that
// brings us closest to our goal.
export const aiAstrogation = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = Math.random,
): AstrogationOrder[] => {
  const cfg = AI_CONFIG[difficulty];
  const orders: AstrogationOrder[] = [];
  const { targetBody, escapeWins } = state.players[playerId];
  const player = state.players[playerId];
  const opponentId = 1 - playerId;
  const enemyEscaping = state.players[opponentId]?.escapeWins === true;
  // Default navigation target (non-checkpoint scenarios)
  const defaultTargetHex: {
    q: number;
    r: number;
  } | null = targetBody
    ? (map.bodies.find((body) => body.name === targetBody)?.center ?? null)
    : null;
  const checkpoints = state.scenarioRules.checkpointBodies;
  // Find enemy ships for combat positioning
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  let shipIdx = 0;
  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.lifecycle === 'destroyed') continue;
    // Orbital bases don't need astrogation
    if (ship.baseStatus === 'emplaced') continue;
    // Captured ships can't act
    if (ship.control === 'captured') {
      orders.push({
        shipId: ship.id,
        burn: null,
      });
      continue;
    }
    // Disabled ships just drift
    if (ship.damage.disabledTurns > 0) {
      orders.push({
        shipId: ship.id,
        burn: null,
      });
      continue;
    }
    // Per-ship checkpoint target or default target
    let shipTargetHex = defaultTargetHex;
    let shipTargetBody = targetBody;
    let seekingFuel = false;
    if (checkpoints && player.visitedBodies) {
      const nextBody =
        pickNextCheckpoint(player, checkpoints, map, ship.position) ?? '';
      shipTargetBody = nextBody;
      shipTargetHex = nextBody
        ? (map.bodies.find((body) => body.name === nextBody)?.center ?? null)
        : null;
      // Refuel strategy: divert to nearest base
      // when fuel won't reach the target
      if (shipTargetHex && ship.lifecycle !== 'landed') {
        const distToTarget = hexDistance(ship.position, shipTargetHex);
        const speed = hexVecLength(ship.velocity);
        // Need fuel to navigate: roughly distance/3
        // for accel + distance/3 for decel + margin
        const fuelForTrip = Math.ceil((distToTarget * 2) / 3) + speed + 1;
        if (ship.fuel < fuelForTrip) {
          const basePos = findNearestBase(ship.position, player.bases, map);
          if (basePos) {
            const baseDist = hexDistance(ship.position, basePos);
            // Only divert if base is reasonably
            // close and reachable
            if (baseDist < distToTarget && baseDist <= ship.fuel + speed + 2) {
              shipTargetHex = basePos;
              shipTargetBody = '';
              seekingFuel = true;
            }
          }
        }
      }
    }
    let bestBurn: number | null = null;
    let bestOverload: number | null = null;
    let bestScore = -Infinity;
    const stats = SHIP_STATS[ship.type];
    const canBurnFuel = ship.fuel > 0;
    // Easy AI never overloads; Normal/Hard can overload
    // warships with enough fuel. No overloads in
    // non-combat races — too risky near gravity wells.
    const canOverload =
      difficulty !== 'easy' &&
      stats?.canOverload &&
      ship.fuel >= 2 &&
      !ship.overloadUsed &&
      !state.scenarioRules.combatDisabled;
    // Build list of (burn, overload) pairs to evaluate
    type BurnOption = {
      burn: number | null;
      overload: number | null;
      weakGravityChoices?: Record<string, boolean>;
    };
    const directions = [0, 1, 2, 3, 4, 5] as const;
    const options: BurnOption[] = [
      { burn: null, overload: null },
      ...(canBurnFuel
        ? directions.flatMap((d) => [
            { burn: d, overload: null },
            ...(canOverload
              ? directions.map((o) => ({
                  burn: d,
                  overload: o as number | null,
                }))
              : []),
          ])
        : []),
    ];
    let bestWeakGrav: Record<string, boolean> | undefined;
    for (const opt of options) {
      const courseOpts = {
        ...(opt.overload !== null ? { overload: opt.overload } : {}),
        destroyedBases: state.destroyedBases,
      };
      const course = computeCourse(ship, opt.burn, map, courseOpts);
      // Skip crashed courses entirely
      if (course.crashed) continue;
      // Look ahead: skip courses that will inevitably
      // crash.
      let gravityRiskPenalty = 0;
      if (!course.landedAt) {
        const simShip = {
          ...ship,
          position: course.destination,
          velocity: course.newVelocity,
          pendingGravityEffects: course.enteredGravityEffects,
        };
        const fuelAfter = ship.fuel - course.fuelSpent;
        const driftCourse = computeCourse(simShip, null, map, {
          destroyedBases: state.destroyedBases,
        });
        if (driftCourse.crashed) {
          if (!checkpoints) {
            // Combat scenarios: simple hard reject
            // if drifting crashes
            continue;
          }
          // Race mode: check if any burn next turn
          // avoids crash
          if (fuelAfter <= 0) continue;
          let canSurvive = false;
          for (let d2 = 0; d2 < 6; d2++) {
            const escapeResult = computeCourse(simShip, d2, map, {
              destroyedBases: state.destroyedBases,
            });
            if (escapeResult.crashed) continue;
            // Also check the turn after the escape
            // burn
            if (!escapeResult.landedAt && fuelAfter > 1) {
              const sim2 = {
                ...simShip,
                position: escapeResult.destination,
                velocity: escapeResult.newVelocity,
                pendingGravityEffects: escapeResult.enteredGravityEffects,
              };
              const drift2 = computeCourse(sim2, null, map, {
                destroyedBases: state.destroyedBases,
              });
              if (drift2.crashed) {
                let canSurvive2 = false;
                for (let d3 = 0; d3 < 6; d3++) {
                  const esc2 = computeCourse(sim2, d3, map, {
                    destroyedBases: state.destroyedBases,
                  });
                  if (!esc2.crashed) {
                    canSurvive2 = true;
                    break;
                  }
                }
                // Escape leads to another trap
                if (!canSurvive2) continue;
              }
            }
            canSurvive = true;
            break;
          }
          // No escape, hard reject
          if (!canSurvive) continue;
          // Survivable but needs corrective burns
          gravityRiskPenalty = cfg.gravityRiskPenalty;
        }
      }
      let score =
        scoreCourse({
          ship,
          course,
          targetHex: shipTargetHex,
          targetBody: shipTargetBody,
          escapeWins,
          enemyShips,
          cfg,
          difficulty,
          map,
          isRace: !!checkpoints,
          enemyEscaping,
          shipIndex: shipIdx,
        }) + gravityRiskPenalty;
      // Fuel-seeking: big bonus for landing at any
      // body (base refuel)
      if (seekingFuel && course.landedAt) {
        score += cfg.fuelSeekLandingBonus;
      }
      // Fuel efficiency: slight preference for
      // conserving fuel
      if (opt.burn === null) {
        score += cfg.fuelDriftBonus;
      } else if (opt.overload !== null) {
        // Small penalty for extra fuel cost
        score -= cfg.fuelOverloadPenalty;
      }
      // For normal/hard AI, also try ignoring weak
      // gravity choices
      let bestLocalWG: Record<string, boolean> | undefined;
      if (
        difficulty !== 'easy' &&
        course.enteredGravityEffects.some((g) => g.strength === 'weak')
      ) {
        // Try toggling each weak gravity hex
        const weakHexes = course.enteredGravityEffects.filter(
          (g) => g.strength === 'weak',
        );
        for (const wg of weakHexes) {
          const wgChoices: Record<string, boolean> = {
            [hexKey(wg.hex)]: true,
          };
          const altCourse = computeCourse(ship, opt.burn, map, {
            ...courseOpts,
            weakGravityChoices: wgChoices,
          });
          if (altCourse.crashed) continue;
          if (!altCourse.landedAt) {
            const simShip2 = {
              ...ship,
              position: altCourse.destination,
              velocity: altCourse.newVelocity,
              pendingGravityEffects: altCourse.enteredGravityEffects,
            };
            const nextAlt = computeCourse(simShip2, null, map, {
              destroyedBases: state.destroyedBases,
            });
            if (nextAlt.crashed) continue;
          }
          const altScore = scoreCourse({
            ship,
            course: altCourse,
            targetHex: shipTargetHex,
            targetBody: shipTargetBody,
            escapeWins,
            enemyShips,
            cfg,
            difficulty,
            map,
            isRace: !!checkpoints,
            enemyEscaping,
            shipIndex: shipIdx,
          });
          if (altScore > score) {
            score = altScore;
            bestLocalWG = wgChoices;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestBurn = opt.burn;
        bestOverload = opt.overload;
        bestWeakGrav = bestLocalWG;
      }
    }
    // Easy AI: 25% chance to pick a random suboptimal
    // direction instead
    if (difficulty === 'easy' && rng() < 0.25 && canBurnFuel) {
      const randomDir = Math.floor(rng() * 6);
      const course = computeCourse(ship, randomDir, map, {
        destroyedBases: state.destroyedBases,
      });
      if (!course.crashed) {
        bestBurn = randomDir;
        bestOverload = null;
      }
    }
    orders.push({
      shipId: ship.id,
      burn: bestBurn,
      ...(bestOverload !== null ? { overload: bestOverload } : {}),
      ...(bestWeakGrav ? { weakGravityChoices: bestWeakGrav } : {}),
    });
    shipIdx++;
  }
  return orders;
};
// Generate ordnance launches for an AI player.
// Strategy: launch torpedoes at nearby enemy ships.
export const aiOrdnance = (
  state: GameState,
  playerId: number,
  _map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = Math.random,
): OrdnanceLaunch[] => {
  const cfg = AI_CONFIG[difficulty];
  const launches: OrdnanceLaunch[] = [];
  const allowedTypes = new Set(
    state.scenarioRules.allowedOrdnanceTypes ?? ['mine', 'torpedo', 'nuke'],
  );
  // Easy AI rarely uses ordnance (30% chance to skip)
  if (cfg.ordnanceSkipChance > 0 && rng() < cfg.ordnanceSkipChance) {
    return launches;
  }
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  if (enemyShips.length === 0) return launches;
  // Difficulty-based range thresholds
  const torpedoRange = cfg.torpedoRange;
  const mineRange = cfg.mineRange;
  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle !== 'active') {
      continue;
    }
    if (ship.damage.disabledTurns > 0) continue;
    const stats = SHIP_STATS[ship.type];
    if (!stats) continue;
    const cargoFree = stats.cargo - ship.cargoUsed;
    // Find nearest enemy
    const nearestEnemy = minBy(enemyShips, (enemy) =>
      hexDistance(ship.position, enemy.position),
    );
    if (!nearestEnemy) continue;
    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
    // Hard AI: launch nuke at enemies within range
    // if cargo allows
    const canLaunchNuke =
      stats.canOverload || ship.nukesLaunchedSinceResupply < 1;
    if (
      allowedTypes.has('nuke') &&
      difficulty === 'hard' &&
      nearestDist <= torpedoRange &&
      cargoFree >= ORDNANCE_MASS.nuke &&
      canLaunchNuke
    ) {
      // Prefer nukes over torpedoes when enemy
      // is strong
      const enemyStr = getCombatStrength([nearestEnemy]);
      const myStr = getCombatStrength([ship]);
      if (enemyStr >= myStr && nearestDist <= cfg.nukeStrengthRange) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
        });
        continue;
      }
    }
    // Launch torpedo if enemy is within range and
    // ship can
    if (
      allowedTypes.has('torpedo') &&
      nearestDist <= torpedoRange &&
      stats.canOverload &&
      cargoFree >= ORDNANCE_MASS.torpedo
    ) {
      // Aim guidance toward enemy
      const bestDir = findDirectionToward(ship.position, nearestEnemy.position);
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps: nearestDist > 4 ? 2 : 1,
      });
      continue;
    }
    // Drop a mine if enemies are close-ish and we
    // have cargo
    if (
      allowedTypes.has('mine') &&
      nearestDist <= mineRange &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      // Rule: must change course (burn) to launch
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (o) => o.shipId === ship.id,
      );
      const hasBurn =
        pendingOrder?.burn != null || pendingOrder?.overload != null;
      if (hasBurn) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'mine',
        });
        continue;
      }
    }
    // Defensive mine-laying: drop mines behind when
    // being pursued (escape scenarios)
    const player = state.players[playerId];
    if (
      allowedTypes.has('mine') &&
      player?.escapeWins &&
      nearestDist <= 8 &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      // Only if enemy is approaching from behind
      const speed = hexVecLength(ship.velocity);
      if (speed >= 2 && difficulty !== 'easy') {
        // Also check for burn rule
        const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
          (o) => o.shipId === ship.id,
        );
        const hasBurn =
          pendingOrder?.burn != null || pendingOrder?.overload != null;
        if (hasBurn) {
          launches.push({
            shipId: ship.id,
            ordnanceType: 'mine',
          });
        }
      }
    }
  }
  return launches;
};
// Generate combat attacks for an AI player.
// Strategy: concentrate fire on the weakest enemy.
export const aiCombat = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] => {
  const cfg = AI_CONFIG[difficulty];
  const myShips = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed' && canAttack(s),
  );
  if (myShips.length === 0) return [];
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  const enemyNukes = state.ordnance.filter(
    (o) =>
      o.owner !== playerId && o.lifecycle !== 'destroyed' && o.type === 'nuke',
  );
  if (enemyShips.length === 0 && enemyNukes.length === 0) {
    return [];
  }

  // Score all potential targets
  interface ScoredTarget {
    targetId: string;
    targetType: 'ship' | 'ordnance';
    attackers: Ship[];
    score: number;
  }
  const scored: ScoredTarget[] = [];
  for (const enemy of enemyShips) {
    if (enemy.lifecycle === 'landed') continue;
    const attackersForTarget = myShips.filter((attacker) =>
      hasLineOfSight(attacker, enemy, map),
    );
    if (attackersForTarget.length === 0) continue;
    const avgDist =
      sumBy(attackersForTarget, (a) =>
        hexDistance(a.position, enemy.position),
      ) / attackersForTarget.length;
    const rangeMod = computeGroupRangeMod(attackersForTarget, enemy);
    const velMod = computeGroupVelocityMod(attackersForTarget, enemy);
    const totalMod = rangeMod + velMod;
    const score =
      -avgDist * cfg.targetDistPenalty -
      totalMod * cfg.targetModPenalty +
      enemy.damage.disabledTurns * cfg.targetDisabledBonus;
    scored.push({
      targetId: enemy.id,
      targetType: 'ship',
      attackers: attackersForTarget,
      score,
    });
  }

  for (const nuke of enemyNukes) {
    const attackersForTarget = myShips.filter((attacker) =>
      hasLineOfSightToTarget(attacker, nuke, map),
    );
    if (attackersForTarget.length === 0) continue;
    const avgDist =
      sumBy(attackersForTarget, (a) => hexDistance(a.position, nuke.position)) /
      attackersForTarget.length;
    const rangeMod = computeGroupRangeModToTarget(attackersForTarget, nuke);
    const velMod = computeGroupVelocityModToTarget(attackersForTarget, nuke);
    const ownShips = state.ships.filter(
      (ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed',
    );
    const closestOwn = minBy(ownShips, (ship) =>
      hexDistance(ship.position, nuke.position),
    );
    const threat = closestOwn
      ? Math.max(
          0,
          cfg.nukeThreatRange - hexDistance(closestOwn.position, nuke.position),
        )
      : 0;
    const score =
      cfg.nukeThreatBase +
      threat * cfg.nukeThreatWeight -
      avgDist * cfg.targetDistPenalty -
      (rangeMod + velMod) * cfg.targetModPenalty;
    scored.push({
      targetId: nuke.id,
      targetType: 'ordnance',
      attackers: attackersForTarget,
      score,
    });
  }

  if (scored.length === 0) return [];
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  // Assign attacks greedily: each attacker can only
  // participate in one attack
  const attacks: CombatAttack[] = [];
  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();
  const minRollThreshold = cfg.minRollThreshold;
  for (const target of scored) {
    const targetKey = `${target.targetType}:${target.targetId}`;
    if (committedTargets.has(targetKey)) continue;
    const available = target.attackers.filter(
      (a) => !committedAttackers.has(a.id),
    );
    if (available.length === 0) continue;
    // Check if odds are reasonable
    if (target.targetType === 'ship') {
      const enemy = enemyShips.find((s) => s.id === target.targetId);
      if (!enemy) continue;
      const attackStr = getCombatStrength(available);
      const defendStr = getCombatStrength([enemy]);
      const rangeMod = computeGroupRangeMod(available, enemy);
      const velMod = computeGroupVelocityMod(available, enemy);
      if (6 - rangeMod - velMod < minRollThreshold && attackStr <= defendStr) {
        continue;
      }
    }
    attacks.push({
      attackerIds: available.map((s) => s.id),
      targetId: target.targetId,
      targetType: target.targetType,
    });
    for (const a of available) {
      committedAttackers.add(a.id);
    }
    committedTargets.add(targetKey);
    // Easy AI: only one attack per combat phase
    if (cfg.singleAttackOnly) break;
  }
  return attacks;
};
