/**
 * Client-side AI opponent using rule-based heuristics.
 * Runs entirely in the browser — no server cost.
 *
 * Difficulty levels:
 * - easy:   No overloads, sometimes picks suboptimal burns, skips ordnance, less aggressive combat
 * - normal: Uses overloads, good heuristic scoring, launches ordnance, reasonable combat
 * - hard:   Better scoring weights, aggressive ordnance use, always attacks when possible
 */
import type { GameState, AstrogationOrder, OrdnanceLaunch, CombatAttack, SolarSystemMap, Ship, CourseResult } from './types';
import { HEX_DIRECTIONS, hexDistance, hexAdd, hexKey, hexVecLength } from './hex';
import { applyPendingGravityEffects, computeCourse } from './movement';
import { SHIP_STATS, ORDNANCE_MASS } from './constants';
import {
  getCombatStrength,
  canAttack,
  computeGroupRangeMod,
  computeGroupVelocityMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityModToTarget,
  computeRangeMod,
  computeVelocityMod,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from './combat';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Generate astrogation orders for an AI player.
 * Strategy: for each ship, evaluate all 7 options (6 burn directions + no burn)
 * and pick the one that brings us closest to our goal.
 */
export function aiAstrogation(
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): AstrogationOrder[] {
  const orders: AstrogationOrder[] = [];
  const player = state.players[playerId];
  const targetBody = player.targetBody;
  const escapeWins = player.escapeWins;

  // Find target hex (center of target body)
  let targetHex: { q: number; r: number } | null = null;
  if (targetBody) {
    for (const [key, hex] of map.hexes) {
      if (hex.body?.name === targetBody) {
        targetHex = parseHexKey(key);
        break;
      }
    }
  }

  // Find enemy ships for combat positioning
  const enemyShips = state.ships.filter(s => s.owner !== playerId && !s.destroyed);

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;

    if (ship.destroyed) continue;
    if (ship.emplaced) continue; // orbital bases don't need astrogation

    // Captured ships can't act
    if (ship.captured) {
      orders.push({ shipId: ship.id, burn: null });
      continue;
    }

    // Disabled ships just drift
    if (ship.damage.disabledTurns > 0) {
      orders.push({ shipId: ship.id, burn: null });
      continue;
    }

    let bestBurn: number | null = null;
    let bestOverload: number | null = null;
    let bestScore = -Infinity;

    const stats = SHIP_STATS[ship.type];
    const canBurnFuel = ship.fuel > 0;
    // Easy AI never overloads; Normal/Hard can overload warships with enough fuel
    const canOverload = difficulty !== 'easy' && stats?.canOverload && ship.fuel >= 2;

    // Build list of (burn, overload) pairs to evaluate
    type BurnOption = { burn: number | null; overload: number | null; weakGravityChoices?: Record<string, boolean> };
    const options: BurnOption[] = [{ burn: null, overload: null }];
    for (let d = 0; d < 6; d++) {
      if (canBurnFuel) {
        options.push({ burn: d, overload: null });
        if (canOverload) {
          for (let o = 0; o < 6; o++) {
            options.push({ burn: d, overload: o });
          }
        }
      }
    }

    let bestWeakGrav: Record<string, boolean> | undefined;

    for (const opt of options) {
      const courseOpts = {
        ...(opt.overload !== null ? { overload: opt.overload } : {}),
        destroyedBases: state.destroyedBases,
      };
      const course = computeCourse(ship, opt.burn, map, courseOpts);

      // Skip crashed courses entirely
      if (course.crashed) continue;

      let score = scoreCourse(
        ship, course, targetHex, targetBody, escapeWins, enemyShips, difficulty,
      );

      // Fuel efficiency: slight preference for conserving fuel
      if (opt.burn === null) {
        score += 0.5;
      } else if (opt.overload !== null) {
        score -= 1; // Small penalty for extra fuel cost of overloading
      }

      // For normal/hard AI, also try ignoring weak gravity choices
      let bestLocalWG: Record<string, boolean> | undefined;
      if (difficulty !== 'easy' && course.enteredGravityEffects.some(g => g.strength === 'weak')) {
        // Try toggling each weak gravity hex
        const weakHexes = course.enteredGravityEffects.filter(g => g.strength === 'weak');
        for (const wg of weakHexes) {
          const wgChoices: Record<string, boolean> = { [hexKey(wg.hex)]: true };
          const altCourse = computeCourse(ship, opt.burn, map,
            { ...courseOpts, weakGravityChoices: wgChoices });
          if (altCourse.crashed) continue;
          const altScore = scoreCourse(ship, altCourse, targetHex, targetBody, escapeWins, enemyShips, difficulty);
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

    // Easy AI: 25% chance to pick a random suboptimal direction instead
    if (difficulty === 'easy' && Math.random() < 0.25 && canBurnFuel) {
      const randomDir = Math.floor(Math.random() * 6);
      const course = computeCourse(ship, randomDir, map, { destroyedBases: state.destroyedBases });
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
  }

  return orders;
}

/**
 * Generate ordnance launches for an AI player.
 * Strategy: launch torpedoes at nearby enemy ships.
 */
export function aiOrdnance(
  state: GameState,
  playerId: number,
  _map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): OrdnanceLaunch[] {
  const launches: OrdnanceLaunch[] = [];

  // Easy AI rarely uses ordnance (30% chance to skip entirely)
  if (difficulty === 'easy' && Math.random() < 0.3) return launches;

  const enemyShips = state.ships.filter(s => s.owner !== playerId && !s.destroyed);
  if (enemyShips.length === 0) return launches;

  // Difficulty-based range thresholds
  const torpedoRange = difficulty === 'hard' ? 12 : 8;
  const mineRange = difficulty === 'hard' ? 6 : 4;

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.destroyed || ship.landed) continue;
    if (ship.damage.disabledTurns > 0) continue;

    const stats = SHIP_STATS[ship.type];
    if (!stats) continue;
    const cargoFree = stats.cargo - ship.cargoUsed;

    // Find nearest enemy
    let nearestEnemy: Ship | null = null;
    let nearestDist = Infinity;
    for (const enemy of enemyShips) {
      const dist = hexDistance(ship.position, enemy.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = enemy;
      }
    }
    if (!nearestEnemy) continue;

    // Hard AI: launch nuke at enemies within range if cargo allows
    const canLaunchNuke = stats.canOverload || (ship.nukesLaunchedSinceResupply ?? 0) < 1;
    if (difficulty === 'hard' && nearestDist <= torpedoRange &&
        cargoFree >= ORDNANCE_MASS.nuke && canLaunchNuke) {
      // Prefer nukes over torpedoes when enemy is strong
      const enemyStr = getCombatStrength([nearestEnemy]);
      const myStr = getCombatStrength([ship]);
      if (enemyStr >= myStr && nearestDist <= 6) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
        });
        continue;
      }
    }

    // Launch torpedo if enemy is within range and ship can
    if (nearestDist <= torpedoRange && stats.canOverload && cargoFree >= ORDNANCE_MASS.torpedo) {
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

    // Drop a mine if enemies are close-ish and we have cargo
    if (nearestDist <= mineRange && cargoFree >= ORDNANCE_MASS.mine) {
      launches.push({
        shipId: ship.id,
        ordnanceType: 'mine',
      });
      continue;
    }

    // Defensive mine-laying: drop mines behind when being pursued (escape scenarios)
    const player = state.players[playerId];
    if (player?.escapeWins && nearestDist <= 8 && cargoFree >= ORDNANCE_MASS.mine) {
      // Only if enemy is approaching from behind
      const speed = hexVecLength(ship.velocity);
      if (speed >= 2 && difficulty !== 'easy') {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'mine',
        });
      }
    }
  }

  return launches;
}

