import { describe, expect, it } from 'vitest';

import {
  DAMAGE_ELIMINATION_THRESHOLD,
  ORBITAL_BASE_MASS,
  ORDNANCE_LIFETIME,
  ORDNANCE_MASS,
  SHIP_STATS,
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
    ]) {
      expect(SHIP_STATS[type].canOverload, `${type} canOverload`).toBe(true);
    }
  });

  it('commercial ships cannot overload', () => {
    for (const type of ['transport', 'packet', 'tanker']) {
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
    const warships = ['corvette', 'corsair', 'frigate', 'dreadnaught'].map(
      (t) => SHIP_STATS[t],
    );

    for (let i = 1; i < warships.length; i++) {
      expect(warships[i].combat).toBeGreaterThan(warships[i - 1].combat);
      expect(warships[i].cost).toBeGreaterThan(warships[i - 1].cost);
    }
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
  it('ORDNANCE_LIFETIME is positive', () => {
    expect(ORDNANCE_LIFETIME).toBeGreaterThan(0);
  });

  it('ORBITAL_BASE_MASS is positive', () => {
    expect(ORBITAL_BASE_MASS).toBeGreaterThan(0);
  });

  it('DAMAGE_ELIMINATION_THRESHOLD is positive', () => {
    expect(DAMAGE_ELIMINATION_THRESHOLD).toBeGreaterThan(0);
  });
});
