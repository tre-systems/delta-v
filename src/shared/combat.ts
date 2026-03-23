import {
  BASE_COMBAT_ODDS,
  BASE_FIRE_RANGE,
  DAMAGE_ELIMINATION_THRESHOLD,
  SHIP_STATS,
  VELOCITY_MODIFIER_THRESHOLD,
} from './constants';
import { hexDistance, hexEqual, hexKey, hexLineDraw, parseHexKey } from './hex';
import { bodyHasGravity } from './map-data';
import type { CombatResult, Ordnance, Ship, SolarSystemMap } from './types';
import { clamp, sumBy } from './util';

// --- Damage tables ---

// Gun Combat Results Table
// (from Triplanetary 2018 rulebook p.6)
// Rows: modified die roll (<=0 through 6+)
// Columns: odds ratio index
//   (0=1:4, 1=1:2, 2=1:1, 3=2:1, 4=3:1, 5=4:1)
// Values: 0 = no effect, 1-5 = disabled that many
//   turns, 6 = eliminated
const GUN_COMBAT_TABLE: number[][] = [
  [0, 0, 0, 0, 0, 0], // roll <= 0
  [0, 0, 0, 0, 0, 2], // roll 1
  [0, 0, 0, 0, 2, 3], // roll 2
  [0, 0, 0, 2, 3, 4], // roll 3
  [0, 0, 2, 3, 4, 5], // roll 4
  [0, 2, 3, 4, 5, 6], // roll 5
  [1, 3, 4, 5, 6, 6], // roll 6+
];

// Other Damage Tables per source type
// (from Triplanetary 2018 rulebook p.6)
// Index: die roll 1-6
// Values: 0 = no effect, 1-5 = disabled, 6 = eliminated
export type OtherDamageSource = 'torpedo' | 'mine' | 'asteroid' | 'ram';

const OTHER_DAMAGE_TABLES: Record<OtherDamageSource, number[]> = {
  torpedo: [0, 1, 1, 1, 2, 3],
  mine: [0, 0, 0, 0, 2, 2],
  asteroid: [0, 0, 0, 0, 1, 2],
  ram: [0, 0, 1, 1, 3, 5],
};

// Standard odds ratios
const ODDS_RATIOS = ['1:4', '1:2', '1:1', '2:1', '3:1', '4:1'] as const;

export type OddsRatio = (typeof ODDS_RATIOS)[number];

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
  disabledTurns: number;
}

// Compute combat odds ratio from attacker and
// defender strengths.
export const computeOdds = (
  attackStrength: number,
  defendStrength: number,
): OddsRatio => {
  if (defendStrength <= 0) return '4:1';

  if (attackStrength <= 0) return '1:4';

  const ratio = attackStrength / defendStrength;

  if (ratio >= 4) return '4:1';

  if (ratio >= 3) return '3:1';

  if (ratio >= 2) return '2:1';

  if (ratio >= 1) return '1:1';

  if (ratio >= 0.5) return '1:2';

  return '1:4';
};

// Get total combat strength for a group of attackers.
export const getCombatStrength = (ships: Ship[]): number =>
  sumBy(ships, (ship) => {
    if (ship.lifecycle === 'destroyed' || ship.damage.disabledTurns > 0) {
      return 0;
    }

    return SHIP_STATS[ship.type]?.combat ?? 0;
  });

export const getDeclaredCombatStrength = (
  ships: Ship[],
  declaredStrength?: number | null,
): number => {
  const maxStrength = getCombatStrength(ships);

  if (declaredStrength == null) return maxStrength;

  return clamp(declaredStrength, 1, maxStrength);
};

// Check if a ship can initiate an attack
// (not defensive-only, not disabled).
export const canAttack = (ship: Ship): boolean => {
  if (ship.lifecycle !== 'active') return false;

  if (ship.resuppliedThisTurn) return false;

  if (ship.control !== 'own') return false;

  const stats = SHIP_STATS[ship.type];

  if (!stats || stats.defensiveOnly) return false;

  // Dreadnaughts may still fire their guns even when
  // disabled (rulebook p.6). Orbital bases may fire
  // at D1 damage (disabledTurns === 1).
  if (ship.damage.disabledTurns > 0 && !canOperateWhileDisabled(ship)) {
    return false;
  }

  return true;
};

