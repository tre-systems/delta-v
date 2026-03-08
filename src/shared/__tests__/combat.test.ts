import { describe, it, expect } from 'vitest';
import {
  computeOdds, computeRangeMod, computeVelocityMod,
  getCombatStrength, canAttack, canCounterattack,
  lookupGunCombat, lookupOtherDamage, applyDamage,
  resolveCombat, rollD6,
} from '../combat';
import type { Ship } from '../types';

function makeShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'test',
    type: 'corvette',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 20,
    landed: false,
    destroyed: false,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

describe('computeOdds', () => {
  it('returns 4:1 for overwhelming advantage', () => {
    expect(computeOdds(16, 2)).toBe('4:1');
  });

  it('returns 3:1 for 3x advantage', () => {
    expect(computeOdds(6, 2)).toBe('3:1');
  });

  it('returns 2:1 for 2x advantage', () => {
    expect(computeOdds(4, 2)).toBe('2:1');
  });

  it('returns 1:1 for equal strength', () => {
    expect(computeOdds(2, 2)).toBe('1:1');
  });

  it('returns 1:2 for half strength', () => {
    expect(computeOdds(1, 2)).toBe('1:2');
  });

  it('returns 1:4 for very weak attacker', () => {
    expect(computeOdds(1, 8)).toBe('1:4');
  });

  it('handles zero defender', () => {
    expect(computeOdds(1, 0)).toBe('4:1');
  });

  it('handles zero attacker', () => {
    expect(computeOdds(0, 2)).toBe('1:4');
  });
});

describe('computeRangeMod', () => {
  it('returns 0 for same hex', () => {
    const a = makeShip({ position: { q: 0, r: 0 } });
    const b = makeShip({ position: { q: 0, r: 0 } });
    expect(computeRangeMod(a, b)).toBe(0);
  });

  it('returns distance for different hexes', () => {
    const a = makeShip({ position: { q: 0, r: 0 } });
    const b = makeShip({ position: { q: 3, r: -1 } });
    expect(computeRangeMod(a, b)).toBe(3);
  });
});

describe('computeVelocityMod', () => {
  it('returns 0 for same velocity', () => {
    const a = makeShip({ velocity: { dq: 1, dr: 0 } });
    const b = makeShip({ velocity: { dq: 1, dr: 0 } });
    expect(computeVelocityMod(a, b)).toBe(0);
  });

  it('returns 0 for velocity diff <= 2', () => {
    const a = makeShip({ velocity: { dq: 2, dr: 0 } });
    const b = makeShip({ velocity: { dq: 0, dr: 0 } });
    expect(computeVelocityMod(a, b)).toBe(0);
  });

  it('returns diff - 2 for velocity diff > 2', () => {
    const a = makeShip({ velocity: { dq: 5, dr: 0 } });
    const b = makeShip({ velocity: { dq: 0, dr: 0 } });
    expect(computeVelocityMod(a, b)).toBe(3);
  });
});

describe('getCombatStrength', () => {
  it('returns combat value for healthy ship', () => {
    expect(getCombatStrength([makeShip()])).toBe(2); // corvette
  });

  it('returns 0 for destroyed ship', () => {
    expect(getCombatStrength([makeShip({ destroyed: true })])).toBe(0);
  });

  it('returns 0 for disabled ship', () => {
    expect(getCombatStrength([makeShip({ damage: { disabledTurns: 1 } })])).toBe(0);
  });

  it('sums combat values of multiple ships', () => {
    const ships = [makeShip(), makeShip({ id: 's2' })];
    expect(getCombatStrength(ships)).toBe(4);
  });
});

describe('canAttack', () => {
  it('corvette can attack', () => {
    expect(canAttack(makeShip())).toBe(true);
  });

  it('transport cannot attack (defensive only)', () => {
    expect(canAttack(makeShip({ type: 'transport' }))).toBe(false);
  });

  it('disabled ship cannot attack', () => {
    expect(canAttack(makeShip({ damage: { disabledTurns: 1 } }))).toBe(false);
  });

  it('destroyed ship cannot attack', () => {
    expect(canAttack(makeShip({ destroyed: true }))).toBe(false);
  });
});

describe('canCounterattack', () => {
  it('transport can counterattack', () => {
    expect(canCounterattack(makeShip({ type: 'transport' }))).toBe(true);
  });

  it('disabled ship cannot counterattack', () => {
    expect(canCounterattack(makeShip({ damage: { disabledTurns: 1 } }))).toBe(false);
  });
});

describe('lookupGunCombat', () => {
  it('1:4 odds, roll 0 = no effect', () => {
    expect(lookupGunCombat('1:4', 0)).toEqual({ type: 'none', disabledTurns: 0 });
  });

  it('4:1 odds, roll 6 = eliminated', () => {
    expect(lookupGunCombat('4:1', 6)).toEqual({ type: 'eliminated', disabledTurns: 0 });
  });

  it('1:1 odds, roll 3 = D1', () => {
    // Table[3][2] = 1
    expect(lookupGunCombat('1:1', 3)).toEqual({ type: 'disabled', disabledTurns: 1 });
  });

  it('2:1 odds, roll 5 = D4', () => {
    // Table[5][3] = 4
    expect(lookupGunCombat('2:1', 5)).toEqual({ type: 'disabled', disabledTurns: 4 });
  });

  it('clamps roll to 0-6 range', () => {
    expect(lookupGunCombat('1:1', -5)).toEqual({ type: 'none', disabledTurns: 0 });
    expect(lookupGunCombat('1:1', 10)).toEqual({ type: 'disabled', disabledTurns: 4 });
  });
});

