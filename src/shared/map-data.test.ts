import { beforeEach, describe, expect, it } from 'vitest';
import { must } from './assert';
import { hexKey } from './hex';
import {
  bodyHasGravity,
  buildSolarSystemMap,
  findBaseHex,
  findBaseHexes,
  SCENARIOS,
} from './map-data';
import type { SolarSystemMap } from './types';

let map: SolarSystemMap;
beforeEach(() => {
  map = buildSolarSystemMap();
});
describe('buildSolarSystemMap', () => {
  it('produces a non-empty hex map', () => {
    expect(map.hexes.size).toBeGreaterThan(0);
  });
  it('has valid bounds', () => {
    expect(map.bounds.minQ).toBeLessThan(map.bounds.maxQ);
    expect(map.bounds.minR).toBeLessThan(map.bounds.maxR);
  });
  it('includes all expected celestial bodies', () => {
    const names = map.bodies.map((b) => b.name);
    expect(names).toContain('Sol');
    expect(names).toContain('Mercury');
    expect(names).toContain('Venus');
    expect(names).toContain('Terra');
    expect(names).toContain('Luna');
    expect(names).toContain('Mars');
    expect(names).toContain('Ceres');
    expect(names).toContain('Jupiter');
    expect(names).toContain('Io');
    expect(names).toContain('Callisto');
    expect(names).toContain('Ganymede');
    expect(names.length).toBe(11);
  });
  it('uses the official board centers for all named bodies', () => {
    expect(
      Object.fromEntries(map.bodies.map((body) => [body.name, body.center])),
    ).toEqual({
      Sol: { q: -2, r: 2 },
      Mercury: { q: 1, r: 3 },
      Venus: { q: -7, r: 7 },
      Terra: { q: 5, r: -5 },
      Luna: { q: 9, r: -7 },
      Mars: { q: -9, r: -5 },
      Ceres: { q: -7, r: -10 },
      Jupiter: { q: -1, r: -18 },
      Io: { q: -1, r: -15 },
      Callisto: { q: -4, r: -16 },
      Ganymede: { q: 3, r: -21 },
    });
  });
  it('marks Sol surface as destructive', () => {
    const solCenter = must(map.bodies.find((b) => b.name === 'Sol')?.center);
    const hex = must(map.hexes.get(hexKey(solCenter)));
    expect(hex.terrain).toBe('sunSurface');
    expect(hex.body?.destructive).toBe(true);
  });
  it('marks planet surfaces as non-destructive', () => {
    const mars = must(map.bodies.find((b) => b.name === 'Mars'));
    const hex = must(map.hexes.get(hexKey(mars.center)));
    expect(hex.terrain).toBe('planetSurface');
    expect(hex.body?.destructive).toBe(false);
  });
  it('includes asteroid hexes', () => {
    const asteroids = [...map.hexes.entries()].filter(
      ([, h]) => h.terrain === 'asteroid',
    );
    expect(asteroids.length).toBe(64);
    expect(asteroids.map(([key]) => key)).toContain('6,-16');
  });
  it('includes the clandestine base inside the eastern dense field', () => {
    const clandestineHex = must(map.hexes.get(hexKey({ q: 6, r: -16 })));
    expect(clandestineHex.terrain).toBe('asteroid');
    expect(clandestineHex.base).toEqual({
      name: 'Clandestine Base',
      bodyName: 'Clandestine',
    });
  });
});
describe('bodyHasGravity', () => {
  it('returns true for bodies with gravity rings', () => {
    expect(bodyHasGravity('Sol', map)).toBe(true);
    expect(bodyHasGravity('Mercury', map)).toBe(true);
    expect(bodyHasGravity('Venus', map)).toBe(true);
    expect(bodyHasGravity('Terra', map)).toBe(true);
    expect(bodyHasGravity('Mars', map)).toBe(true);
    expect(bodyHasGravity('Jupiter', map)).toBe(true);
  });
  it('returns true for moons with weak gravity', () => {
    expect(bodyHasGravity('Luna', map)).toBe(true);
    expect(bodyHasGravity('Io', map)).toBe(true);
    expect(bodyHasGravity('Callisto', map)).toBe(true);
    expect(bodyHasGravity('Ganymede', map)).toBe(true);
  });
  it('returns false for Ceres (no gravity rings)', () => {
    expect(bodyHasGravity('Ceres', map)).toBe(false);
  });
  it('returns false for non-existent bodies', () => {
    expect(bodyHasGravity('Pluto', map)).toBe(false);
  });
});
describe('findBaseHex / findBaseHexes', () => {
  it('finds bases for Mercury (2 bases)', () => {
    const bases = findBaseHexes(map, 'Mercury');
    expect(bases.length).toBe(2);
  });
  it('finds bases for Venus (6 bases)', () => {
    const bases = findBaseHexes(map, 'Venus');
    expect(bases.length).toBe(6);
  });
  it('finds bases for Terra (6 bases)', () => {
    const bases = findBaseHexes(map, 'Terra');
    expect(bases.length).toBe(6);
  });
  it('finds bases for Luna (6 bases)', () => {
    const bases = findBaseHexes(map, 'Luna');
    expect(bases.length).toBe(6);
  });
  it('finds bases for Mars (6 bases)', () => {
    const bases = findBaseHexes(map, 'Mars');
    expect(bases.length).toBe(6);
  });
  it('finds a single base for Ceres', () => {
    const bases = findBaseHexes(map, 'Ceres');
    expect(bases.length).toBe(1);
  });
  it('finds a single base for Io', () => {
    const bases = findBaseHexes(map, 'Io');
    expect(bases.length).toBe(1);
  });
  it('finds a single base for Callisto', () => {
    const bases = findBaseHexes(map, 'Callisto');
    expect(bases.length).toBe(1);
  });
  it('finds the clandestine base', () => {
    const bases = findBaseHexes(map, 'Clandestine');
    expect(bases).toEqual([{ q: 6, r: -16 }]);
  });
  it('returns no bases for Jupiter (no base directions)', () => {
    const bases = findBaseHexes(map, 'Jupiter');
    expect(bases.length).toBe(0);
  });
  it('returns no bases for Ganymede (no base directions)', () => {
    const bases = findBaseHexes(map, 'Ganymede');
    expect(bases.length).toBe(0);
  });
  it('findBaseHex returns first base or null', () => {
    expect(findBaseHex(map, 'Mars')).not.toBeNull();
    expect(findBaseHex(map, 'Jupiter')).toBeNull();
  });
  it('base hexes are on gravity rings, not surfaces', () => {
    for (const body of ['Venus', 'Terra', 'Mars', 'Mercury']) {
      const bases = findBaseHexes(map, body);
      for (const base of bases) {
        const hex = must(map.hexes.get(hexKey(base)));
        expect(hex.terrain).not.toBe('planetSurface');
        expect(hex.base).toBeDefined();
        expect(hex.base?.bodyName).toBe(body);
      }
    }
  });
});
describe('SCENARIOS', () => {
  it('all scenarios have valid player definitions', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      expect(scenario.players.length).toBeGreaterThanOrEqual(2);
      expect(scenario.name).toBeTruthy();
      expect(scenario.description).toBeTruthy();
    }
  });
  it('biplanetary has 2 corvettes with target bodies', () => {
    const s = SCENARIOS.biplanetary;
    expect(s.players[0].ships.length).toBe(1);
    expect(s.players[0].ships[0].type).toBe('corvette');
    expect(s.players[0].targetBody).toBe('Venus');
    expect(s.players[1].ships.length).toBe(1);
    expect(s.players[1].ships[0].type).toBe('corvette');
    expect(s.players[1].targetBody).toBe('Mars');
  });
  it('escape has 3 transports vs 2 enforcers', () => {
    const s = SCENARIOS.escape;
    expect(s.players[0].ships.length).toBe(3);
    expect(s.players[0].ships.every((sh) => sh.type === 'transport')).toBe(
      true,
    );
    expect(s.players[0].escapeWins).toBe(true);
    expect(s.players[1].ships.length).toBe(2);
    expect(s.rules?.hiddenIdentityInspection).toBe(true);
    expect(s.rules?.escapeEdge).toBe('north');
  });
  it('fleet-building scenarios have startingCredits and empty ship lists', () => {
    for (const name of ['interplanetaryWar', 'fleetAction'] as const) {
      const s = SCENARIOS[name];
      expect(s.startingCredits).toBeDefined();
      expect(s.availableFleetPurchases).toBeDefined();
      expect(s.availableFleetPurchases?.length).toBeGreaterThan(0);
      for (const p of s.players) {
        expect(p.ships.length).toBe(0);
      }
    }
  });
  it('convoy has liner, tanker, and frigate with passenger rescue rules', () => {
    const s = SCENARIOS.convoy;
    const shipTypes = s.players[0].ships.map((sh) => sh.type);
    expect(shipTypes).toContain('liner');
    expect(shipTypes).toContain('tanker');
    expect(shipTypes).toContain('frigate');
    expect(s.rules?.passengerRescueEnabled).toBe(true);
    expect(s.rules?.targetWinRequiresPassengers).toBe(true);
    const liner = s.players[0].ships.find((sh) => sh.type === 'liner');
    expect(liner?.initialPassengers).toBeGreaterThan(0);
  });
  it('evacuation is a minimal passenger-rescue sprint (transport + escort vs corsair)', () => {
    const s = SCENARIOS.evacuation;
    expect(s.players[0].targetBody).toBe('Terra');
    expect(s.players[0].homeBody).toBe('Luna');
    expect(s.rules?.passengerRescueEnabled).toBe(true);
    expect(s.rules?.targetWinRequiresPassengers).toBe(true);
    const t = s.players[0].ships.find((sh) => sh.type === 'transport');
    expect(t?.initialPassengers).toBeGreaterThan(0);
    expect(s.players[0].ships.some((sh) => sh.type === 'corvette')).toBe(true);
    expect(s.players[1].ships[0]?.type).toBe('corsair');
  });
});