// Check if a ship can counterattack (non-commercial,
// not destroyed, not disabled). Dreadnaughts may
// counterattack even when disabled. Orbital bases
// may counterattack at D1 damage.
export const canCounterattack = (ship: Ship): boolean => {
  if (ship.lifecycle !== 'active') return false;

  if (ship.resuppliedThisTurn) return false;

  if (ship.control !== 'own') return false;

  const stats = SHIP_STATS[ship.type];

  if (!stats || stats.combat <= 0 || stats.defensiveOnly) {
    return false;
  }

  if (ship.damage.disabledTurns > 0 && !canOperateWhileDisabled(ship)) {
    return false;
  }

  return true;
};

// Dreadnaughts operate at any damage level.
// Orbital bases operate at D1 only.
const canOperateWhileDisabled = (ship: Ship): boolean =>
  ship.type === 'dreadnaught' ||
  (ship.type === 'orbitalBase' && ship.damage.disabledTurns <= 1);

const getTrackedPath = (ship: Ship) =>
  ship.lastMovementPath && ship.lastMovementPath.length > 0
    ? ship.lastMovementPath
    : [ship.position];

export const getClosestApproachHex = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
): Ship['position'] => {
  const trackedPath = getTrackedPath(attacker);

  return trackedPath.reduce(
    (best, pathHex) => {
      const distance = hexDistance(pathHex, target.position);

      return distance < best.distance ? { hex: pathHex, distance } : best;
    },
    {
      hex: trackedPath[0],
      distance: hexDistance(trackedPath[0], target.position),
    },
  ).hex;
};

// Compute range modifier: subtract 1 per hex of
// distance. Range is measured from the attacker's
// closest approach this turn to the target's final
// position.
export const computeRangeModToTarget = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
): number =>
  hexDistance(getClosestApproachHex(attacker, target), target.position);

export const computeRangeMod = (attacker: Ship, target: Ship): number =>
  computeRangeModToTarget(attacker, target);

export const computeVelocityModToTarget = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'velocity'>,
): number => {
  const dq = Math.abs(attacker.velocity.dq - target.velocity.dq);
  const dr = Math.abs(attacker.velocity.dr - target.velocity.dr);
  const ds = Math.abs(
    -attacker.velocity.dq -
      attacker.velocity.dr -
      (-target.velocity.dq - target.velocity.dr),
  );
  const velDiff = Math.max(dq, dr, ds);

  return Math.max(0, velDiff - VELOCITY_MODIFIER_THRESHOLD);
};

// Compute velocity modifier: subtract 1 per hex of
// velocity difference above threshold. Velocity
// difference is the hex distance between their
// velocity vectors.
export const computeVelocityMod = (attacker: Ship, target: Ship): number =>
  computeVelocityModToTarget(attacker, target);

export const computeGroupRangeModToTarget = (
  attackers: Ship[],
  target: Pick<Ship | Ordnance, 'position'>,
): number => {
  if (attackers.length === 0) return 0;

  return Math.max(
    ...attackers.map((attacker) => computeRangeModToTarget(attacker, target)),
  );
};

export const computeGroupRangeMod = (attackers: Ship[], target: Ship): number =>
  computeGroupRangeModToTarget(attackers, target);

export const computeGroupVelocityModToTarget = (
  attackers: Ship[],
  target: Pick<Ship | Ordnance, 'velocity'>,
): number => {
  if (attackers.length === 0) return 0;

  return Math.max(
    ...attackers.map((attacker) =>
      computeVelocityModToTarget(attacker, target),
    ),
  );
};

export const computeGroupVelocityMod = (
  attackers: Ship[],
  target: Ship,
): number => computeGroupVelocityModToTarget(attackers, target);

export const hasLineOfSightToTarget = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
  map: SolarSystemMap,
): boolean => {
  const from = getClosestApproachHex(attacker, target);
  const path = hexLineDraw(from, target.position);

  return !path.slice(1, -1).some((hex) => map.hexes.get(hexKey(hex))?.body);
};

export const hasLineOfSight = (
  attacker: Ship,
  target: Ship,
  map: SolarSystemMap,
): boolean => hasLineOfSightToTarget(attacker, target, map);

export const hasBaseLineOfSight = (
  baseCoord: { q: number; r: number },
  target: Pick<Ship | Ordnance, 'position'>,
  map: SolarSystemMap,
): boolean => {
  const path = hexLineDraw(baseCoord, target.position);

  return !path.slice(1, -1).some((hex) => map.hexes.get(hexKey(hex))?.body);
};

