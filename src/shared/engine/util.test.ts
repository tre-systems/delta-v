import { describe, expect, it } from 'vitest';

import { asHexKey, HEX_DIRECTIONS } from '../hex';
import { asShipId } from '../ids';
import { buildSolarSystemMap } from '../map-data';
import type { GameState, Ordnance, Ship } from '../types';
import {
  canLaunchOrdnance,
  getAllowedOrdnanceTypes,
  getEscapeEdge,
  getNextOrdnanceId,
  hasAnyEnemyShips,
  hasEscaped,
  hasEscapedNorth,
  hasLaunchableOrdnanceCapacity,
  hasOrdnanceCapacity,
  isOrderableShip,
  isPlanetaryDefenseEnabled,
  playerControlsBase,
  RESUPPLY_ORDNANCE_ERROR,
  shuffle,
  usesEscapeInspectionRules,
  validateOrdnanceLaunch,
  validatePhaseAction,
  validateShipOrdnanceLaunch,
} from './util';

const errorMessage = (
  result: ReturnType<
    typeof validateOrdnanceLaunch | typeof validateShipOrdnanceLaunch
  >,
): string | null => result?.message ?? null;

const bounds = { minQ: -10, maxQ: 10, minR: -10, maxR: 10 };

const defaultTestPlayers: GameState['players'] = [
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: '',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: '',
    bases: [],
    escapeWins: false,
  },
];

const makeScenarioRulesState = (
  scenarioRules: GameState['scenarioRules'] = {},
  pendingAstrogationOrders: GameState['pendingAstrogationOrders'] = null,
  extras?: Partial<Pick<GameState, 'destroyedBases' | 'players'>>,
): Pick<
  GameState,
  'scenarioRules' | 'pendingAstrogationOrders' | 'destroyedBases' | 'players'
> => ({
  scenarioRules,
  pendingAstrogationOrders,
  destroyedBases: extras?.destroyedBases ?? [],
  players: extras?.players ?? defaultTestPlayers,
});

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
  pendingGravityEffects: [],
  damage: { disabledTurns: 0 },
  ...overrides,
});

describe('hasEscaped', () => {
  it('returns false for position inside bounds', () => {
    expect(hasEscaped({ q: 0, r: 0 }, bounds)).toBe(false);
    expect(hasEscaped({ q: 10, r: 10 }, bounds)).toBe(false);
  });

  it('returns false at boundary + margin edge', () => {
    expect(hasEscaped({ q: 13, r: 0 }, bounds)).toBe(false);
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
    expect(
      hasOrdnanceCapacity(makeShip({ type: 'corsair', cargoUsed: 0 })),
    ).toBe(true);
  });

  it('returns false for ship with full cargo', () => {
    expect(
      hasOrdnanceCapacity(makeShip({ type: 'corsair', cargoUsed: 10 })),
    ).toBe(false);
  });

  it('returns false for unknown ship type', () => {
    expect(
      hasOrdnanceCapacity({
        ...makeShip(),
        type: 'unknown',
      } as unknown as Ship),
    ).toBe(false);
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
    const ship = makeShip({
      type: 'orbitalBase',
      cargoUsed: 0,
      fuel: Infinity,
    });

    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['mine']))).toBe(false);
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['torpedo']))).toBe(
      true,
    );
    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['nuke']))).toBe(false);
  });

  it('commercial ships cannot launch torpedoes', () => {
    const ship = makeShip({ type: 'transport', cargoUsed: 0 });

    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['torpedo']))).toBe(
      false,
    );
  });

  it('non-overload ships limited to 1 nuke per resupply', () => {
    const ship = makeShip({
      type: 'packet',
      cargoUsed: 0,
      nukesLaunchedSinceResupply: 1,
    });

    expect(hasLaunchableOrdnanceCapacity(ship, new Set(['nuke']))).toBe(false);
  });

  it('overload ships can launch multiple nukes', () => {
    const ship = makeShip({
      type: 'frigate',
      cargoUsed: 0,
      nukesLaunchedSinceResupply: 3,
    });

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
      ships: [makeShip({ owner: 1, lifecycle: 'destroyed' })],
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
    const result = getAllowedOrdnanceTypes(makeScenarioRulesState());

    expect(result).toEqual(new Set(['mine', 'torpedo', 'nuke']));
  });

  it('returns all types when empty array', () => {
    const result = getAllowedOrdnanceTypes(
      makeScenarioRulesState({ allowedOrdnanceTypes: [] }),
    );

    expect(result).toEqual(new Set(['mine', 'torpedo', 'nuke']));
  });

  it('respects restricted types', () => {
    const result = getAllowedOrdnanceTypes(
      makeScenarioRulesState({ allowedOrdnanceTypes: ['nuke'] }),
    );

    expect(result).toEqual(new Set(['nuke']));
  });
});