describe('lookupOtherDamage', () => {
  it('roll 1 = no effect', () => {
    expect(lookupOtherDamage(1)).toEqual({ type: 'none', disabledTurns: 0 });
  });

  it('roll 2 = D1', () => {
    expect(lookupOtherDamage(2)).toEqual({ type: 'disabled', disabledTurns: 1 });
  });

  it('roll 6 = eliminated', () => {
    expect(lookupOtherDamage(6)).toEqual({ type: 'eliminated', disabledTurns: 0 });
  });
});

describe('applyDamage', () => {
  it('no effect does nothing', () => {
    const ship = makeShip();
    const result = applyDamage(ship, { type: 'none', disabledTurns: 0 });
    expect(result).toBe(false);
    expect(ship.destroyed).toBe(false);
  });

  it('eliminated destroys ship', () => {
    const ship = makeShip();
    const result = applyDamage(ship, { type: 'eliminated', disabledTurns: 0 });
    expect(result).toBe(true);
    expect(ship.destroyed).toBe(true);
  });

  it('disabled adds turns cumulatively', () => {
    const ship = makeShip();
    applyDamage(ship, { type: 'disabled', disabledTurns: 3 });
    expect(ship.damage.disabledTurns).toBe(3);
    applyDamage(ship, { type: 'disabled', disabledTurns: 2 });
    expect(ship.damage.disabledTurns).toBe(5);
  });

  it('cumulative disabled >= 6 eliminates ship', () => {
    const ship = makeShip();
    applyDamage(ship, { type: 'disabled', disabledTurns: 4 });
    const result = applyDamage(ship, { type: 'disabled', disabledTurns: 3 });
    expect(result).toBe(true);
    expect(ship.destroyed).toBe(true);
  });
});

describe('rollD6', () => {
  it('returns value between 1 and 6', () => {
    for (let i = 0; i < 100; i++) {
      const roll = rollD6();
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  it('uses provided RNG', () => {
    // rng returning 0.0 -> roll 1
    expect(rollD6(() => 0.0)).toBe(1);
    // rng returning 0.99 -> roll 6
    expect(rollD6(() => 0.99)).toBe(6);
  });
});

describe('resolveCombat', () => {
  it('resolves attack with deterministic RNG', () => {
    const attacker = makeShip({ id: 'a', owner: 0, position: { q: 0, r: 0 } });
    const target = makeShip({ id: 't', owner: 1, position: { q: 1, r: 0 } });

    const rng = () => 0.5; // roll 4

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.attackerIds).toEqual(['a']);
    expect(result.targetId).toBe('t');
    expect(result.odds).toBe('1:1'); // 2 vs 2
    expect(result.rangeMod).toBe(1); // 1 hex away
    expect(result.dieRoll).toBe(4);
    // modifiedRoll = 4 - 1 (range) - 0 (velocity) = 3
    expect(result.modifiedRoll).toBe(3);
    // 1:1 odds, roll 3 -> D1 (target disabled), so no counterattack
    expect(result.damageResult.type).toBe('disabled');
    expect(result.damageResult.disabledTurns).toBe(1);
    expect(result.counterattack).toBeNull();
  });

  it('counterattack when target survives undamaged', () => {
    const attacker = makeShip({ id: 'a', owner: 0, position: { q: 0, r: 0 } });
    const target = makeShip({ id: 't', owner: 1, position: { q: 1, r: 0 } });

    const rng = () => 0.0; // roll 1, modifiedRoll = 0 -> no effect at 1:1

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.damageResult.type).toBe('none');
    expect(result.counterattack).not.toBeNull();
    expect(result.counterattack!.attackerIds).toEqual(['t']);
    expect(result.counterattack!.targetId).toBe('a');
  });

  it('no counterattack if target destroyed', () => {
    const attacker = makeShip({ id: 'a', owner: 0, type: 'dreadnaught' });
    const target = makeShip({ id: 't', owner: 1, position: { q: 0, r: 0 } });

    // High roll at close range with high odds -> eliminated
    const rng = () => 0.99; // roll 6
    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.damageResult.type).toBe('eliminated');
    expect(target.destroyed).toBe(true);
    expect(result.counterattack).toBeNull();
  });

  it('no counterattack from defensive-only ships if they cannot counterattack', () => {
    const attacker = makeShip({ id: 'a', owner: 0 });
    const target = makeShip({ id: 't', owner: 1, type: 'transport' });

    // Low roll -> no damage to target
    const rng = () => 0.0; // roll 1
    const result = resolveCombat([attacker], target, [attacker, target], rng);

    // Transport can counterattack (has combat strength)
    expect(result.counterattack).not.toBeNull();
  });

  it('multiple attackers combine strength', () => {
    const a1 = makeShip({ id: 'a1', owner: 0 });
    const a2 = makeShip({ id: 'a2', owner: 0 });
    const target = makeShip({ id: 't', owner: 1, position: { q: 1, r: 0 } });

    const rng = () => 0.5;
    const result = resolveCombat([a1, a2], target, [a1, a2, target], rng);

    expect(result.attackStrength).toBe(4); // 2 corvettes = 4
    expect(result.defendStrength).toBe(2);
    expect(result.odds).toBe('2:1');
  });
});