export const computeBaseRangeMod = (
  baseCoord: { q: number; r: number },
  target: Pick<Ship | Ordnance, 'position'>,
): number => hexDistance(baseCoord, target.position);

export const computeBaseVelocityMod = (
  target: Pick<Ship | Ordnance, 'velocity'>,
): number => {
  const dq = Math.abs(target.velocity.dq);
  const dr = Math.abs(target.velocity.dr);
  const ds = Math.abs(-target.velocity.dq - target.velocity.dr);
  const velDiff = Math.max(dq, dr, ds);

  return Math.max(0, velDiff - 2);
};

export const getCounterattackers = (target: Ship, allShips: Ship[]): Ship[] =>
  allShips.filter(
    (ship) =>
      ship.owner === target.owner &&
      canCounterattack(ship) &&
      hexEqual(ship.position, target.position) &&
      ship.velocity.dq === target.velocity.dq &&
      ship.velocity.dr === target.velocity.dr,
  );

// Look up result on the Gun Combat table.
export const lookupGunCombat = (
  odds: OddsRatio,
  modifiedRoll: number,
): DamageResult => {
  const col = ODDS_RATIOS.indexOf(odds);
  const row = clamp(modifiedRoll, 0, 6);
  const value = GUN_COMBAT_TABLE[row][col];

  if (value === 0) {
    return { type: 'none', disabledTurns: 0 };
  }

  if (value === 6) {
    return { type: 'eliminated', disabledTurns: 0 };
  }

  return { type: 'disabled', disabledTurns: value };
};

// Look up result on the Other Damage table
// (asteroids, mines, torpedoes, ramming).
// Each source type has its own damage column per
// the Triplanetary 2018 rulebook.
export const lookupOtherDamage = (
  dieRoll: number,
  source: OtherDamageSource = 'torpedo',
): DamageResult => {
  const idx = clamp(dieRoll - 1, 0, 5);
  const value = OTHER_DAMAGE_TABLES[source][idx];

  if (value === 0) {
    return { type: 'none', disabledTurns: 0 };
  }

  if (value === 6) {
    return { type: 'eliminated', disabledTurns: 0 };
  }

  return { type: 'disabled', disabledTurns: value };
};

// Apply damage to a ship.
// Returns true if the ship was eliminated.
export const applyDamage = (ship: Ship, result: DamageResult): boolean => {
  if (result.type === 'none') return false;

  if (result.type === 'eliminated') {
    ship.lifecycle = 'destroyed';
    ship.velocity = { dq: 0, dr: 0 };

    return true;
  }

  // Cumulative disabled turns
  ship.damage.disabledTurns += result.disabledTurns;

  if (ship.damage.disabledTurns >= DAMAGE_ELIMINATION_THRESHOLD) {
    ship.lifecycle = 'destroyed';
    ship.velocity = { dq: 0, dr: 0 };

    return true;
  }

  return false;
};

// Roll a d6 (1-6). Uses crypto.getRandomValues if
// available, else Math.random.
export const rollD6 = (rng: () => number): number => Math.floor(rng() * 6) + 1;

const chooseCounterattackTarget = (attackers: Ship[]): Ship =>
  [...attackers].sort((a, b) => {
    const aStrength = SHIP_STATS[a.type]?.combat ?? 0;
    const bStrength = SHIP_STATS[b.type]?.combat ?? 0;

    if (bStrength !== aStrength) {
      return bStrength - aStrength;
    }

    if (b.damage.disabledTurns !== a.damage.disabledTurns) {
      return b.damage.disabledTurns - a.damage.disabledTurns;
    }

    return a.id.localeCompare(b.id);
  })[0];

