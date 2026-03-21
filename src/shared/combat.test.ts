import { describe, expect, it } from 'vitest';

import {
  applyDamage,
  canAttack,
  canCounterattack,
  computeGroupRangeMod,
  computeGroupVelocityMod,
  computeOdds,
  computeRangeMod,
  computeVelocityMod,
  getCombatStrength,
  getCounterattackers,
  hasLineOfSight,
  lookupGunCombat,
  lookupOtherDamage,
  resolveCombat,
  rollD6,
} from './combat';
import type { Ship, SolarSystemMap } from './types';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'test',
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

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

  it('uses closest approach from the most recent movement path', () => {
    const a = makeShip({
      position: { q: 0, r: 0 },
      lastMovementPath: [
        { q: 3, r: 0 },
        { q: 2, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 0 },
      ],
    });
    const b = makeShip({ position: { q: 3, r: 1 } });

    expect(computeRangeMod(a, b)).toBe(1);
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
    expect(getCombatStrength([makeShip()])).toBe(2);
  });

  it('returns 0 for destroyed ship', () => {
    expect(getCombatStrength([makeShip({ destroyed: true })])).toBe(0);
  });

  it('returns 0 for disabled ship', () => {
    expect(
      getCombatStrength([makeShip({ damage: { disabledTurns: 1 } })]),
    ).toBe(0);
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

  it('disabled dreadnaught can still attack (rulebook p.6 exception)', () => {
    expect(
      canAttack(
        makeShip({
          type: 'dreadnaught',
          damage: { disabledTurns: 3 },
        }),
      ),
    ).toBe(true);
  });

  it('destroyed dreadnaught cannot attack', () => {
    expect(canAttack(makeShip({ type: 'dreadnaught', destroyed: true }))).toBe(
      false,
    );
  });

  it('D1-disabled orbital base can still attack (rulebook p.6)', () => {
    expect(
      canAttack(
        makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: 1 },
        }),
      ),
    ).toBe(true);
  });

  it('D2+ disabled orbital base cannot attack', () => {
    expect(
      canAttack(
        makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: 2 },
        }),
      ),
    ).toBe(false);
  });

  it('destroyed ship cannot attack', () => {
    expect(canAttack(makeShip({ destroyed: true }))).toBe(false);
  });
});

describe('canCounterattack', () => {
  it('transport cannot counterattack', () => {
    expect(canCounterattack(makeShip({ type: 'transport' }))).toBe(false);
  });

  it('disabled ship cannot counterattack', () => {
    expect(canCounterattack(makeShip({ damage: { disabledTurns: 1 } }))).toBe(
      false,
    );
  });

  it('disabled dreadnaught can still counterattack (rulebook p.6 exception)', () => {
    expect(
      canCounterattack(
        makeShip({
          type: 'dreadnaught',
          damage: { disabledTurns: 2 },
        }),
      ),
    ).toBe(true);
  });

  it('destroyed dreadnaught cannot counterattack', () => {
    expect(
      canCounterattack(makeShip({ type: 'dreadnaught', destroyed: true })),
    ).toBe(false);
  });

  it('D1-disabled orbital base can still counterattack (rulebook p.6)', () => {
    expect(
      canCounterattack(
        makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: 1 },
        }),
      ),
    ).toBe(true);
  });

  it('D2+ disabled orbital base cannot counterattack', () => {
    expect(
      canCounterattack(
        makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: 2 },
        }),
      ),
    ).toBe(false);
  });
});

describe('group combat helpers', () => {
  it('uses the worst range modifier across multiple attackers', () => {
    const close = makeShip({
      id: 'close',
      position: { q: 0, r: 0 },
    });
    const far = makeShip({
      id: 'far',
      position: { q: 6, r: 0 },
      lastMovementPath: [{ q: 6, r: 0 }],
    });
    const target = makeShip({
      id: 't',
      position: { q: 1, r: 0 },
    });

    expect(computeGroupRangeMod([close, far], target)).toBe(5);
  });

  it('uses the worst velocity modifier across multiple attackers', () => {
    const slow = makeShip({
      id: 'slow',
      velocity: { dq: 2, dr: 0 },
    });
    const fast = makeShip({
      id: 'fast',
      velocity: { dq: 6, dr: 0 },
    });
    const target = makeShip({
      id: 't',
      velocity: { dq: 0, dr: 0 },
    });

    expect(computeGroupVelocityMod([slow, fast], target)).toBe(4);
  });
});

