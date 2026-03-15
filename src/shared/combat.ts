import { hexDistance, hexEqual, hexKey, hexLineDraw } from './hex';
import type { Ship, Ordnance, SolarSystemMap, CombatResult } from './types';
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
  targetType?: 'ship' | 'ordnance';
  attackStrength?: number | null;
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
 * Range is measured from the attacker's closest approach this turn
 * to the target's final position.
 */
export function computeRangeMod(attacker: Ship, target: Ship): number {
  return computeRangeModToTarget(attacker, target);
}

/**
 * Compute velocity modifier: subtract 1 per hex of velocity difference > 2.
 * Velocity difference is the hex distance between their velocity vectors.
 */
export function computeVelocityMod(attacker: Ship, target: Ship): number {
  return computeVelocityModToTarget(attacker, target);
}

export function computeRangeModToTarget(
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
): number {
  return hexDistance(getClosestApproachHex(attacker, target), target.position);
}

export function computeVelocityModToTarget(
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'velocity'>,
): number {
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

export function getDeclaredCombatStrength(
  ships: Ship[],
  declaredStrength?: number | null,
): number {
  const maxStrength = getCombatStrength(ships);
  if (declaredStrength == null) return maxStrength;
  return Math.max(1, Math.min(maxStrength, declaredStrength));
}

/**
 * Check if a ship can initiate an attack (not defensive-only, not disabled).
 */
export function canAttack(ship: Ship): boolean {
  if (ship.destroyed || ship.landed || ship.damage.disabledTurns > 0) return false;
  const stats = SHIP_STATS[ship.type];
  return stats ? !stats.defensiveOnly : false;
}

/**
 * Check if a ship can counterattack (non-commercial, not destroyed, not disabled).
 */
export function canCounterattack(ship: Ship): boolean {
  if (ship.destroyed || ship.landed || ship.damage.disabledTurns > 0) return false;
  const stats = SHIP_STATS[ship.type];
  return stats ? stats.combat > 0 && !stats.defensiveOnly : false;
}

function getTrackedPath(ship: Ship) {
  return ship.lastMovementPath && ship.lastMovementPath.length > 0
    ? ship.lastMovementPath
    : [ship.position];
}

export function getClosestApproachHex(
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
) {
  let bestHex = getTrackedPath(attacker)[0];
  let bestDistance = hexDistance(bestHex, target.position);

  for (const pathHex of getTrackedPath(attacker)) {
    const distance = hexDistance(pathHex, target.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHex = pathHex;
    }
  }

  return bestHex;
}

export function computeGroupRangeMod(attackers: Ship[], target: Ship): number {
  return computeGroupRangeModToTarget(attackers, target);
}

export function computeGroupVelocityMod(attackers: Ship[], target: Ship): number {
  return computeGroupVelocityModToTarget(attackers, target);
}

export function hasLineOfSight(attacker: Ship, target: Ship, map: SolarSystemMap): boolean {
  return hasLineOfSightToTarget(attacker, target, map);
}

export function computeGroupRangeModToTarget(
  attackers: Ship[],
  target: Pick<Ship | Ordnance, 'position'>,
): number {
  if (attackers.length === 0) return 0;
  return Math.max(...attackers.map(attacker => computeRangeModToTarget(attacker, target)));
}

export function computeGroupVelocityModToTarget(
  attackers: Ship[],
  target: Pick<Ship | Ordnance, 'velocity'>,
): number {
  if (attackers.length === 0) return 0;
  return Math.max(...attackers.map(attacker => computeVelocityModToTarget(attacker, target)));
}

export function hasLineOfSightToTarget(
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
  map: SolarSystemMap,
): boolean {
  const from = getClosestApproachHex(attacker, target);
  const path = hexLineDraw(from, target.position);

  for (let i = 1; i < path.length - 1; i++) {
    if (map.hexes.get(hexKey(path[i]))?.body) {
      return false;
    }
  }

  return true;
}

export function hasBaseLineOfSight(
  baseCoord: { q: number; r: number },
  target: Pick<Ship | Ordnance, 'position'>,
  map: SolarSystemMap,
): boolean {
  const path = hexLineDraw(baseCoord, target.position);

  for (let i = 1; i < path.length - 1; i++) {
    if (map.hexes.get(hexKey(path[i]))?.body) {
      return false;
    }
  }

  return true;
}

export function computeBaseRangeMod(
  baseCoord: { q: number; r: number },
  target: Pick<Ship | Ordnance, 'position'>,
): number {
  return hexDistance(baseCoord, target.position);
}

export function computeBaseVelocityMod(
  target: Pick<Ship | Ordnance, 'velocity'>,
): number {
  const dq = Math.abs(target.velocity.dq);
  const dr = Math.abs(target.velocity.dr);
  const ds = Math.abs(-target.velocity.dq - target.velocity.dr);
  const velDiff = Math.max(dq, dr, ds);
  return Math.max(0, velDiff - 2);
}

export function getCounterattackers(target: Ship, allShips: Ship[]): Ship[] {
  return allShips.filter(ship =>
    ship.owner === target.owner &&
    canCounterattack(ship) &&
    hexEqual(ship.position, target.position) &&
    ship.velocity.dq === target.velocity.dq &&
    ship.velocity.dr === target.velocity.dr,
  );
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
  _map?: SolarSystemMap,
  declaredAttackStrength?: number | null,
): CombatResolution {
  const maxAttackStrength = getCombatStrength(attackers);
  const attackStrength = getDeclaredCombatStrength(attackers, declaredAttackStrength);
  const defendStrength = getCombatStrength([target]);
  const odds = computeOdds(attackStrength, defendStrength);

  // Use the worst applicable modifiers across the attacking group.
  const primaryAttacker = chooseCounterattackTarget(attackers);
  const rangeMod = computeGroupRangeMod(attackers, target);
  const velocityMod = computeGroupVelocityMod(attackers, target);

  const dieRoll = rollD6(rng);
  const modifiedRoll = dieRoll - rangeMod - velocityMod;
  const damageResult = lookupGunCombat(odds, modifiedRoll);

  // Counterattack happens before attack damage is implemented.
  let counterattack: CombatResolution | null = null;
  const counterattackers = getCounterattackers(target, allShips);
  if (counterattackers.length > 0) {
    const counterStrength = getCombatStrength(counterattackers);
    const counterOdds = computeOdds(counterStrength, maxAttackStrength);
    const counterRange = rangeMod;
    const counterVelMod = velocityMod;

    const counterDie = rollD6(rng);
    const counterModified = counterDie - counterRange - counterVelMod;
    const counterResult = lookupGunCombat(counterOdds, counterModified);

    counterattack = {
      attackerIds: counterattackers.map(ship => ship.id),
      targetId: primaryAttacker.id,
      odds: counterOdds,
      attackStrength: counterStrength,
      defendStrength: maxAttackStrength,
      rangeMod: counterRange,
      velocityMod: counterVelMod,
      dieRoll: counterDie,
      modifiedRoll: counterModified,
      damageResult: counterResult,
      counterattack: null,
    };
  }

  if (counterattack) {
    applyDamage(primaryAttacker, counterattack.damageResult);
  }

  applyDamage(target, damageResult);

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

function chooseCounterattackTarget(attackers: Ship[]): Ship {
  return [...attackers].sort((a, b) => {
    const aStrength = SHIP_STATS[a.type]?.combat ?? 0;
    const bStrength = SHIP_STATS[b.type]?.combat ?? 0;
    if (bStrength !== aStrength) return bStrength - aStrength;
    if (b.damage.disabledTurns !== a.damage.disabledTurns) {
      return b.damage.disabledTurns - a.damage.disabledTurns;
    }
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Resolve base defense fire.
 * Bases fire at 2:1 odds against enemy ships in gravity hexes adjacent to the base.
 * No range or velocity modifiers apply.
 */
export function resolveBaseDefense(
  state: {
    ships: Ship[];
    ordnance?: Ordnance[];
    destroyedBases?: string[];
    players: { bases: string[] }[];
  },
  activePlayer: number,
  map: SolarSystemMap,
  rng?: () => number,
): CombatResult[] {
  const results: CombatResult[] = [];
  const destroyedBases = new Set(state.destroyedBases ?? []);
  const ownedBases = state.players[activePlayer]?.bases ?? [];
  const enemyNukes = state.ordnance?.filter(ord =>
    ord.type === 'nuke' &&
    ord.owner !== activePlayer &&
    !ord.destroyed,
  ) ?? [];

  for (const key of ownedBases) {
    if (destroyedBases.has(key)) continue;
    const hex = map.hexes.get(key);
    if (!hex?.base) continue;
    if (!bodyHasGravity(hex.base.bodyName, map)) continue;

    const bodyName = hex.base.bodyName;
    const [bq, br] = key.split(',').map(Number);
    const baseCoord = { q: bq, r: br };

    // Find enemy ships in gravity hexes adjacent to this base
    for (const ship of state.ships) {
      if (ship.owner === activePlayer || ship.destroyed) continue;
      if (ship.landed) continue; // landed ships are safe

      const shipHex = map.hexes.get(hexKey(ship.position));
      if (!shipHex?.gravity) continue;
      if (shipHex.gravity.bodyName !== bodyName) continue;

      // Check if this gravity hex is adjacent to the base hex
      const dist = hexDistance(ship.position, { q: bq, r: br });
      if (dist !== 1) continue;

      // Base fires at 2:1, no range/velocity modifiers
      const odds = '2:1' as const;
      const dieRoll = rollD6(rng);
      const modifiedRoll = dieRoll; // No modifiers
      const damageResult = lookupGunCombat(odds, modifiedRoll);

      applyDamage(ship, damageResult);

      results.push({
        attackerIds: [`base:${key}`],
        targetId: ship.id,
        targetType: 'ship',
        attackType: 'baseDefense',
        odds,
        attackStrength: 0,
        defendStrength: 0,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll,
        modifiedRoll,
        damageType: damageResult.type,
        disabledTurns: damageResult.disabledTurns,
        counterattack: null,
      });
    }

    for (const ord of enemyNukes) {
      if (ord.destroyed) continue;
      if (!hasBaseLineOfSight(baseCoord, ord, map)) continue;

      const odds = '2:1' as const;
      const rangeMod = computeBaseRangeMod(baseCoord, ord);
      const velocityMod = computeBaseVelocityMod(ord);
      const dieRoll = rollD6(rng);
      const modifiedRoll = dieRoll - rangeMod - velocityMod;
      const damageResult = lookupGunCombat(odds, modifiedRoll);
      const destroyed = damageResult.type !== 'none';
      if (destroyed) {
        ord.destroyed = true;
      }

      results.push({
        attackerIds: [`base:${key}`],
        targetId: ord.id,
        targetType: 'ordnance',
        attackType: 'baseDefense',
        odds,
        attackStrength: 0,
        defendStrength: 0,
        rangeMod,
        velocityMod,
        dieRoll,
        modifiedRoll,
        damageType: destroyed ? 'eliminated' : 'none',
        disabledTurns: 0,
        counterattack: null,
      });
    }
  }

  return results;
}

function bodyHasGravity(bodyName: string, map: SolarSystemMap): boolean {
  for (const hex of map.hexes.values()) {
    if (hex.gravity?.bodyName === bodyName) return true;
  }
  return false;
}
