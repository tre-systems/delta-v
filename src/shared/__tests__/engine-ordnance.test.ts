import { describe, it, expect, beforeEach } from 'vitest';
import { processEmplacement } from '../engine-ordnance';
import { createGame } from '../game-engine';
import { buildSolarSystemMap, SCENARIOS, findBaseHex } from '../map-data';
import { hexKey, hexVecLength } from '../hex';
import { ORBITAL_BASE_MASS } from '../constants';
import type { GameState, SolarSystemMap, Ship } from '../types';

let map: SolarSystemMap;

function createConvoyGame(): GameState {
  return createGame(SCENARIOS.convoy, map, 'TEST', findBaseHex);
}

function makeTransportWithBase(state: GameState, playerId: number, position: { q: number; r: number }, velocity: { dq: number; dr: number }): Ship {
  const ship: Ship = {
    id: `test-transport-${state.ships.length}`,
    type: 'transport',
    owner: playerId,
    position: { ...position },
    velocity: { ...velocity },
    fuel: 10,
    cargoUsed: ORBITAL_BASE_MASS,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    carryingOrbitalBase: true,
    pendingGravityEffects: [],
    damage: { disabledTurns: 0 },
  };
  state.ships.push(ship);
  return ship;
}

beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('processEmplacement', () => {
  it('rejects emplacement outside ordnance phase', () => {
    const state = createConvoyGame();
    state.phase = 'astrogation';
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 0, dr: 0 });
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('rejects emplacement from wrong player', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 0, dr: 0 });
    const result = processEmplacement(state, 1, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('rejects ship not carrying orbital base', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 0, dr: 0 });
    ship.carryingOrbitalBase = false;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('rejects emplacement when ship is not in orbit (speed !== 1)', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    // Place at a gravity hex but with speed 0 (not orbiting)
    const marsGravityHex = { q: -9, r: -6 }; // Mars gravity ring
    const ship = makeTransportWithBase(state, 0, marsGravityHex, { dq: 0, dr: 0 });
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('successfully emplaces orbital base when ship is in orbit (speed 1)', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    // Place at a gravity hex with speed 1 (orbiting)
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, { dq: 1, dr: 0 });
    const shipsBefore = state.ships.length;

    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(false);
    expect(state.ships.length).toBe(shipsBefore + 1);

    const base = state.ships[state.ships.length - 1];
    expect(base.type).toBe('orbitalBase');
    expect(base.owner).toBe(0);
    expect(base.emplaced).toBe(true);
    expect(base.position).toEqual(marsGravityHex);
    expect(base.velocity).toEqual({ dq: 1, dr: 0 });
  });

  it('clears carryingOrbitalBase and reduces cargo after emplacement', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, { dq: 1, dr: 0 });
    ship.cargoUsed = ORBITAL_BASE_MASS + 10;

    processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect(ship.carryingOrbitalBase).toBe(false);
    expect(ship.cargoUsed).toBe(10);
  });

  it('rejects emplacement by a destroyed ship', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 1, dr: 0 });
    ship.destroyed = true;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('rejects emplacement during resupply turn', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 1, dr: 0 });
    ship.resuppliedThisTurn = true;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });

  it('allows emplacement when ship is landed on a world hex', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    // Mars surface hex in gravity field, landed
    const marsGravityHex = { q: -9, r: -6 };
    const ship = makeTransportWithBase(state, 0, marsGravityHex, { dq: 0, dr: 0 });
    ship.landed = true;
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(false);
  });

  it('rejects non-transport/packet ship types', () => {
    const state = createConvoyGame();
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = makeTransportWithBase(state, 0, { q: -9, r: -6 }, { dq: 1, dr: 0 });
    ship.type = 'corvette';
    const result = processEmplacement(state, 0, [{ shipId: ship.id }], map);
    expect('error' in result).toBe(true);
  });
});