describe('line of sight', () => {
  it('is blocked by body hexes between attacker and target', () => {
    const attacker = makeShip({ position: { q: 0, r: 0 } });
    const target = makeShip({ position: { q: 2, r: 0 } });
    const map: SolarSystemMap = {
      hexes: new Map([
        [
          '1,0',
          {
            terrain: 'planetSurface',
            body: { name: 'Body', destructive: false },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };

    expect(hasLineOfSight(attacker, target, map)).toBe(false);
  });
});

describe('counterattack groups', () => {
  it('includes same-hex same-course allied ships in the counterattack', () => {
    const target = makeShip({
      id: 'target',
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const escort = makeShip({
      id: 'escort',
      owner: 1,
      originalOwner: 0,
      type: 'packet',
      position: { q: 1, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const outsider = makeShip({
      id: 'outsider',
      owner: 1,
      originalOwner: 0,
      position: { q: 2, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const ships = [target, escort, outsider];

    expect(getCounterattackers(target, ships).map((ship) => ship.id)).toEqual([
      'target',
      'escort',
    ]);
  });
});

describe('lookupGunCombat', () => {
  it('1:4 odds, roll 0 = no effect', () => {
    expect(lookupGunCombat('1:4', 0)).toEqual({
      type: 'none',
      disabledTurns: 0,
    });
  });

  it('4:1 odds, roll 6 = eliminated', () => {
    expect(lookupGunCombat('4:1', 6)).toEqual({
      type: 'eliminated',
      disabledTurns: 0,
    });
  });

  it('1:1 odds, roll 4 = D2', () => {
    expect(lookupGunCombat('1:1', 4)).toEqual({
      type: 'disabled',
      disabledTurns: 2,
    });
  });

  it('2:1 odds, roll 5 = D4', () => {
    expect(lookupGunCombat('2:1', 5)).toEqual({
      type: 'disabled',
      disabledTurns: 4,
    });
  });

  it('clamps roll to 0-6 range', () => {
    expect(lookupGunCombat('1:1', -5)).toEqual({
      type: 'none',
      disabledTurns: 0,
    });

    expect(lookupGunCombat('1:1', 10)).toEqual({
      type: 'disabled',
      disabledTurns: 4,
    });
  });
});

describe('lookupOtherDamage', () => {
  it('torpedo roll 1 = no effect', () => {
    expect(lookupOtherDamage(1, 'torpedo')).toEqual({
      type: 'none',
      disabledTurns: 0,
    });
  });

  it('torpedo roll 2 = D1', () => {
    expect(lookupOtherDamage(2, 'torpedo')).toEqual({
      type: 'disabled',
      disabledTurns: 1,
    });
  });

  it('torpedo roll 6 = D3', () => {
    expect(lookupOtherDamage(6, 'torpedo')).toEqual({
      type: 'disabled',
      disabledTurns: 3,
    });
  });

  it('mine roll 4 = no effect', () => {
    expect(lookupOtherDamage(4, 'mine')).toEqual({
      type: 'none',
      disabledTurns: 0,
    });
  });

  it('mine roll 5 = D2', () => {
    expect(lookupOtherDamage(5, 'mine')).toEqual({
      type: 'disabled',
      disabledTurns: 2,
    });
  });

  it('asteroid roll 5 = D1', () => {
    expect(lookupOtherDamage(5, 'asteroid')).toEqual({
      type: 'disabled',
      disabledTurns: 1,
    });
  });

  it('asteroid roll 6 = D2', () => {
    expect(lookupOtherDamage(6, 'asteroid')).toEqual({
      type: 'disabled',
      disabledTurns: 2,
    });
  });

  it('ram roll 5 = D3', () => {
    expect(lookupOtherDamage(5, 'ram')).toEqual({
      type: 'disabled',
      disabledTurns: 3,
    });
  });

  it('ram roll 6 = D5', () => {
    expect(lookupOtherDamage(6, 'ram')).toEqual({
      type: 'disabled',
      disabledTurns: 5,
    });
  });

  it('defaults to torpedo when no source specified', () => {
    expect(lookupOtherDamage(3)).toEqual({
      type: 'disabled',
      disabledTurns: 1,
    });
  });
});

describe('applyDamage', () => {
  it('no effect does nothing', () => {
    const ship = makeShip();

    const result = applyDamage(ship, {
      type: 'none',
      disabledTurns: 0,
    });

    expect(result).toBe(false);
    expect(ship.destroyed).toBe(false);
  });

  it('eliminated destroys ship', () => {
    const ship = makeShip();

    const result = applyDamage(ship, {
      type: 'eliminated',
      disabledTurns: 0,
    });

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

    const result = applyDamage(ship, {
      type: 'disabled',
      disabledTurns: 3,
    });

    expect(result).toBe(true);
    expect(ship.destroyed).toBe(true);
  });
});

describe('rollD6', () => {
  it('returns value between 1 and 6', () => {
    for (let i = 0; i < 100; i++) {
      const roll = rollD6(Math.random);

      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  it('uses provided RNG', () => {
    expect(rollD6(() => 0.0)).toBe(1);
    expect(rollD6(() => 0.99)).toBe(6);
  });
});

describe('resolveCombat', () => {
  it('resolves attack with deterministic RNG', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
    });
    const rng = () => 0.7; // roll 5

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.attackerIds).toEqual(['a']);
    expect(result.targetId).toBe('t');
    expect(result.odds).toBe('1:1');
    expect(result.rangeMod).toBe(1);
    expect(result.dieRoll).toBe(5);
    // modifiedRoll = 5 - 1 (range) - 0 (velocity) = 4
    expect(result.modifiedRoll).toBe(4);
    // At 1:1 odds, modified roll 4 = D2 per PDF Gun Combat Table
    expect(result.damageResult.type).toBe('disabled');
    expect(result.damageResult.disabledTurns).toBe(2);
    expect(result.counterattack).not.toBeNull();
    expect(attacker.damage.disabledTurns).toBe(2);
  });

  it('counterattack when target survives undamaged', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
    });
    const rng = () => 0.0; // roll 1, modifiedRoll = 0 -> no effect at 1:1

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.damageResult.type).toBe('none');
    expect(result.counterattack).not.toBeNull();
    expect(result.counterattack?.attackerIds).toEqual(['t']);
    expect(result.counterattack?.targetId).toBe('a');
  });

  it('target still counterattacks even if the attack destroys it', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'dreadnaught',
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const rng = () => 0.99; // roll 6

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.damageResult.type).toBe('eliminated');
    expect(target.destroyed).toBe(true);
    expect(result.counterattack).not.toBeNull();
    expect(attacker.damage.disabledTurns).toBeGreaterThan(0);
  });

  it('defensive-only ships do not counterattack', () => {
    const attacker = makeShip({ id: 'a', owner: 0 });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      type: 'transport',
    });
    const rng = () => 0.0; // roll 1

    const result = resolveCombat([attacker], target, [attacker, target], rng);

    expect(result.counterattack).toBeNull();
  });

  it('multiple attackers combine strength', () => {
    const a1 = makeShip({ id: 'a1', owner: 0 });
    const a2 = makeShip({ id: 'a2', owner: 0 });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
    });
    const rng = () => 0.5;

    const result = resolveCombat([a1, a2], target, [a1, a2, target], rng);

    expect(result.attackStrength).toBe(4);
    expect(result.defendStrength).toBe(2);
    expect(result.odds).toBe('2:1');
  });

  it('supports declared reduced-strength attacks', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'dreadnaught',
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });

    const result = resolveCombat(
      [attacker],
      target,
      [attacker, target],
      () => 0.5,
      undefined,
      2,
    );

    expect(result.attackStrength).toBe(2);
    expect(result.defendStrength).toBe(2);
    expect(result.odds).toBe('1:1');
  });

  it('uses the full attacking group strength as the defender value for counterattacks', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'dreadnaught',
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });

    const result = resolveCombat(
      [attacker],
      target,
      [attacker, target],
      () => 0.5,
      undefined,
      2,
    );

    expect(result.counterattack).not.toBeNull();
    expect(result.counterattack?.defendStrength).toBe(15);
    expect(result.counterattack?.odds).toBe('1:4');
  });
});

