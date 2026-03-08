import { hexDistance } from './hex';
import type { Ship } from './types';
import { SHIP_STATS } from './constants';

// --- Damage tables ---

// Gun Combat Results Table
// Rows: modified die roll (≤0 through 6+)
// Columns: odds ratio index (0=1:4, 1=1:2, 2=1:1, 3=2:1, 4=3:1, 5=4:1)
// Values: 0 = no effect, 1-5 = disabled that many turns, 6 = eliminated
const GUN_COMBAT_TABLE: number[][] = [
  // ≤0   1:4  1:2  1:1  2:1  3:1  4:1
  [  0,   0,   0,   0,   0,   1  ], // roll ≤ 0
  [  0,   0,   0,   0,   1,   2  ], // roll 1
  [  0,   0,   0,   1,   2,   3  ], // roll 2
  [  0,   0,   1,   2,   3,   4  ], // roll 3
  [  0,   1,   2,   3,   4,   5  ], // roll 4
  [  1,   2,   3,   4,   5,   6  ], // roll 5
  [  2,   3,   4,   5,   6,   6  ], // roll 6+
];

// Other Damage Table (torpedoes, mines, asteroids, ramming)
// Index: die roll 1-6
// Values: 0 = no effect, 1-5 = disabled, 6 = eliminated
const OTHER_DAMAGE_TABLE: number[] = [
  0, // roll 1: no effect
  1, // roll 2: D1
  2, // roll 3: D2
  3, // roll 4: D3
  4, // roll 5: D4
  6, // roll 6: eliminated
];

// Standard odds ratios
const ODDS_RATIOS = ['1:4', '1:2', '1:1', '2:1', '3:1', '4:1'] as const;
export type OddsRatio = typeof ODDS_RATIOS[number];

// --- Combat computation ---

export interface CombatAttack {
  attackerIds: string[];
  targetId: string;
}

export interface CombatResolution {
  attackerIds: string[];
  targetId: string;
  odds: OddsRatio;
  attackStrength: number;
  defendStrength: number;
  rangeMod: number;
  velocityMod: number;
  dieRoll: number;
  modifiedRoll: number;
  damageResult: DamageResult;
  counterattack: CombatResolution | null;
}

export interface DamageResult {
  type: 'none' | 'disabled' | 'eliminated';
  disabledTurns: number; // 0 for none/eliminated
}

/**
 * Compute combat odds ratio from attacker and defender strengths.
 */
export function computeOdds(attackStrength: number, defendStrength: number): OddsRatio {
  if (defendStrength <= 0) return '4:1';
  if (attackStrength <= 0) return '1:4';

  const ratio = attackStrength / defendStrength;

  if (ratio >= 4) return '4:1';
  if (ratio >= 3) return '3:1';
  if (ratio >= 2) return '2:1';
  if (ratio >= 1) return '1:1';
  if (ratio >= 0.5) return '1:2';
  return '1:4';
}

/**
 * Compute range modifier: subtract 1 per hex of distance.
 * Range is measured from attacker position to target position.
 */
export function computeRangeMod(attacker: Ship, target: Ship): number {
  return hexDistance(attacker.position, target.position);
}

/**
 * Compute velocity modifier: subtract 1 per hex of velocity difference > 2.
 * Velocity difference is the hex distance between their velocity vectors.
 */
export function computeVelocityMod(attacker: Ship, target: Ship): number {
  const dq = Math.abs(attacker.velocity.dq - target.velocity.dq);
  const dr = Math.abs(attacker.velocity.dr - target.velocity.dr);
  const ds = Math.abs((-attacker.velocity.dq - attacker.velocity.dr) - (-target.velocity.dq - target.velocity.dr));
  const velDiff = Math.max(dq, dr, ds);
  return Math.max(0, velDiff - 2);
}

/**
 * Get total combat strength for a group of attackers.
 */
export function getCombatStrength(ships: Ship[]): number {
  let total = 0;
  for (const ship of ships) {
    if (ship.destroyed || ship.damage.disabledTurns > 0) continue;
    const stats = SHIP_STATS[ship.type];
    if (stats) total += stats.combat;
  }
  return total;
}

/**
 * Check if a ship can initiate an attack (not defensive-only, not disabled).
 */
export function canAttack(ship: Ship): boolean {
  if (ship.destroyed || ship.damage.disabledTurns > 0) return false;
  const stats = SHIP_STATS[ship.type];
  return stats ? !stats.defensiveOnly : false;
}

