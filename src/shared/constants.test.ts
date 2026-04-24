import { describe, expect, it } from 'vitest';

import {
  ANTI_NUKE_ODDS,
  BASE_COMBAT_ODDS,
  BURN_FUEL_COST,
  DAMAGE_ELIMINATION_THRESHOLD,
  LANDING_SPEED_REQUIRED,
  ORBITAL_BASE_MASS,
  ORDNANCE_LIFETIME,
  ORDNANCE_MASS,
  OVERLOAD_TOTAL_FUEL_COST,
  SHIP_STATS,
  type ShipType,
  VELOCITY_MODIFIER_THRESHOLD,
} from './constants';

describe('SHIP_STATS', () => {
  it('has all expected ship types', () => {
    const types = Object.keys(SHIP_STATS);

    expect(types).toContain('transport');
    expect(types).toContain('packet');
    expect(types).toContain('tanker');
    expect(types).toContain('corvette');
    expect(types).toContain('corsair');
    expect(types).toContain('frigate');
    expect(types).toContain('dreadnaught');
    expect(types).toContain('torch');
    expect(types).toContain('orbitalBase');
  });

  it('has no negative combat values', () => {
    for (const [type, stats] of Object.entries(SHIP_STATS)) {
      expect(stats.combat, `${type} combat`).toBeGreaterThanOrEqual(0);
    }
  });

  it('has no negative fuel values', () => {
    for (const [type, stats] of Object.entries(SHIP_STATS)) {
      expect(stats.fuel, `${type} fuel`).toBeGreaterThan(0);
    }
  });

  it('has no negative cargo values', () => {
    for (const [type, stats] of Object.entries(SHIP_STATS)) {
      expect(stats.cargo, `${type} cargo`).toBeGreaterThanOrEqual(0);
    }
  });

  it('has positive cost for all ship types', () => {
    for (const [type, stats] of Object.entries(SHIP_STATS)) {
      expect(stats.cost, `${type} cost`).toBeGreaterThan(0);
    }
  });

  it('warships can overload', () => {
    for (const type of [
      'corvette',
      'corsair',
      'frigate',
      'dreadnaught',
      'torch',
    ] as ShipType[]) {
      expect(SHIP_STATS[type].canOverload, `${type} canOverload`).toBe(true);
    }
  });

  it('commercial ships cannot overload', () => {
    for (const type of ['transport', 'packet', 'tanker'] as ShipType[]) {
      expect(SHIP_STATS[type].canOverload, `${type} canOverload`).toBe(false);
    }
  });

  it('defensive-only ships have low combat ratings', () => {
    for (const [type, stats] of Object.entries(SHIP_STATS)) {
      if (stats.defensiveOnly) {
        expect(stats.combat, `${type} combat`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('warship combat strength scales with cost', () => {
    const warships = (
      ['corvette', 'corsair', 'frigate', 'dreadnaught'] as ShipType[]
    ).map((t) => SHIP_STATS[t]);

    for (let i = 1; i < warships.length; i++) {
      expect(warships[i].combat).toBeGreaterThan(warships[i - 1].combat);
      expect(warships[i].cost).toBeGreaterThan(warships[i - 1].cost);
    }
  });

  it('pins rulebook ship combat, fuel, and cargo values', () => {
    expect(
      Object.fromEntries(
        (
          Object.entries(SHIP_STATS) as [
            ShipType,
            (typeof SHIP_STATS)[ShipType],
          ][]
        ).map(([type, stats]) => [
          type,
          {
            cargo: stats.cargo,
            combat: stats.combat,
            defensiveOnly: stats.defensiveOnly,
            fuel: stats.fuel,
          },
        ]),
      ),
    ).toEqual({
      transport: { combat: 1, defensiveOnly: true, fuel: 10, cargo: 50 },
      packet: { combat: 2, defensiveOnly: false, fuel: 10, cargo: 50 },
      tanker: { combat: 1, defensiveOnly: true, fuel: 50, cargo: 0 },
      liner: { combat: 2, defensiveOnly: true, fuel: 10, cargo: 0 },
      corvette: { combat: 2, defensiveOnly: false, fuel: 20, cargo: 5 },
      corsair: { combat: 4, defensiveOnly: false, fuel: 20, cargo: 10 },
      frigate: { combat: 8, defensiveOnly: false, fuel: 20, cargo: 40 },
      dreadnaught: { combat: 15, defensiveOnly: false, fuel: 15, cargo: 50 },
      torch: {
        combat: 8,
        defensiveOnly: false,
        fuel: Infinity,
        cargo: 10,
      },
      orbitalBase: {
        combat: 16,
        defensiveOnly: false,
        fuel: Infinity,
        cargo: Infinity,
      },
    });
  });
});

describe('ORDNANCE_MASS', () => {
  it('has all ordnance types', () => {
    expect(ORDNANCE_MASS).toHaveProperty('mine');
    expect(ORDNANCE_MASS).toHaveProperty('torpedo');
    expect(ORDNANCE_MASS).toHaveProperty('nuke');
  });

  it('all masses are positive', () => {
    for (const [type, mass] of Object.entries(ORDNANCE_MASS)) {
      expect(mass, `${type} mass`).toBeGreaterThan(0);
    }
  });

  it('mines are lighter than torpedoes and nukes', () => {
    expect(ORDNANCE_MASS.mine).toBeLessThanOrEqual(ORDNANCE_MASS.torpedo);
    expect(ORDNANCE_MASS.mine).toBeLessThanOrEqual(ORDNANCE_MASS.nuke);
  });
});

describe('game constants', () => {
  it('pins ordnance lifetime to the rulebook self-destruct window', () => {
    expect(ORDNANCE_LIFETIME).toBe(5);
  });

  it('pins disabled-turn destruction to D6', () => {
    expect(DAMAGE_ELIMINATION_THRESHOLD).toBe(6);
  });

  it('pins combat odds and velocity modifiers from the rulebook', () => {
    expect(VELOCITY_MODIFIER_THRESHOLD).toBe(2);
    expect(BASE_COMBAT_ODDS).toBe('2:1');
    expect(ANTI_NUKE_ODDS).toBe('2:1');
  });

  it('pins movement fuel and landing costs from the rulebook', () => {
    expect(BURN_FUEL_COST).toBe(1);
    expect(OVERLOAD_TOTAL_FUEL_COST).toBe(2);
    expect(LANDING_SPEED_REQUIRED).toBe(1);
  });

  it('pins equipment cargo masses from the rulebook', () => {
    expect(ORDNANCE_MASS).toEqual({
      mine: 10,
      torpedo: 20,
      nuke: 20,
    });
    expect(ORBITAL_BASE_MASS).toBe(50);
  });

  it('ORBITAL_BASE_MASS is positive', () => {
    expect(ORBITAL_BASE_MASS).toBeGreaterThan(0);
  });
});