describe('validateOrdnanceLaunch', () => {
  it('rejects launches disallowed by the scenario', () => {
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState({ allowedOrdnanceTypes: ['nuke'] }),
        makeShip({ type: 'packet' }),
        'mine',
      ),
    ).toMatchObject({ message: 'This scenario does not allow mine launches' });
  });

  it('rejects launches on a resupply turn', () => {
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState(),
        makeShip({ resuppliedThisTurn: true }),
        'mine',
      ),
    ).toMatchObject({ message: RESUPPLY_ORDNANCE_ERROR });
  });

  it('delegates ship-level validation for otherwise allowed launches', () => {
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState(),
        makeShip({ type: 'transport' }),
        'torpedo',
      ),
    ).toMatchObject({
      message: 'Only warships and orbital bases can launch torpedoes',
    });
  });

  it('rejects mine launch without a committed burn or overload', () => {
    const ship = makeShip({ id: asShipId('s1'), type: 'frigate' });
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState({}, [
          { shipId: asShipId('s1'), burn: null, overload: null },
        ]),
        ship,
        'mine',
      ),
    ).toMatchObject({
      message: 'Ship must change course when launching a mine',
    });
  });

  it('rejects mine launch when overload is set without a burn', () => {
    const ship = makeShip({ id: asShipId('s1'), type: 'frigate' });
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState({}, [
          { shipId: asShipId('s1'), burn: null, overload: 3 },
        ]),
        ship,
        'mine',
      ),
    ).toMatchObject({
      message: 'Ship must change course when launching a mine',
    });
  });

  it('allows mine launch when pending astrogation includes a burn', () => {
    const map = buildSolarSystemMap();
    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState({}, [
          { shipId: asShipId('s1'), burn: 2, overload: null },
        ]),
        makeShip({ id: asShipId('s1'), type: 'frigate' }),
        'mine',
        map,
      ),
    ).toBeNull();
  });

  it('rejects mine launch when resolved movement stays on the launch hex', () => {
    const map = buildSolarSystemMap();
    const dir = HEX_DIRECTIONS[2];
    const ship = makeShip({
      id: asShipId('s1'),
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: -dir.dq, dr: -dir.dr },
    });

    expect(
      validateOrdnanceLaunch(
        makeScenarioRulesState({}, [
          { shipId: asShipId('s1'), burn: 2, overload: null },
        ]),
        ship,
        'mine',
        map,
      ),
    ).toMatchObject({
      message: 'Committed mine launch course must leave this hex',
    });
  });
});

describe('getNextOrdnanceId', () => {
  it('returns 0 for empty ordnance list', () => {
    expect(getNextOrdnanceId({ ordnance: [] })).toBe(0);
  });

  it('returns next sequential id', () => {
    expect(
      getNextOrdnanceId({
        ordnance: [{ id: 'ord0' }, { id: 'ord3' }] as Ordnance[],
      }),
    ).toBe(4);
  });
});