// Resolve a single combat attack.
export const resolveCombat = (
  attackers: Ship[],
  target: Ship,
  allShips: Ship[],
  rng: () => number,
  _map?: SolarSystemMap,
  declaredAttackStrength?: number | null,
): CombatResolution => {
  const maxAttackStrength = getCombatStrength(attackers);
  const attackStrength = getDeclaredCombatStrength(
    attackers,
    declaredAttackStrength,
  );
  const defendStrength = getCombatStrength([target]);
  const odds = computeOdds(attackStrength, defendStrength);

  // Use the worst applicable modifiers across the
  // attacking group.
  const primaryAttacker = chooseCounterattackTarget(attackers);
  const rangeMod = computeGroupRangeMod(attackers, target);
  const velocityMod = computeGroupVelocityMod(attackers, target);

  const dieRoll = rollD6(rng);
  const heroismAttacker = attackers.find((s) => s.heroismAvailable);
  const heroismBonus = heroismAttacker ? 1 : 0;
  const modifiedRoll = dieRoll - rangeMod - velocityMod + heroismBonus;
  const damageResult = lookupGunCombat(odds, modifiedRoll);

  // Counterattack happens before attack damage is
  // implemented.
  const counterattackers = getCounterattackers(target, allShips);

  const counterattack: CombatResolution | null =
    counterattackers.length > 0
      ? (() => {
          const counterStrength = getCombatStrength(counterattackers);
          const counterOdds = computeOdds(counterStrength, maxAttackStrength);
          const counterRange = rangeMod;
          const counterVelMod = velocityMod;
          const counterHeroism = counterattackers.some(
            (ship) => ship.heroismAvailable,
          )
            ? 1
            : 0;
          const counterDie = rollD6(rng);
          const counterModified =
            counterDie - counterRange - counterVelMod + counterHeroism;
          const counterResult = lookupGunCombat(counterOdds, counterModified);

          return {
            attackerIds: counterattackers.map((ship) => ship.id),
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
        })()
      : null;

  if (counterattack) {
    applyDamage(primaryAttacker, counterattack.damageResult);
  }

  applyDamage(target, damageResult);

  // Heroism: attackers that win at underdog odds
  // become permanently heroic.
  if (attackStrength < defendStrength) {
    const achievedD2OrBetter =
      damageResult.type === 'eliminated' ||
      (damageResult.type === 'disabled' && damageResult.disabledTurns >= 2);

    if (achievedD2OrBetter) {
      for (const attacker of attackers) {
        attacker.heroismAvailable = true;
      }
    }
  }

  return {
    attackerIds: attackers.map((s) => s.id),
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
};

// Resolve base defense fire.
// Bases fire at 2:1 odds against enemy ships in gravity
// hexes adjacent to the base. No range or velocity
// modifiers apply.
export const resolveBaseDefense = (
  state: {
    ships: Ship[];
    ordnance?: Ordnance[];
    destroyedBases?: string[];
    players: { bases: string[] }[];
  },
  activePlayer: number,
  map: SolarSystemMap,
  rng: () => number,
): CombatResult[] => {
  const results: CombatResult[] = [];
  const destroyedBases = new Set(state.destroyedBases ?? []);
  const ownedBases = state.players[activePlayer]?.bases ?? [];

  const enemyNukes =
    state.ordnance?.filter(
      (ord) =>
        ord.type === 'nuke' &&
        ord.owner !== activePlayer &&
        ord.lifecycle !== 'destroyed',
    ) ?? [];

  for (const key of ownedBases) {
    if (destroyedBases.has(key)) continue;

    const hex = map.hexes.get(key);

    if (!hex?.base) continue;

    if (!bodyHasGravity(hex.base.bodyName, map)) continue;

    const { bodyName } = hex.base;
    const baseCoord = parseHexKey(key);

    // Find enemy ships in gravity hexes adjacent
    // to this base
    for (const ship of state.ships) {
      if (ship.owner === activePlayer || ship.lifecycle !== 'active') {
        continue;
      }

      const shipHex = map.hexes.get(hexKey(ship.position));

      if (!shipHex?.gravity) continue;

      if (shipHex.gravity.bodyName !== bodyName) continue;

      // Check if this gravity hex is adjacent to
      // the base hex
      const dist = hexDistance(ship.position, baseCoord);

      if (dist > BASE_FIRE_RANGE) continue;

      const odds = BASE_COMBAT_ODDS;
      const dieRoll = rollD6(rng);
      const modifiedRoll = dieRoll;
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
      if (ord.lifecycle === 'destroyed') continue;

      if (!hasBaseLineOfSight(baseCoord, ord, map)) {
        continue;
      }

      const odds = BASE_COMBAT_ODDS;
      const rangeMod = computeBaseRangeMod(baseCoord, ord);
      const velocityMod = computeBaseVelocityMod(ord);
      const dieRoll = rollD6(rng);
      const modifiedRoll = dieRoll - rangeMod - velocityMod;
      const damageResult = lookupGunCombat(odds, modifiedRoll);
      const destroyed = damageResult.type !== 'none';

      if (destroyed) {
        ord.lifecycle = 'destroyed';
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
};