/**
 * Check if a ship can counterattack (not destroyed, not disabled, has combat strength).
 */
export function canCounterattack(ship: Ship): boolean {
  if (ship.destroyed || ship.damage.disabledTurns > 0) return false;
  const stats = SHIP_STATS[ship.type];
  return stats ? stats.combat > 0 : false;
}

/**
 * Look up result on the Gun Combat table.
 */
export function lookupGunCombat(odds: OddsRatio, modifiedRoll: number): DamageResult {
  const col = ODDS_RATIOS.indexOf(odds);
  const row = Math.max(0, Math.min(6, modifiedRoll));
  const value = GUN_COMBAT_TABLE[row][col];

  if (value === 0) return { type: 'none', disabledTurns: 0 };
  if (value === 6) return { type: 'eliminated', disabledTurns: 0 };
  return { type: 'disabled', disabledTurns: value };
}

/**
 * Look up result on the Other Damage table (asteroids, mines, torpedoes, ramming).
 */
export function lookupOtherDamage(dieRoll: number): DamageResult {
  const idx = Math.max(0, Math.min(5, dieRoll - 1));
  const value = OTHER_DAMAGE_TABLE[idx];

  if (value === 0) return { type: 'none', disabledTurns: 0 };
  if (value === 6) return { type: 'eliminated', disabledTurns: 0 };
  return { type: 'disabled', disabledTurns: value };
}

/**
 * Apply damage to a ship. Returns true if the ship was eliminated.
 */
export function applyDamage(ship: Ship, result: DamageResult): boolean {
  if (result.type === 'none') return false;

  if (result.type === 'eliminated') {
    ship.destroyed = true;
    ship.velocity = { dq: 0, dr: 0 };
    return true;
  }

  // Cumulative disabled turns
  ship.damage.disabledTurns += result.disabledTurns;
  if (ship.damage.disabledTurns >= 6) {
    ship.destroyed = true;
    ship.velocity = { dq: 0, dr: 0 };
    return true;
  }

  return false;
}

/**
 * Roll a d6 (1-6). Uses crypto.getRandomValues if available, else Math.random.
 */
export function rollD6(rng?: () => number): number {
  if (rng) return Math.floor(rng() * 6) + 1;
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * Resolve a single combat attack.
 */
export function resolveCombat(
  attackers: Ship[],
  target: Ship,
  allShips: Ship[],
  rng?: () => number,
): CombatResolution {
  const attackStrength = getCombatStrength(attackers);
  const defendStrength = getCombatStrength([target]);
  const odds = computeOdds(attackStrength, defendStrength);

  // Use first attacker for range/velocity calculation
  const primaryAttacker = attackers[0];
  const rangeMod = computeRangeMod(primaryAttacker, target);
  const velocityMod = computeVelocityMod(primaryAttacker, target);

  const dieRoll = rollD6(rng);
  const modifiedRoll = dieRoll - rangeMod - velocityMod;
  const damageResult = lookupGunCombat(odds, modifiedRoll);

  // Apply damage to target
  applyDamage(target, damageResult);

  // Counterattack: defender fires back if able
  let counterattack: CombatResolution | null = null;
  if (canCounterattack(target) && !target.destroyed) {
    const counterStrength = getCombatStrength([target]);
    const counterOdds = computeOdds(counterStrength, attackStrength);
    const counterRange = rangeMod; // Same range
    const counterVelMod = velocityMod; // Same velocity difference

    const counterDie = rollD6(rng);
    const counterModified = counterDie - counterRange - counterVelMod;
    const counterResult = lookupGunCombat(counterOdds, counterModified);

    // Apply counter-damage to primary attacker
    applyDamage(primaryAttacker, counterResult);

    counterattack = {
      attackerIds: [target.id],
      targetId: primaryAttacker.id,
      odds: counterOdds,
      attackStrength: counterStrength,
      defendStrength: attackStrength,
      rangeMod: counterRange,
      velocityMod: counterVelMod,
      dieRoll: counterDie,
      modifiedRoll: counterModified,
      damageResult: counterResult,
      counterattack: null,
    };
  }

  return {
    attackerIds: attackers.map(s => s.id),
    targetId: target.id,
    odds,
    attackStrength,
    defendStrength,
    rangeMod,
    velocityMod,
    dieRoll,
    modifiedRoll,
    damageResult,
    counterattack,
  };
}