describe('capture mechanics', () => {
  it('captured ships cannot attack', () => {
    const ship = makeShip({ controlStatus: 'captured' });

    expect(canAttack(ship)).toBe(false);
  });

  it('captured ships cannot counterattack', () => {
    const ship = makeShip({ controlStatus: 'captured' });

    expect(canCounterattack(ship)).toBe(false);
  });

  it('non-captured ships can attack normally', () => {
    const ship = makeShip({});

    expect(canAttack(ship)).toBe(true);
  });
});

describe('heroism', () => {
  it('grants heroism to an underdog attacker that achieves D2 or better', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      type: 'corsair',
      position: { q: 0, r: 0 },
    });

    // Roll 6 -> at 1:2 odds (2 vs 4), modified roll 6 -> D3 per PDF table
    resolveCombat([attacker], target, [attacker, target], () => 0.999);

    expect(attacker.heroismAvailable).toBe(true);
  });

  it('does not grant heroism at even odds', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
    });

    // Roll 1 -> at 1:1 odds, modified roll 1 -> no effect
    resolveCombat([attacker], target, [attacker, target], () => 0.001);

    expect(target.heroismAvailable).toBeFalsy();
  });

  it('applies +1 heroism bonus to attack roll', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
      heroismAvailable: true,
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
    });

    // rng returns fixed value -> die roll 3 + heroism +1 = modified 4
    const result = resolveCombat(
      [attacker],
      target,
      [attacker, target],
      () => 0.34,
    );

    expect(result.modifiedRoll).toBe(4);
    expect(attacker.heroismAvailable).toBe(true);
  });

  it('heroism persists after use', () => {
    const attacker = makeShip({
      id: 'a',
      owner: 0,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
      heroismAvailable: true,
    });
    const target = makeShip({
      id: 't',
      owner: 1,
      originalOwner: 0,
      type: 'corvette',
      position: { q: 0, r: 0 },
    });

    resolveCombat([attacker], target, [attacker, target], () => 0.5);

    expect(attacker.heroismAvailable).toBe(true);
  });
});
