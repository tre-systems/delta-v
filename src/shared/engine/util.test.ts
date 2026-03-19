import { describe, expect, it } from 'vitest';
import type { GameState, Ordnance, Ship } from '../types';
import {
  getAllowedOrdnanceTypes,
  getEscapeEdge,
  getNextOrdnanceId,
  hasAnyEnemyShips,
  hasEscaped,
  hasEscapedNorth,
  hasLaunchableOrdnanceCapacity,
  hasOrdnanceCapacity,
  isPlanetaryDefenseEnabled,
  playerControlsBase,
  shuffle,
  usesEscapeInspectionRules,
} from './util';

const bounds = { minQ: -10, maxQ: 10, minR: -10, maxR: 10 };

function makeShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'test',
    type: 'corvette',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 20,
    cargoUsed: 0,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    pendingGravityEffects: [],
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

describe('hasEscaped', () => {
  it('returns false for position inside bounds', () => {
    expect(hasEscaped({ q: 0, r: 0 }, bounds)).toBe(false);
    expect(hasEscaped({ q: 10, r: 10 }, bounds)).toBe(false);
  });

  it('returns false at boundary + margin edge', () => {
    expect(hasEscaped({ q: 13, r: 0 }, bounds)).toBe(false); // exactly at margin
  });

  it('returns true beyond q+ boundary', () => {
    expect(hasEscaped({ q: 14, r: 0 }, bounds)).toBe(true);
  });

  it('returns true beyond q- boundary', () => {
    expect(hasEscaped({ q: -14, r: 0 }, bounds)).toBe(true);
  });

  it('returns true beyond r+ boundary', () => {
    expect(hasEscaped({ q: 0, r: 14 }, bounds)).toBe(true);
  });

  it('returns true beyond r- boundary', () => {
    expect(hasEscaped({ q: 0, r: -14 }, bounds)).toBe(true);
  });
});

describe('hasEscapedNorth', () => {
  it('returns false for position inside bounds', () => {
    expect(hasEscapedNorth({ q: 0, r: 0 }, bounds)).toBe(false);
  });

  it('returns false at north edge + margin', () => {
    expect(hasEscapedNorth({ q: 0, r: -13 }, bounds)).toBe(false);
  });

  it('returns true beyond north boundary', () => {
    expect(hasEscapedNorth({ q: 0, r: -14 }, bounds)).toBe(true);
  });

  it('returns false beyond south boundary (north-only escape)', () => {
    expect(hasEscapedNorth({ q: 0, r: 14 }, bounds)).toBe(false);
  });
});

describe('hasOrdnanceCapacity', () => {
  it('returns true for ship with enough cargo space', () => {
    expect(hasOrdnanceCapacity(makeShip({ type: 'corsair', cargoUsed: 0 }))).toBe(true);
  });

  it('returns false for ship with full cargo', () => {
    expect(hasOrdnanceCapacity(makeShip({ type: 'corsair', cargoUsed: 10 }))).toBe(false);
  });

  it('returns false for unknown ship type', () => {
    expect(hasOrdnanceCapacity(makeShip({ type: 'unknown' as any }))).toBe(false);
  });
});

describe('hasLaunchableOrdnanceCapacity', () => {
  it('returns true for warship with mines allowed', () => {
    const ship = makeShip({ type: 'corsair', cargoUsed: 0 });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['mine']))).toBe(true);
  });

  it('returns false when cargo is full', () => {
    const ship = makeShip({ type: 'corsair', cargoUsed: 10 });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['mine']))).toBe(false);
  });

  it('orbital base can only launch torpedoes', () => {
    const ship = makeShip({ type: 'orbitalBase', cargoUsed: 0, fuel: Infinity });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['mine']))).toBe(false);
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['torpedo']))).toBe(true);
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['nuke']))).toBe(false);
  });

  it('commercial ships cannot launch torpedoes', () => {
    const ship = makeShip({ type: 'transport', cargoUsed: 0 });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['torpedo']))).toBe(false);
  });

  it('non-overload ships limited to 1 nuke per resupply', () => {
    const ship = makeShip({ type: 'packet', cargoUsed: 0, nukesLaunchedSinceResupply: 1 });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['nuke']))).toBe(false);
  });

  it('overload ships can launch multiple nukes', () => {
    const ship = makeShip({ type: 'frigate', cargoUsed: 0, nukesLaunchedSinceResupply: 3 });
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['nuke']))).toBe(true);
  });
});