/**
 * Generate combat attacks for an AI player.
 * Strategy: concentrate fire on the weakest enemy.
 */
export function aiCombat(
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] {
  const myShips = state.ships.filter(s =>
    s.owner === playerId && !s.destroyed && canAttack(s),
  );
  if (myShips.length === 0) return [];

  const enemyShips = state.ships.filter(s =>
    s.owner !== playerId && !s.destroyed,
  );
  const enemyNukes = state.ordnance.filter(o =>
    o.owner !== playerId && !o.destroyed && o.type === 'nuke',
  );
  if (enemyShips.length === 0 && enemyNukes.length === 0) return [];

  // Score all potential targets
  interface ScoredTarget {
    targetId: string;
    targetType: 'ship' | 'ordnance';
    attackers: Ship[];
    score: number;
  }
  const scored: ScoredTarget[] = [];

  for (const enemy of enemyShips) {
    if (enemy.landed) continue;
    const attackersForTarget = myShips.filter(attacker => hasLineOfSight(attacker, enemy, map));
    if (attackersForTarget.length === 0) continue;

    let totalDist = 0;
    for (const attacker of attackersForTarget) {
      totalDist += hexDistance(attacker.position, enemy.position);
    }
    const avgDist = totalDist / attackersForTarget.length;
    const rangeMod = computeGroupRangeMod(attackersForTarget, enemy);
    const velMod = computeGroupVelocityMod(attackersForTarget, enemy);
    const totalMod = rangeMod + velMod;
    const score = -avgDist * 2 - totalMod * 3 + (enemy.damage.disabledTurns * 5);

    scored.push({ targetId: enemy.id, targetType: 'ship', attackers: attackersForTarget, score });
  }

  for (const nuke of enemyNukes) {
    const attackersForTarget = myShips.filter(attacker => hasLineOfSightToTarget(attacker, nuke, map));
    if (attackersForTarget.length === 0) continue;

    let totalDist = 0;
    for (const attacker of attackersForTarget) {
      totalDist += hexDistance(attacker.position, nuke.position);
    }
    const avgDist = totalDist / attackersForTarget.length;
    const rangeMod = computeGroupRangeModToTarget(attackersForTarget, nuke);
    const velMod = computeGroupVelocityModToTarget(attackersForTarget, nuke);
    const threat = Math.max(0, 6 - Math.min(...state.ships
      .filter(ship => ship.owner === playerId && !ship.destroyed)
      .map(ship => hexDistance(ship.position, nuke.position))));
    const score = 18 + threat * 8 - avgDist * 2 - (rangeMod + velMod) * 3;

    scored.push({ targetId: nuke.id, targetType: 'ordnance', attackers: attackersForTarget, score });
  }

  if (scored.length === 0) return [];

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Assign attacks greedily: each attacker can only participate in one attack
  const attacks: CombatAttack[] = [];
  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();
  const minRollThreshold = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 0 : 1;

  for (const target of scored) {
    const targetKey = `${target.targetType}:${target.targetId}`;
    if (committedTargets.has(targetKey)) continue;

    const available = target.attackers.filter(a => !committedAttackers.has(a.id));
    if (available.length === 0) continue;

    // Check if odds are reasonable
    if (target.targetType === 'ship') {
      const enemy = enemyShips.find(s => s.id === target.targetId);
      if (!enemy) continue;
      const attackStr = getCombatStrength(available);
      const defendStr = getCombatStrength([enemy]);
      const rangeMod = computeGroupRangeMod(available, enemy);
      const velMod = computeGroupVelocityMod(available, enemy);
      if (6 - rangeMod - velMod < minRollThreshold && attackStr <= defendStr) continue;
    }

    attacks.push({
      attackerIds: available.map(s => s.id),
      targetId: target.targetId,
      targetType: target.targetType,
    });
    for (const a of available) committedAttackers.add(a.id);
    committedTargets.add(targetKey);

    // Easy AI: only one attack per combat phase
    if (difficulty === 'easy') break;
  }

  return attacks;
}

