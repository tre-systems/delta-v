import { beforeEach, describe, expect, it } from 'vitest';
import { must } from '../assert';
import { ORBITAL_BASE_MASS } from '../constants';
import { hexKey } from '../hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, PlayerId, Ship, SolarSystemMap } from '../types';
import { createGame } from './game-engine';
import {
  isAsteroidHex,
  processEmplacement,
  queueAsteroidHazards,
  resolvePendingAsteroidHazards,
} from './ordnance';

let map: SolarSystemMap;
const createConvoyGame = (): GameState =>
  createGame(SCENARIOS.convoy, map, 'TEST', findBaseHex);
const makeTransportWithBase = (
  state: GameState,
  playerId: PlayerId,
  position: {
    q: number;
    r: number;
  },
  velocity: {
    dq: number;
    dr: number;
  },
): Ship => {
  const ship: Ship = {
    id: `test-transport-${state.ships.length}`,
    type: 'transport',
    owner: playerId,
    originalOwner: playerId,
    position: { ...position },
    velocity: { ...velocity },
    fuel: 10,
    cargoUsed: ORBITAL_BASE_MASS,
    resuppliedThisTurn: false,
    lifecycle: 'active' as const,
    control: 'own' as const,
    heroismAvailable: false,
    overloadUsed: false,
    nukesLaunchedSinceResupply: 0,
    detected: true,
    baseStatus: 'carryingBase',
    pendingGravityEffects: [],
    damage: { disabledTurns: 0 },
  };
  state.ships.push(ship);
  return ship;
};
beforeEach(() => {
  map = buildSolarSystemMap();
});
const makeTestShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'test-ship',
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 2, dr: 0 },
  fuel: 10,
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
const makeMinimalState = (overrides: Partial<GameState> = {}): GameState =>
  ({
    gameId: 'test',
    scenario: 'biplanetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'combat',
    activePlayer: 0,
    players: [
      {
        connected: false,
        ready: false,
        targetBody: '',
        homeBody: 'Mars',
        bases: [],
        escapeWins: false,
      },
      {
        connected: false,
        ready: false,
        targetBody: '',
        homeBody: 'Venus',
        bases: [],
        escapeWins: false,
      },
    ],
    ships: [],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    winner: null,
    winReason: null,
    ...overrides,
  }) as GameState;
