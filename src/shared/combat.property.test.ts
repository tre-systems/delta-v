import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DamageResult, OddsRatio, OtherDamageSource } from './combat';
import {
  applyDamage,
  canAttack,
  canCounterattack,
  computeOdds,
  computeRangeMod,
  computeVelocityMod,
  getCombatStrength,
  lookupGunCombat,
  lookupOtherDamage,
  resolveCombat,
  rollD6,
} from './combat';
import {
  DAMAGE_ELIMINATION_THRESHOLD,
  SHIP_STATS,
  type ShipStats,
  type ShipType,
} from './constants';
import { asShipId } from './ids';
import type { Ship } from './types';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('test'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  nukesLaunchedSinceResupply: 0,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const arbPositiveInt = () => fc.integer({ min: 1, max: 100 });

const arbNonNegInt = () => fc.integer({ min: 0, max: 100 });

const arbShipType = () =>
  fc.constantFrom(...(Object.keys(SHIP_STATS) as ShipType[]));

const arbOddsRatio = (): fc.Arbitrary<OddsRatio> =>
  fc.constantFrom('1:4', '1:2', '1:1', '2:1', '3:1', '4:1');

const arbDieRoll = () => fc.integer({ min: 1, max: 6 });

const arbModifiedRoll = () => fc.integer({ min: -5, max: 12 });

const arbDamageSource = (): fc.Arbitrary<OtherDamageSource> =>
  fc.constantFrom('torpedo', 'mine', 'asteroid', 'ram');

describe('computeOdds properties', () => {
  it('always returns a valid odds ratio', () => {
    const validOdds = new Set(['1:4', '1:2', '1:1', '2:1', '3:1', '4:1']);

    fc.assert(
      fc.property(arbNonNegInt(), arbNonNegInt(), (attack, defend) => {
        expect(validOdds.has(computeOdds(attack, defend))).toBe(true);
      }),
    );
  });

  it('higher attack strength never produces worse odds', () => {
    const oddsOrder = ['1:4', '1:2', '1:1', '2:1', '3:1', '4:1'];

    fc.assert(
      fc.property(
        arbPositiveInt(),
        arbPositiveInt(),
        arbPositiveInt(),
        (a, bonus, defend) => {
          const oddsLow = computeOdds(a, defend);
          const oddsHigh = computeOdds(a + bonus, defend);

          expect(oddsOrder.indexOf(oddsHigh)).toBeGreaterThanOrEqual(
            oddsOrder.indexOf(oddsLow),
          );
        },
      ),
    );
  });

  it('zero defender always gives 4:1', () => {
    fc.assert(
      fc.property(arbPositiveInt(), (attack) => {
        expect(computeOdds(attack, 0)).toBe('4:1');
      }),
    );
  });

  it('zero attacker always gives 1:4', () => {
    fc.assert(
      fc.property(arbPositiveInt(), (defend) => {
        expect(computeOdds(0, defend)).toBe('1:4');
      }),
    );
  });

  it('equal strengths always give 1:1', () => {
    fc.assert(
      fc.property(arbPositiveInt(), (n) => {
        expect(computeOdds(n, n)).toBe('1:1');
      }),
    );
  });
});

describe('lookupGunCombat properties', () => {
  it('result type is always valid', () => {
    const validTypes = new Set(['none', 'disabled', 'eliminated']);

    fc.assert(
      fc.property(arbOddsRatio(), arbModifiedRoll(), (odds, roll) => {
        const result = lookupGunCombat(odds, roll);

        expect(validTypes.has(result.type)).toBe(true);
      }),
    );
  });

  it('disabled result always has positive disabledTurns', () => {
    fc.assert(
      fc.property(arbOddsRatio(), arbModifiedRoll(), (odds, roll) => {
        const result = lookupGunCombat(odds, roll);

        if (result.type === 'disabled') {
          expect(result.disabledTurns).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('none and eliminated results have 0 disabledTurns', () => {
    fc.assert(
      fc.property(arbOddsRatio(), arbModifiedRoll(), (odds, roll) => {
        const result = lookupGunCombat(odds, roll);

        if (result.type === 'none' || result.type === 'eliminated') {
          expect(result.disabledTurns).toBe(0);
        }
      }),
    );
  });

  it('higher modified roll never produces worse results at same odds', () => {
    const resultSeverity = (r: DamageResult) =>
      r.type === 'none' ? 0 : r.type === 'disabled' ? r.disabledTurns : 100;

    fc.assert(
      fc.property(arbOddsRatio(), arbModifiedRoll(), (odds, roll) => {
        const lower = lookupGunCombat(odds, roll);
        const higher = lookupGunCombat(odds, roll + 1);

        expect(resultSeverity(higher)).toBeGreaterThanOrEqual(
          resultSeverity(lower),
        );
      }),
    );
  });

  it('better odds never produce worse results at same roll', () => {
    const oddsOrder: OddsRatio[] = ['1:4', '1:2', '1:1', '2:1', '3:1', '4:1'];
    const resultSeverity = (r: DamageResult) =>
      r.type === 'none' ? 0 : r.type === 'disabled' ? r.disabledTurns : 100;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        arbModifiedRoll(),
        (oddsIdx, roll) => {
          const lower = lookupGunCombat(oddsOrder[oddsIdx], roll);
          const higher = lookupGunCombat(oddsOrder[oddsIdx + 1], roll);

          expect(resultSeverity(higher)).toBeGreaterThanOrEqual(
            resultSeverity(lower),
          );
        },
      ),
    );
  });
});

describe('lookupOtherDamage properties', () => {
  it('result type is always valid', () => {
    const validTypes = new Set(['none', 'disabled', 'eliminated']);

    fc.assert(
      fc.property(arbDieRoll(), arbDamageSource(), (roll, source) => {
        const result = lookupOtherDamage(roll, source);

        expect(validTypes.has(result.type)).toBe(true);
      }),
    );
  });

  it('higher rolls never produce less severe results', () => {
    const resultSeverity = (r: DamageResult) =>
      r.type === 'none' ? 0 : r.type === 'disabled' ? r.disabledTurns : 100;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        arbDamageSource(),
        (roll, source) => {
          const lower = lookupOtherDamage(roll, source);
          const higher = lookupOtherDamage(roll + 1, source);

          expect(resultSeverity(higher)).toBeGreaterThanOrEqual(
            resultSeverity(lower),
          );
        },
      ),
    );
  });
});

describe('applyDamage properties', () => {
  it('none damage never destroys a ship', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({ type: shipType });

        const eliminated = applyDamage(ship, {
          type: 'none',
          disabledTurns: 0,
        });

        expect(eliminated).toBe(false);
        expect(ship.lifecycle).toBe('active');
      }),
    );
  });

  it('eliminated damage always destroys a ship', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({ type: shipType });

        const eliminated = applyDamage(ship, {
          type: 'eliminated',
          disabledTurns: 0,
        });

        expect(eliminated).toBe(true);
        expect(ship.lifecycle).toBe('destroyed');
        expect(ship.velocity).toEqual({ dq: 0, dr: 0 });
      }),
    );
  });

  it('cumulative disabled turns >= threshold eliminates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (existing, added) => {
          const ship = makeShip({
            damage: { disabledTurns: existing },
          });
          const result: DamageResult = {
            type: 'disabled',
            disabledTurns: added,
          };

          const eliminated = applyDamage(ship, result);

          if (existing + added >= DAMAGE_ELIMINATION_THRESHOLD) {
            expect(eliminated).toBe(true);
            expect(ship.lifecycle).toBe('destroyed');
          } else {
            expect(eliminated).toBe(false);
            expect(ship.lifecycle).toBe('active');
            expect(ship.damage.disabledTurns).toBe(existing + added);
          }
        },
      ),
    );
  });
});