describe('scenario rule predicates', () => {
  it('isPlanetaryDefenseEnabled defaults to true', () => {
    expect(isPlanetaryDefenseEnabled(makeScenarioRulesState())).toBe(true);
  });

  it('isPlanetaryDefenseEnabled returns false when disabled', () => {
    expect(
      isPlanetaryDefenseEnabled(
        makeScenarioRulesState({
          planetaryDefenseEnabled: false,
        }),
      ),
    ).toBe(false);
  });

  it('usesEscapeInspectionRules defaults to false', () => {
    expect(usesEscapeInspectionRules(makeScenarioRulesState())).toBe(false);
  });

  it('usesEscapeInspectionRules returns true when enabled', () => {
    expect(
      usesEscapeInspectionRules(
        makeScenarioRulesState({
          hiddenIdentityInspection: true,
        }),
      ),
    ).toBe(true);
  });

  it('getEscapeEdge defaults to any', () => {
    expect(getEscapeEdge(makeScenarioRulesState())).toBe('any');
  });

  it('getEscapeEdge returns configured edge', () => {
    expect(getEscapeEdge(makeScenarioRulesState({ escapeEdge: 'north' }))).toBe(
      'north',
    );
  });
});

describe('playerControlsBase', () => {
  it('returns true when player owns the base', () => {
    const state = {
      players: [{ bases: ['1,2'] }, { bases: [] }],
    } as unknown as Pick<GameState, 'players'> as GameState;

    expect(playerControlsBase(state, 0, asHexKey('1,2'))).toBe(true);
  });

  it('returns false when player does not own the base', () => {
    const state = {
      players: [{ bases: [] }, { bases: ['1,2'] }],
    } as unknown as Pick<GameState, 'players'> as GameState;

    expect(playerControlsBase(state, 0, asHexKey('1,2'))).toBe(false);
  });
});

describe('validatePhaseAction', () => {
  const state = {
    phase: 'astrogation',
    activePlayer: 0,
  } as GameState;

  it('returns null when phase and player match', () => {
    expect(validatePhaseAction(state, 0, 'astrogation')).toBeNull();
  });

  it('returns error when phase does not match', () => {
    expect(validatePhaseAction(state, 0, 'combat')?.message).toBe(
      'Not in combat phase',
    );
  });

  it('returns error when player is not active', () => {
    expect(validatePhaseAction(state, 1, 'astrogation')?.message).toBe(
      'Not your turn',
    );
  });

  it('checks phase before player', () => {
    expect(validatePhaseAction(state, 1, 'ordnance')?.message).toBe(
      'Not in ordnance phase',
    );
  });
});

describe('validateShipOrdnanceLaunch', () => {
  it('allows a healthy warship to launch any type', () => {
    const ship = makeShip({ type: 'frigate' });

    expect(validateShipOrdnanceLaunch(ship, 'mine')).toBeNull();
    expect(validateShipOrdnanceLaunch(ship, 'torpedo')).toBeNull();
    expect(validateShipOrdnanceLaunch(ship, 'nuke')).toBeNull();
  });

  it('rejects destroyed ships', () => {
    const ship = makeShip({ lifecycle: 'destroyed' });

    expect(validateShipOrdnanceLaunch(ship, 'mine')).toMatchObject({
      message: 'Ship is destroyed',
    });
  });

  it('rejects landed ships', () => {
    const ship = makeShip({ lifecycle: 'landed' });

    expect(validateShipOrdnanceLaunch(ship, 'mine')).toMatchObject({
      message: 'Cannot launch ordnance while landed',
    });
  });

  it('rejects captured ships', () => {
    const ship = makeShip({ control: 'captured' });

    expect(validateShipOrdnanceLaunch(ship, 'mine')).toMatchObject({
      message: 'Captured ships cannot launch ordnance',
    });
  });

  it('rejects disabled ships', () => {
    const ship = makeShip({ damage: { disabledTurns: 2 } });

    expect(validateShipOrdnanceLaunch(ship, 'mine')).toMatchObject({
      message: 'Ship is disabled',
    });
  });

  it('allows orbital bases at D1 damage', () => {
    const ship = makeShip({
      type: 'orbitalBase',
      damage: { disabledTurns: 1 },
    });

    expect(validateShipOrdnanceLaunch(ship, 'torpedo')).toBeNull();
  });

  it('rejects orbital bases at D2+ damage', () => {
    const ship = makeShip({
      type: 'orbitalBase',
      damage: { disabledTurns: 2 },
    });

    expect(validateShipOrdnanceLaunch(ship, 'torpedo')).toMatchObject({
      message: 'Ship is disabled',
    });
  });

  it('orbital bases can only launch torpedoes', () => {
    const ship = makeShip({ type: 'orbitalBase' });

    expect(validateShipOrdnanceLaunch(ship, 'torpedo')).toBeNull();
    expect(validateShipOrdnanceLaunch(ship, 'mine')).toMatchObject({
      message: 'Orbital bases can only launch torpedoes',
    });
    expect(validateShipOrdnanceLaunch(ship, 'nuke')).toMatchObject({
      message: 'Orbital bases can only launch torpedoes',
    });
  });

  it('non-warships cannot launch torpedoes', () => {
    const ship = makeShip({ type: 'packet' });

    expect(validateShipOrdnanceLaunch(ship, 'torpedo')).toMatchObject({
      message: 'Only warships and orbital bases can launch torpedoes',
    });
  });

  it('non-warships limited to one nuke between resupplies', () => {
    const ship = makeShip({
      type: 'packet',
      nukesLaunchedSinceResupply: 1,
    });

    expect(validateShipOrdnanceLaunch(ship, 'nuke')).toMatchObject({
      message: 'Non-warships may launch only one nuke between resupplies',
    });
  });

  it('non-warships can launch first nuke', () => {
    const ship = makeShip({ type: 'packet' });

    expect(validateShipOrdnanceLaunch(ship, 'nuke')).toBeNull();
  });

  it('rejects when cargo is full', () => {
    const ship = makeShip({
      type: 'corsair',
      cargoUsed: 10,
    });

    expect(errorMessage(validateShipOrdnanceLaunch(ship, 'mine'))).toMatch(
      /Not enough cargo/,
    );
  });
});

