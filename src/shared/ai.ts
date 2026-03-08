/**
 * Client-side AI opponent using rule-based heuristics.
 * Runs entirely in the browser — no server cost.
 */
import type { GameState, AstrogationOrder, OrdnanceLaunch, CombatAttack, SolarSystemMap, Ship } from './types';
import { HEX_DIRECTIONS, hexDistance, hexAdd, hexKey, hexVecLength } from './hex';
import { computeCourse } from './movement';
import { SHIP_STATS, ORDNANCE_MASS } from './constants';
import { getCombatStrength, canAttack, computeRangeMod, computeVelocityMod } from './combat';

/**
 * Generate astrogation orders for an AI player.
 * Strategy: for each ship, evaluate all 7 options (6 burn directions + no burn)
 * and pick the one that brings us closest to our goal.
 */
export function aiAstrogation(
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
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
    let bestScore = -Infinity;

    // Evaluate all 7 options: null (no burn) + 6 directions
    const options: (number | null)[] = [null, 0, 1, 2, 3, 4, 5];
    // Only consider burns if ship has fuel
    const canBurn = ship.fuel > 0;

    for (const burn of options) {
      if (burn !== null && !canBurn) continue;

      const course = computeCourse(ship, burn, map);

      // Heavily penalize crashes
      if (course.crashed) {
        continue; // Skip crashed courses entirely
      }

      let score = 0;

      if (escapeWins) {
        // Escape strategy: maximize distance from center
        const distFromCenter = hexDistance(course.destination, { q: 0, r: 0 });
        score += distFromCenter * 10;

        // Prefer maintaining high velocity outward
        const speed = hexVecLength(course.newVelocity);
        score += speed * 5;
      } else if (targetHex) {
        // Navigate to target strategy
        const currentDist = hexDistance(ship.position, targetHex);
        const newDist = hexDistance(course.destination, targetHex);

        // Reward getting closer to target
        score += (currentDist - newDist) * 20;

        // Bonus for landing (destination is target body)
        if (course.landedAt) {
          score += 1000;
        }

        // Velocity alignment: prefer velocity pointing toward target
        const velDist = hexDistance(
          hexAdd(course.destination, course.newVelocity),
          targetHex,
        );
        score -= velDist * 2;

        // Penalty for overshooting (velocity too high near target)
        if (newDist < 5) {
          const speed = hexVecLength(course.newVelocity);
          if (speed > newDist + 1) {
            score -= (speed - newDist) * 10;
          }
        }
      }

      // Fuel efficiency: slight preference for not burning when it doesn't help
      if (burn === null) {
        score += 0.5; // Tiny bonus for conserving fuel
      }

      // Combat positioning: prefer keeping distance from enemies when weak
      const myStrength = getCombatStrength([ship]);
      if (myStrength > 0 && enemyShips.length > 0) {
        for (const enemy of enemyShips) {
          const dist = hexDistance(course.destination, enemy.position);
          const enemyStr = getCombatStrength([enemy]);
          if (myStrength >= enemyStr) {
            // We're stronger: get closer
            score += Math.max(0, 5 - dist) * 2;
          } else {
            // We're weaker: stay away
            score += Math.min(dist, 5) * 1;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestBurn = burn;
      }
    }

    orders.push({ shipId: ship.id, burn: bestBurn });
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
): OrdnanceLaunch[] {
  const launches: OrdnanceLaunch[] = [];
  const enemyShips = state.ships.filter(s => s.owner !== playerId && !s.destroyed);
  if (enemyShips.length === 0) return launches;

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

    // Launch torpedo if enemy is within reasonable range and we can
    if (nearestDist <= 8 && stats.canOverload && cargoFree >= ORDNANCE_MASS.torpedo) {
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
    if (nearestDist <= 4 && cargoFree >= ORDNANCE_MASS.mine) {
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

  // If the max possible modified roll (6 - mods) is still positive, attack
  if (6 - rangeMod - velMod < 1 && attackStr <= defendStr) {
    return []; // Skip combat, odds are too bad
  }

  return [{
    attackerIds: myShips.map(s => s.id),
    targetId: bestTarget.id,
  }];
}

// --- Helpers ---

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
