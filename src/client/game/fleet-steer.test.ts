import { describe, expect, it } from 'vitest';

import { HEX_DIRECTIONS, hexAdd, hexKey } from '../../shared/hex';
import { asShipId } from '../../shared/ids';
import type { Ship, SolarSystemMap } from '../../shared/types/domain';
import { chooseSteerBurn, planFleetSteer } from './fleet-steer';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'frigate',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const emptyMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -6, maxQ: 6, minR: -6, maxR: 6 },
};

describe('chooseSteerBurn', () => {
  it('burns toward a distant target (direction 0 is east)', () => {
    const ship = createShip({ position: { q: 0, r: 0 } });
    // Target far to the east; a stationary ship should thrust east (burn 0),
    // landing at (1,0) — closer than drifting in place.
    expect(chooseSteerBurn(ship, { q: 5, r: 0 }, emptyMap, [])).toBe(0);
  });

  it('prefers a free drift when it is already the closest option', () => {
    // Target is the ship's own hex: no burn improves on staying put, and a
    // tie resolves to null (drift) because it is evaluated first.
    const ship = createShip({ position: { q: 0, r: 0 } });
    expect(chooseSteerBurn(ship, { q: 0, r: 0 }, emptyMap, [])).toBeNull();
  });

  it('returns null for a fuelless ship (every burn collapses to drift)', () => {
    // With no fuel, computeCourse ignores the burn, so all candidates yield
    // the same drift course and the tie prefers null.
    const ship = createShip({
      fuel: 0,
      velocity: { dq: 1, dr: 0 },
      position: { q: 0, r: 0 },
    });
    expect(chooseSteerBurn(ship, { q: 5, r: 0 }, emptyMap, [])).toBeNull();
  });

  it('picks the burn that best cancels drift toward the target', () => {
    // Drifting west but target is east: the best single burn is east (0),
    // which nets the ship back toward the target.
    const ship = createShip({
      velocity: { dq: -1, dr: 0 },
      position: { q: 0, r: 0 },
    });
    expect(chooseSteerBurn(ship, { q: 5, r: 0 }, emptyMap, [])).toBe(0);
  });
});

describe('planFleetSteer', () => {
  it('returns one order per ship, preserving ids', () => {
    const ships = [
      createShip({ id: asShipId('a'), position: { q: 0, r: 0 } }),
      createShip({ id: asShipId('b'), position: { q: -2, r: 0 } }),
    ];
    const orders = planFleetSteer(ships, { q: 5, r: 0 }, emptyMap, []);
    expect(orders.map((o) => o.shipId)).toEqual(['a', 'b']);
    // Both should thrust east toward the target.
    expect(orders.every((o) => o.burn === 0)).toBe(true);
  });

  it('omits a ship with no legal non-crash course', () => {
    const ship = createShip({ velocity: { dq: 2, dr: 0 } });
    const driftDestination = { q: 2, r: 0 };
    const crashHexes = [
      driftDestination,
      ...HEX_DIRECTIONS.map((direction) => hexAdd(driftDestination, direction)),
    ];
    const blockedMap: SolarSystemMap = {
      ...emptyMap,
      hexes: new Map(
        crashHexes.map((hex, index) => [
          hexKey(hex),
          {
            terrain: 'planetSurface' as const,
            body: { name: `Body ${index}`, destructive: true },
          },
        ]),
      ),
    };

    expect(planFleetSteer([ship], { q: 5, r: 0 }, blockedMap, [])).toEqual([]);
  });
});

describe('chooseSteerBurn for landed ships', () => {
  it('picks a takeoff burn toward the target for a landed ship', () => {
    // A landed ship can take off; steering should choose a burn (not undefined)
    // that heads it toward the target rather than leaving it on the pad.
    const ship = createShip({
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      position: { q: 0, r: 0 },
    });
    const burn = chooseSteerBurn(ship, { q: 5, r: 0 }, emptyMap, []);
    expect(burn).not.toBeUndefined();
    expect(typeof burn === 'number').toBe(true);
  });
});