// --- Helpers ---

/**
 * Score a course result for AI decision-making.
 */
function scoreCourse(
  ship: Ship,
  course: CourseResult,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  difficulty: AIDifficulty,
): number {
  let score = 0;

  // Difficulty multiplier for scoring precision
  const mult = difficulty === 'hard' ? 1.5 : difficulty === 'easy' ? 0.7 : 1.0;

  if (escapeWins) {
    // Escape strategy: maximize distance from center + velocity
    const distFromCenter = hexDistance(course.destination, { q: 0, r: 0 });
    score += distFromCenter * 10 * mult;
    const speed = hexVecLength(course.newVelocity);
    score += speed * 5 * mult;
    // Never stay landed when trying to escape
    if (ship.landed && course.destination.q === ship.position.q && course.destination.r === ship.position.r) {
      score -= 100 * mult;
    }
  } else if (targetHex) {
    // Navigate to target strategy
    const currentDist = hexDistance(ship.position, targetHex);
    const newDist = hexDistance(course.destination, targetHex);

    // Reward getting closer to target
    score += (currentDist - newDist) * 20 * mult;

    // Bonus for landing on target body (not home!)
    if (course.landedAt === targetBody) {
      score += 1000;
    } else if (course.landedAt) {
      // Landing at wrong body — bad, we need to keep moving
      score -= 30 * mult;
    }

    // Heavy penalty for staying landed at home — AI must launch
    if (ship.landed && course.destination.q === ship.position.q && course.destination.r === ship.position.r) {
      score -= 50 * mult;
    }

    // Velocity alignment: prefer velocity pointing toward target
    const velDist = hexDistance(
      hexAdd(course.destination, course.newVelocity),
      targetHex,
    );
    score -= velDist * 2 * mult;

    // Penalty for overshooting (velocity too high near target)
    if (newDist < 5) {
      const speed = hexVecLength(course.newVelocity);
      if (speed > newDist + 1) {
        score -= (speed - newDist) * 10 * mult;
      }
    }
  }

  // Penalty for staying landed in combat-only scenarios
  const noPrimaryObjective = !escapeWins && !targetHex;
  if (noPrimaryObjective && ship.landed &&
      course.destination.q === ship.position.q && course.destination.r === ship.position.r) {
    score -= 80 * mult;
  }

  // Deferred gravity matters most for the following turn, so look one move ahead.
  if (!course.landedAt && course.enteredGravityEffects.length > 0) {
    const nextTurnDest = applyPendingGravityEffects(
      hexAdd(course.destination, course.newVelocity),
      course.enteredGravityEffects,
    );

    if (escapeWins) {
      score += (hexDistance(nextTurnDest, { q: 0, r: 0 }) - hexDistance(course.destination, { q: 0, r: 0 })) * 4 * mult;
    } else if (targetHex) {
      score += (hexDistance(course.destination, targetHex) - hexDistance(nextTurnDest, targetHex)) * 6 * mult;
    } else if (enemyShips.length > 0) {
      const nearestEnemyAfterDrift = Math.min(
        ...enemyShips.map(enemy => hexDistance(nextTurnDest, enemy.position)),
      );
      score += Math.max(0, 5 - nearestEnemyAfterDrift) * mult;
    }
  }

  // Combat positioning
  const myStrength = getCombatStrength([ship]);
  if (enemyShips.length > 0) {
    for (const enemy of enemyShips) {
      const dist = hexDistance(course.destination, enemy.position);
      const enemyStr = getCombatStrength([enemy]);

      if (noPrimaryObjective) {
        // Pure combat mode: aggressively seek combat range
        // Close in — bonus that scales with distance to ensure incentive even at long range
        score += Math.max(0, 50 - dist) * 1 * mult;
        
        // Extra strong bonus for being at range 1-3
        if (dist <= 3) score += 20 * mult;
        
        // Velocity matching: prefer courses that match the enemy's velocity to reduce combat penalties
        const velMatchDist = hexDistance(
          { q: course.newVelocity.dq, r: course.newVelocity.dr },
          { q: enemy.velocity.dq, r: enemy.velocity.dr }
        );
        score -= velMatchDist * 3 * mult;
        
        // Speed management: prefer moderate velocity near enemies, unless matching their high speed
        const speed = hexVecLength(course.newVelocity);
        if (dist < 5 && speed > 5 && velMatchDist > 2) {
          score -= (speed - 5) * 4 * mult; // penalize overshooting if not matching velocity
        }
      } else if (myStrength > 0) {
        // Has objective but also can fight
        if (myStrength >= enemyStr) {
          // If we are stronger or equal, we should push toward them if they are nearby
          score += Math.max(0, 10 - dist) * 1.5 * mult;
        } else {
          // If we are weaker, maintain some distance but don't just run away if it stalls the game
          score += Math.min(dist, 8) * 0.5 * mult;
        }
      }
    }
  }

  return score;
}

function parseHexKey(key: string): { q: number; r: number } {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

function findDirectionToward(from: { q: number; r: number }, to: { q: number; r: number }): number {
  let bestDir = 0;
  let bestDist = Infinity;
  for (let d = 0; d < 6; d++) {
    const neighbor = hexAdd(from, HEX_DIRECTIONS[d]);
    const dist = hexDistance(neighbor, to);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = d;
    }
  }
  return bestDir;
}