describe('hasAnyEnemyShips', () => {
  it('returns true when enemy ships exist', () => {
    const state = {
      activePlayer: 0,
      ships: [makeShip({ owner: 1 })],
    } as GameState;
    expect(hasAnyEnemyShips(state)).toBe(true);
  });

  it('returns false when all enemies are destroyed', () => {
    const state = {
      activePlayer: 0,
      ships: [makeShip({ owner: 1, destroyed: true })],
    } as GameState;
    expect(hasAnyEnemyShips(state)).toBe(false);
  });

  it('returns false when no enemy ships', () => {
    const state = {
      activePlayer: 0,
      ships: [makeShip({ owner: 0 })],
    } as GameState;
    expect(hasAnyEnemyShips(state)).toBe(false);
  });
});

describe('shuffle', () => {
  it('returns same length array', () => {
    const result = shuffle([1, 2, 3, 4, 5], Math.random);
    expect(result.length).toBe(5);
  });

  it('contains same elements', () => {
    const result = shuffle([1, 2, 3, 4, 5], Math.random);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses provided rng', () => {
    let callCount = 0;
    const rng = () => {
      callCount++;
      return 0.5;
    };
    shuffle([1, 2, 3], rng);
    expect(callCount).toBeGreaterThan(0);
  });

  it('handles empty array', () => {
    expect(shuffle([], Math.random)).toEqual([]);
  });

  it('handles single element', () => {
    expect(shuffle([42], Math.random)).toEqual([42]);
  });
});

describe('getAllowedOrdnanceTypes', () => {
  it('returns all types when no restriction', () => {
    const result = getAllowedOrdnanceTypes({ scenarioRules: {} as any });
    expect(result).toEqual(new Set(['mine', 'torpedo', 'nuke']));
  });

  it('returns all types when empty array', () => {
    const result = getAllowedOrdnanceTypes({ scenarioRules: { allowedOrdnanceTypes: [] } as any });
    expect(result).toEqual(new Set(['mine', 'torpedo', 'nuke']));
  });

  it('respects restricted types', () => {
    const result = getAllowedOrdnanceTypes({ scenarioRules: { allowedOrdnanceTypes: ['nuke'] } as any });
    expect(result).toEqual(new Set(['nuke']));
  });
});

describe('getNextOrdnanceId', () => {
  it('returns 0 for empty ordnance list', () => {
    expect(getNextOrdnanceId({ ordnance: [] })).toBe(0);
  });

  it('returns next sequential id', () => {
    expect(getNextOrdnanceId({ ordnance: [{ id: 'ord0' }, { id: 'ord3' }] as Ordnance[] })).toBe(4);
  });
});

describe('scenario rule predicates', () => {
  it('isPlanetaryDefenseEnabled defaults to true', () => {
    expect(isPlanetaryDefenseEnabled({ scenarioRules: {} as any })).toBe(true);
  });

  it('isPlanetaryDefenseEnabled returns false when disabled', () => {
    expect(isPlanetaryDefenseEnabled({ scenarioRules: { planetaryDefenseEnabled: false } as any })).toBe(false);
  });

  it('usesEscapeInspectionRules defaults to false', () => {
    expect(usesEscapeInspectionRules({ scenarioRules: {} as any })).toBe(false);
  });

  it('usesEscapeInspectionRules returns true when enabled', () => {
    expect(usesEscapeInspectionRules({ scenarioRules: { hiddenIdentityInspection: true } as any })).toBe(true);
  });

  it('getEscapeEdge defaults to any', () => {
    expect(getEscapeEdge({ scenarioRules: {} as any })).toBe('any');
  });

  it('getEscapeEdge returns configured edge', () => {
    expect(getEscapeEdge({ scenarioRules: { escapeEdge: 'north' } as any })).toBe('north');
  });
});

describe('playerControlsBase', () => {
  it('returns true when player owns the base', () => {
    const state = { players: [{ bases: ['1,2'] }, { bases: [] }] } as any;
    expect(playerControlsBase(state, 0, '1,2')).toBe(true);
  });

  it('returns false when player does not own the base', () => {
    const state = { players: [{ bases: [] }, { bases: ['1,2'] }] } as any;
    expect(playerControlsBase(state, 0, '1,2')).toBe(false);
  });
});