describe('getCombatStrength properties', () => {
  it('destroyed ships contribute 0 strength', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ships = [makeShip({ type: shipType, lifecycle: 'destroyed' })];

        expect(getCombatStrength(ships)).toBe(0);
      }),
    );
  });

  it('disabled ships contribute 0 strength', () => {
    fc.assert(
      fc.property(
        arbShipType(),
        fc.integer({ min: 1, max: 5 }),
        (shipType, turns) => {
          const ships = [
            makeShip({
              type: shipType,
              damage: { disabledTurns: turns },
            }),
          ];

          expect(getCombatStrength(ships)).toBe(0);
        },
      ),
    );
  });

  it('strength is non-negative', () => {
    fc.assert(
      fc.property(
        fc.array(arbShipType(), { minLength: 0, maxLength: 5 }),
        (types) => {
          const ships = types.map((t, i) =>
            makeShip({ id: asShipId(`s${i}`), type: t }),
          );

          expect(getCombatStrength(ships)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('strength is additive for healthy ships', () => {
    fc.assert(
      fc.property(
        fc.array(arbShipType(), { minLength: 1, maxLength: 5 }),
        (types) => {
          const ships = types.map((t, i) =>
            makeShip({ id: asShipId(`s${i}`), type: t }),
          );
          const totalStrength = getCombatStrength(ships);
          const expectedSum = types.reduce(
            (sum, t) => sum + (SHIP_STATS[t]?.combat ?? 0),
            0,
          );

          expect(totalStrength).toBe(expectedSum);
        },
      ),
    );
  });
});

describe('canAttack / canCounterattack properties', () => {
  it('destroyed ships cannot attack', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({
          type: shipType,
          lifecycle: 'destroyed',
        });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('landed ships cannot attack', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({ type: shipType, lifecycle: 'landed' });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('resupplied ships cannot attack', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({
          type: shipType,
          resuppliedThisTurn: true,
        });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('surrendered ships cannot attack', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({
          type: shipType,
          control: 'surrendered',
        });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('captured ships cannot attack', () => {
    fc.assert(
      fc.property(arbShipType(), (shipType) => {
        const ship = makeShip({
          type: shipType,
          control: 'captured',
        });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('defensive-only ships cannot attack', () => {
    const defensiveTypes = (
      Object.entries(SHIP_STATS) as [ShipType, ShipStats][]
    )
      .filter(([, stats]) => stats.defensiveOnly)
      .map(([type]) => type);

    fc.assert(
      fc.property(fc.constantFrom(...defensiveTypes), (shipType) => {
        const ship = makeShip({ type: shipType });

        expect(canAttack(ship)).toBe(false);
        expect(canCounterattack(ship)).toBe(false);
      }),
    );
  });

  it('disabled dreadnaughts can still attack', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (turns) => {
        const ship = makeShip({
          type: 'dreadnaught',
          damage: { disabledTurns: turns },
        });

        expect(canAttack(ship)).toBe(true);
        expect(canCounterattack(ship)).toBe(true);
      }),
    );
  });

  it('disabled non-dreadnaught non-orbitalBase warships cannot attack', () => {
    const warshipTypes = (Object.entries(SHIP_STATS) as [ShipType, ShipStats][])
      .filter(
        ([type, stats]) =>
          !stats.defensiveOnly &&
          type !== 'dreadnaught' &&
          type !== 'orbitalBase',
      )
      .map(([type]) => type);

    fc.assert(
      fc.property(
        fc.constantFrom(...warshipTypes),
        fc.integer({ min: 1, max: 5 }),
        (shipType, turns) => {
          const ship = makeShip({
            type: shipType,
            damage: { disabledTurns: turns },
          });

          expect(canAttack(ship)).toBe(false);
        },
      ),
    );
  });

  it('D1-disabled orbital bases can attack but D2+ cannot', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (turns) => {
        const ship = makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: turns },
        });

        if (turns <= 1) {
          expect(canAttack(ship)).toBe(true);
        } else {
          expect(canAttack(ship)).toBe(false);
        }
      }),
    );
  });
});

describe('combat modifier properties', () => {
  it('range mod is non-negative', () => {
    fc.assert(
      fc.property(
        fc.record({
          q: fc.integer({ min: -20, max: 20 }),
          r: fc.integer({ min: -20, max: 20 }),
        }),
        fc.record({
          q: fc.integer({ min: -20, max: 20 }),
          r: fc.integer({ min: -20, max: 20 }),
        }),
        (pos1, pos2) => {
          const attacker = makeShip({ position: pos1 });
          const target = makeShip({ position: pos2 });

          expect(computeRangeMod(attacker, target)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('velocity mod is non-negative', () => {
    fc.assert(
      fc.property(
        fc.record({
          dq: fc.integer({ min: -10, max: 10 }),
          dr: fc.integer({ min: -10, max: 10 }),
        }),
        fc.record({
          dq: fc.integer({ min: -10, max: 10 }),
          dr: fc.integer({ min: -10, max: 10 }),
        }),
        (vel1, vel2) => {
          const attacker = makeShip({ velocity: vel1 });
          const target = makeShip({ velocity: vel2 });

          expect(computeVelocityMod(attacker, target)).toBeGreaterThanOrEqual(
            0,
          );
        },
      ),
    );
  });

  it('same velocity gives 0 velocity mod', () => {
    fc.assert(
      fc.property(
        fc.record({
          dq: fc.integer({ min: -10, max: 10 }),
          dr: fc.integer({ min: -10, max: 10 }),
        }),
        (vel) => {
          const attacker = makeShip({ velocity: vel });
          const target = makeShip({ velocity: vel });

          expect(computeVelocityMod(attacker, target)).toBe(0);
        },
      ),
    );
  });
});

describe('rollD6 properties', () => {
  it('always returns 1-6', () => {
    fc.assert(
      fc.property(
        fc.double({
          min: 0,
          max: 1,
          noNaN: true,
          maxExcluded: true,
        }),
        (n) => {
          const rng = () => n;
          const result = rollD6(rng);

          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).toBeLessThanOrEqual(6);
        },
      ),
    );
  });
});

describe('resolveCombat properties', () => {
  it('combat resolution always produces valid result structure', () => {
    fc.assert(
      fc.property(
        fc.double({
          min: 0,
          max: 1,
          noNaN: true,
          maxExcluded: true,
        }),
        fc.double({
          min: 0,
          max: 1,
          noNaN: true,
          maxExcluded: true,
        }),
        (rng1, rng2) => {
          let callCount = 0;
          const rng = () => (callCount++ % 2 === 0 ? rng1 : rng2);

          const attackers = [
            makeShip({
              id: asShipId('a1'),
              type: 'corvette',
              owner: 0,
              originalOwner: 0,
            }),
          ];
          const target = makeShip({
            id: asShipId('t1'),
            type: 'corvette',
            owner: 1,
            originalOwner: 0,
            position: { q: 1, r: 0 },
          });
          const allShips = [...attackers, target];

          const result = resolveCombat(attackers, target, allShips, rng);

          expect(result.dieRoll).toBeGreaterThanOrEqual(1);
          expect(result.dieRoll).toBeLessThanOrEqual(6);
          expect(['none', 'disabled', 'eliminated']).toContain(
            result.damageResult.type,
          );
          expect(result.attackerIds).toEqual(['a1']);
          expect(result.targetId).toBe('t1');
        },
      ),
      { numRuns: 50 },
    );
  });
});
