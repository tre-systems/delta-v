import { describe, expect, it } from 'vitest';
import { asShipId } from './ids';
import {
  createTestOrdnance,
  createTestShip,
  createTestState,
} from './test-helpers';

describe('createTestShip', () => {
  it('returns a valid ship with defaults', () => {
    const ship = createTestShip();
    expect(ship.id).toBe('test-ship');
    expect(ship.type).toBe('corvette');
    expect(ship.owner).toBe(0);
    expect(ship.lifecycle).toBe('active');
    expect(ship.fuel).toBe(20);
    expect(ship.damage.disabledTurns).toBe(0);
  });

  it('applies top-level overrides', () => {
    const ship = createTestShip({
      id: asShipId('custom'),
      type: 'frigate',
      fuel: 5,
    });
    expect(ship.id).toBe('custom');
    expect(ship.type).toBe('frigate');
    expect(ship.fuel).toBe(5);
    // Non-overridden fields keep their defaults
    expect(ship.owner).toBe(0);
  });

  it('merges the damage sub-object', () => {
    const ship = createTestShip({ damage: { disabledTurns: 3 } });
    expect(ship.damage.disabledTurns).toBe(3);
  });

  it('supports position and velocity overrides', () => {
    const ship = createTestShip({
      position: { q: 5, r: -3 },
      velocity: { dq: 1, dr: 2 },
    });
    expect(ship.position).toEqual({ q: 5, r: -3 });
    expect(ship.velocity).toEqual({ dq: 1, dr: 2 });
  });
});

describe('createTestOrdnance', () => {
  it('returns a valid ordnance with defaults', () => {
    const ord = createTestOrdnance();
    expect(ord.id).toBe('test-ordnance');
    expect(ord.type).toBe('nuke');
    expect(ord.lifecycle).toBe('active');
    expect(ord.turnsRemaining).toBe(3);
  });

  it('applies overrides', () => {
    const ord = createTestOrdnance({ type: 'mine', turnsRemaining: 1 });
    expect(ord.type).toBe('mine');
    expect(ord.turnsRemaining).toBe(1);
  });
});

describe('createTestState', () => {
  it('returns a valid game state with defaults', () => {
    const state = createTestState();
    expect(state.gameId).toBe('TEST');
    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('combat');
    expect(state.ships).toHaveLength(1);
    expect(state.ordnance).toEqual([]);
    expect(state.outcome).toBeNull();
    expect(state.players).toHaveLength(2);
    expect(state.players[0].connected).toBe(true);
    expect(state.players[1].connected).toBe(true);
  });

  it('applies top-level overrides', () => {
    const ships = [
      createTestShip({ id: asShipId('a') }),
      createTestShip({ id: asShipId('b'), owner: 1 }),
    ];
    const state = createTestState({
      turnNumber: 5,
      phase: 'astrogation',
      ships,
    });
    expect(state.turnNumber).toBe(5);
    expect(state.phase).toBe('astrogation');
    expect(state.ships).toHaveLength(2);
  });

  it('merges player overrides without losing defaults', () => {
    const state = createTestState({
      players: [{ credits: 100 }, { targetBody: 'Earth' }],
    });
    expect(state.players[0].credits).toBe(100);
    expect(state.players[0].connected).toBe(true); // default preserved
    expect(state.players[1].targetBody).toBe('Earth');
    expect(state.players[1].connected).toBe(true); // default preserved
  });

  it('works with no arguments', () => {
    const state = createTestState();
    expect(state.players[0].targetBody).toBe('Mars');
    expect(state.players[1].targetBody).toBe('Venus');
  });
});
