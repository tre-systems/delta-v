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
import { computeCourse } from './movement';
import { SHIP_STATS, ORDNANCE_MASS } from './constants';
import { getCombatStrength, canAttack, computeRangeMod, computeVelocityMod } from './combat';

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

    // Disabled ships just drift
    if (ship.damage.disabledTurns > 0 || ship.destroyed) {
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
    type BurnOption = { burn: number | null; overload: number | null };
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

    for (const opt of options) {
      const course = computeCourse(ship, opt.burn, map,
        opt.overload !== null ? { overload: opt.overload } : undefined);

      // Skip crashed courses entirely
      if (course.crashed) continue;

      let score = scoreCourse(
        ship, course, targetHex, escapeWins, enemyShips, difficulty,
      );

      // Fuel efficiency: slight preference for conserving fuel
      if (opt.burn === null) {
        score += 0.5;
      } else if (opt.overload !== null) {
        score -= 1; // Small penalty for extra fuel cost of overloading
      }

      if (score > bestScore) {
        bestScore = score;
        bestBurn = opt.burn;
        bestOverload = opt.overload;
      }
    }

    // Easy AI: 25% chance to pick a random suboptimal direction instead
    if (difficulty === 'easy' && Math.random() < 0.25 && canBurnFuel) {
      const randomDir = Math.floor(Math.random() * 6);
      const course = computeCourse(ship, randomDir, map);
      if (!course.crashed) {
        bestBurn = randomDir;
        bestOverload = null;
      }
    }

    orders.push({
      shipId: ship.id,
      burn: bestBurn,
      ...(bestOverload !== null ? { overload: bestOverload } : {}),
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

    // Launch torpedo if enemy is within range and ship can
    if (nearestDist <= torpedoRange && stats.canOverload && cargoFree >= ORDNANCE_MASS.torpedo) {
      // Aim guidance toward enemy
      const bestDir = findDirectionToward(ship.position, nearestEnemy.position);
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
      });
      continue;
    }

    // Drop a mine if enemies are close-ish and we have cargo
    if (nearestDist <= mineRange && cargoFree >= ORDNANCE_MASS.mine) {
      launches.push({
        shipId: ship.id,
        ordnanceType: 'mine',
      });
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
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] {
  const myShips = state.ships.filter(s =>
    s.owner === playerId && !s.destroyed && canAttack(s),
  );
  if (myShips.length === 0) return [];

  const enemyShips = state.ships.filter(s =>
    s.owner !== playerId && !s.destroyed,
  );
  if (enemyShips.length === 0) return [];

  // Pick best target: closest + weakest = highest priority
  let bestTarget: Ship | null = null;
  let bestScore = -Infinity;

  for (const enemy of enemyShips) {
    // Average distance from our attackers
    let totalDist = 0;
    for (const attacker of myShips) {
      totalDist += hexDistance(attacker.position, enemy.position);
    }
    const avgDist = totalDist / myShips.length;

    // Range/velocity mods
    const rangeMod = computeRangeMod(myShips[0], enemy);
    const velMod = computeVelocityMod(myShips[0], enemy);
    const totalMod = rangeMod + velMod;

    // Score: prefer closer targets with fewer modifiers
    const score = -avgDist * 2 - totalMod * 3 + (enemy.damage.disabledTurns * 5);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = enemy;
    }
  }

  if (!bestTarget) return [];

  // Only attack if odds are reasonable (modified roll needs to be positive)
  const attackStr = getCombatStrength(myShips);
  const defendStr = getCombatStrength([bestTarget]);
  const rangeMod = computeRangeMod(myShips[0], bestTarget);
  const velMod = computeVelocityMod(myShips[0], bestTarget);

  // Easy: more conservative (skip if max roll < 3)
  // Normal: skip if max roll < 1
  // Hard: always attack if any chance of doing damage
  const minRollThreshold = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 0 : 1;
  if (6 - rangeMod - velMod < minRollThreshold && attackStr <= defendStr) {
    return []; // Skip combat, odds are too bad
  }

  return [{
    attackerIds: myShips.map(s => s.id),
    targetId: bestTarget.id,
  }];
}

// --- Helpers ---

/**
 * Score a course result for AI decision-making.
 */
function scoreCourse(
  ship: Ship,
  course: CourseResult,
  targetHex: { q: number; r: number } | null,
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
  } else if (targetHex) {
    // Navigate to target strategy
    const currentDist = hexDistance(ship.position, targetHex);
    const newDist = hexDistance(course.destination, targetHex);

    // Reward getting closer to target
    score += (currentDist - newDist) * 20 * mult;

    // Bonus for landing
    if (course.landedAt) {
      score += 1000;
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

  // Combat positioning
  const myStrength = getCombatStrength([ship]);
  const noPrimaryObjective = !escapeWins && !targetHex;
  if (enemyShips.length > 0) {
    for (const enemy of enemyShips) {
      const dist = hexDistance(course.destination, enemy.position);
      const enemyStr = getCombatStrength([enemy]);

      if (noPrimaryObjective) {
        // Pure combat mode: aggressively seek combat range
        if (myStrength >= enemyStr) {
          // Close in — strong bonus for being at range 1-3
          score += Math.max(0, 8 - dist) * 5 * mult;
        } else {
          // Weaker: stay at moderate range, but don't flee forever
          const idealDist = 4;
          score -= Math.abs(dist - idealDist) * 3 * mult;
        }
        // Speed management: prefer moderate velocity near enemies
        const speed = hexVecLength(course.newVelocity);
        if (dist < 5 && speed > 3) {
          score -= (speed - 3) * 4 * mult; // penalize overshooting
        }
      } else if (myStrength > 0) {
        // Has objective but also can fight
        if (myStrength >= enemyStr) {
          score += Math.max(0, 5 - dist) * 2 * mult;
        } else {
          score += Math.min(dist, 5) * 1 * mult;
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