describe('queueAsteroidHazards', () => {
  it('queues hazard when path crosses an asteroid hex', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: -1, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(1);
    expect(state.pendingAsteroidHazards[0].hex).toEqual({
      q: 1,
      r: 0,
    });
  });
  it('does not queue hazard at speed 1 or less', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('does not queue hazard for starting hex', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['0,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('does not queue hazard when path only grazes a single asteroid hex edge', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: -1 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 2, r: -1 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('queues exactly one hazard when path runs between two adjacent asteroid hexes (hexside rule)', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([
        ['1,0', { terrain: 'asteroid' }],
        ['1,-1', { terrain: 'asteroid' }],
      ]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: -1 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 2, r: -1 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(1);
  });
  it('queues multiple hazards for multiple definite asteroid hexes', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([
        ['1,0', { terrain: 'asteroid' }],
        ['2,0', { terrain: 'asteroid' }],
      ]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 3, dr: 0 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(2);
  });
  it('skips destroyed asteroids', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: -1, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    const state = makeMinimalState({
      ships: [ship],
      destroyedAsteroids: ['1,0'],
    });
    const path = [
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('does not double-count the same ambiguous asteroid pair', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([
        ['2,0', { terrain: 'asteroid' }],
        ['2,-1', { terrain: 'asteroid' }],
      ]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = makeTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 4, dr: -2 },
    });
    const state = makeMinimalState({ ships: [ship] });
    const path = [
      { q: 0, r: 0 },
      { q: 4, r: -2 },
    ];
    queueAsteroidHazards(ship, path, ship.velocity, state, asteroidMap);
    // Should be at most 1 hazard for this pair
    const hazardsForPair = state.pendingAsteroidHazards.filter(
      (h) => hexKey(h.hex) === '2,0' || hexKey(h.hex) === '2,-1',
    );
    expect(hazardsForPair.length).toBeLessThanOrEqual(1);
  });
});
describe('resolvePendingAsteroidHazards', () => {
  it('rolls for each hazard and produces combat results', () => {
    const ship = makeTestShip();
    const state = makeMinimalState({
      ships: [ship],
      pendingAsteroidHazards: [
        { shipId: ship.id, hex: { q: 1, r: 0 } },
        { shipId: ship.id, hex: { q: 2, r: 0 } },
      ],
    });
    const results = resolvePendingAsteroidHazards(state, 0, () => 0.5);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.attackType === 'asteroidHazard')).toBe(true);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('skips hazards for other players', () => {
    const ship = makeTestShip({ owner: 1 });
    const state = makeMinimalState({
      ships: [ship],
      pendingAsteroidHazards: [{ shipId: ship.id, hex: { q: 1, r: 0 } }],
    });
    const results = resolvePendingAsteroidHazards(state, 0, Math.random);
    expect(results).toHaveLength(0);
    expect(state.pendingAsteroidHazards).toHaveLength(1);
  });
  it('skips hazards for destroyed ships', () => {
    const ship = makeTestShip({ lifecycle: 'destroyed' });
    const state = makeMinimalState({
      ships: [ship],
      pendingAsteroidHazards: [{ shipId: ship.id, hex: { q: 1, r: 0 } }],
    });
    const results = resolvePendingAsteroidHazards(state, 0, Math.random);
    expect(results).toHaveLength(0);
    expect(state.pendingAsteroidHazards).toHaveLength(0);
  });
});
describe('isAsteroidHex', () => {
  it('returns true for asteroid terrain', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = makeMinimalState();
    expect(isAsteroidHex(state, asteroidMap, { q: 1, r: 0 })).toBe(true);
  });
  it('returns false for destroyed asteroids', () => {
    const asteroidMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = makeMinimalState({
      destroyedAsteroids: ['1,0'],
    });
    expect(isAsteroidHex(state, asteroidMap, { q: 1, r: 0 })).toBe(false);
  });
  it('returns false for non-asteroid terrain', () => {
    const spaceMap: SolarSystemMap = {
      hexes: new Map([['1,0', { terrain: 'space' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = makeMinimalState();
    expect(isAsteroidHex(state, spaceMap, { q: 1, r: 0 })).toBe(false);
  });
  it('returns false for hex not in map', () => {
    const emptyMap: SolarSystemMap = {
      hexes: new Map(),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = makeMinimalState();
    expect(isAsteroidHex(state, emptyMap, { q: 99, r: 99 })).toBe(false);
  });
});
describe('processEmplacement', () => {
  it('rejects emplacement outside ordnance phase', () => {
    const state = createConvoyGame();
    state.phase = 'astrogation';
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 0, dr: 0 },
    );
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('rejects emplacement from wrong player', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 0, dr: 0 },
    );
    const result = processEmplacement(state, 1, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('rejects ship not carrying orbital base', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 0, dr: 0 },
    );
    ship.baseStatus = undefined;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('rejects emplacement when ship is not in orbit (speed !== 1)', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, {
      dq: 0,
      dr: 0,
    });
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('successfully emplaces orbital base when ship is in orbit (speed 1)', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, {
      dq: 1,
      dr: 0,
    });
    const shipsBefore = state.ships.length;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const rs = result.state;
      expect(rs.ships.length).toBe(shipsBefore + 1);
      const base = rs.ships[rs.ships.length - 1];
      expect(base.type).toBe('orbitalBase');
      expect(base.owner).toBe(0);
      expect(base.baseStatus).toBe('emplaced');
      expect(base.position).toEqual(marsGravityHex);
      expect(base.velocity).toEqual({ dq: 1, dr: 0 });
      expect(result.engineEvents).toContainEqual({
        type: 'baseEmplaced',
        shipId: base.id,
        sourceShipId: ship.id,
        owner: 0,
        position: marsGravityHex,
        velocity: { dq: 1, dr: 0 },
      });
    }
  });
  it('clears baseStatus and reduces cargo after emplacement', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, {
      dq: 1,
      dr: 0,
    });
    ship.cargoUsed = ORBITAL_BASE_MASS + 10;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const updated = must(result.state.ships.find((s) => s.id === ship.id));
      expect(updated.baseStatus).toBeUndefined();
      expect(updated.cargoUsed).toBe(10);
    }
  });
  it('rejects emplacement by a destroyed ship', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 1, dr: 0 },
    );
    ship.lifecycle = 'destroyed';
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('rejects emplacement during resupply turn', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 1, dr: 0 },
    );
    ship.resuppliedThisTurn = true;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
  it('allows emplacement when ship is landed on a world hex', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, {
      dq: 0,
      dr: 0,
    });
    ship.lifecycle = 'landed';
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(false);
  });
  it('rejects non-transport/packet ship types', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(
      state,
      0,
      { q: -9, r: -6 },
      { dq: 1, dr: 0 },
    );
    ship.type = 'corvette';
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
});