describe('canLaunchOrdnance', () => {
  it('returns true for healthy ship with cargo', () => {
    expect(canLaunchOrdnance(makeShip({ type: 'corsair' }))).toBe(true);
  });

  it('returns false for destroyed ship', () => {
    expect(
      canLaunchOrdnance(makeShip({ type: 'corsair', lifecycle: 'destroyed' })),
    ).toBe(false);
  });

  it('returns false for landed ship', () => {
    expect(
      canLaunchOrdnance(makeShip({ type: 'corsair', lifecycle: 'landed' })),
    ).toBe(false);
  });

  it('returns false for captured ship', () => {
    expect(
      canLaunchOrdnance(makeShip({ type: 'corsair', control: 'captured' })),
    ).toBe(false);
  });

  it('returns false for disabled ship', () => {
    expect(
      canLaunchOrdnance(
        makeShip({
          type: 'corsair',
          damage: { disabledTurns: 1 },
        }),
      ),
    ).toBe(false);
  });

  it('returns true for orbital base at D1', () => {
    expect(
      canLaunchOrdnance(
        makeShip({
          type: 'orbitalBase',
          damage: { disabledTurns: 1 },
        }),
      ),
    ).toBe(true);
  });

  it('returns false for full cargo', () => {
    expect(
      canLaunchOrdnance(makeShip({ type: 'corsair', cargoUsed: 10 })),
    ).toBe(false);
  });
});

describe('isOrderableShip', () => {
  it('returns true for operational ships', () => {
    expect(isOrderableShip(makeShip())).toBe(true);
  });

  it('returns false for destroyed ships', () => {
    expect(isOrderableShip(makeShip({ lifecycle: 'destroyed' }))).toBe(false);
  });

  it('returns false for emplaced orbital bases', () => {
    expect(isOrderableShip(makeShip({ baseStatus: 'emplaced' }))).toBe(false);
  });

  it('returns false for captured ships', () => {
    expect(isOrderableShip(makeShip({ control: 'captured' }))).toBe(false);
  });

  it('returns true for disabled ships', () => {
    expect(isOrderableShip(makeShip({ damage: { disabledTurns: 2 } }))).toBe(
      true,
    );
  });

  it('returns true for surrendered ships', () => {
    expect(isOrderableShip(makeShip({ control: 'surrendered' }))).toBe(true);
  });
});
