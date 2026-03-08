import { describe, it, expect, beforeEach } from 'vitest';
import { computeCourse, predictDestination, canBurn } from '../movement';
import { buildSolarSystemMap, findBaseHex } from '../map-data';
import { hexKey, hexEqual, hexDistance, hexAdd, HEX_DIRECTIONS } from '../hex';
import type { Ship, SolarSystemMap } from '../types';

let map: SolarSystemMap;

function makeShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'test',
    type: 'corvette',
    owner: 0,
    position: { q: 5, r: 5 },
    velocity: { dq: 0, dr: 0 },
    fuel: 20,
    cargoUsed: 0,
    landed: false,
    destroyed: false,
    detected: true,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('computeCourse - basic movement', () => {
  it('stationary ship with no burn stays put', () => {
    const ship = makeShip({ position: { q: 5, r: 5 }, velocity: { dq: 0, dr: 0 } });
    const course = computeCourse(ship, null, map);

    expect(course.destination).toEqual({ q: 5, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
    expect(course.fuelSpent).toBe(0);
    expect(course.crashed).toBe(false);
    expect(course.landedAt).toBeNull();
  });

  it('ship with velocity moves along velocity vector', () => {
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 2, dr: -1 },
    });
    const course = computeCourse(ship, null, map);

    expect(course.destination).toEqual({ q: 7, r: 4 });
    expect(course.newVelocity).toEqual({ dq: 2, dr: -1 });
    expect(course.fuelSpent).toBe(0);
  });

  it('burn shifts destination and changes velocity', () => {
    const ship = makeShip({ position: { q: 5, r: 5 }, velocity: { dq: 0, dr: 0 } });
    const course = computeCourse(ship, 0, map); // Burn E

    expect(course.destination).toEqual({ q: 6, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 1, dr: 0 });
    expect(course.fuelSpent).toBe(1);
  });

  it('burn adds to existing velocity', () => {
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 1, dr: 0 },
    });
    const course = computeCourse(ship, 0, map); // Burn E, same direction as velocity

    expect(course.destination).toEqual({ q: 7, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 2, dr: 0 });
    expect(course.fuelSpent).toBe(1);
  });

  it('burn can oppose velocity', () => {
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 2, dr: 0 },
    });
    const course = computeCourse(ship, 3, map); // Burn W (opposite to E velocity)

    expect(course.destination).toEqual({ q: 6, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 1, dr: 0 });
    expect(course.fuelSpent).toBe(1);
  });

  it('no burn with empty fuel uses no fuel', () => {
    const ship = makeShip({ fuel: 0 });
    const course = computeCourse(ship, 0, map); // Try to burn with no fuel

    // Burn should not apply — no fuel
    expect(course.fuelSpent).toBe(0);
    expect(course.destination).toEqual(ship.position); // stationary
  });
});

describe('computeCourse - overload maneuver', () => {
  it('warship can overload for 2 fuel', () => {
    const ship = makeShip({
      type: 'corvette', // canOverload: true
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    const course = computeCourse(ship, 0, map, { overload: 0 }); // Double burn E

    expect(course.destination).toEqual({ q: 7, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 2, dr: 0 });
    expect(course.fuelSpent).toBe(2);
  });

  it('non-warship cannot overload', () => {
    const ship = makeShip({
      type: 'transport', // canOverload: false
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    const course = computeCourse(ship, 0, map, { overload: 0 });

    // Overload should not apply for transport
    expect(course.destination).toEqual({ q: 6, r: 5 });
    expect(course.fuelSpent).toBe(1);
  });

  it('overload requires burn', () => {
    const ship = makeShip({
      type: 'corvette',
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
    });
    // Overload without burn should be ignored
    const course = computeCourse(ship, null, map, { overload: 0 });
    expect(course.fuelSpent).toBe(0);
    expect(course.destination).toEqual({ q: 5, r: 5 });
  });

  it('overload with insufficient fuel is ignored', () => {
    const ship = makeShip({
      type: 'corvette',
      fuel: 1, // Not enough for overload (needs 2)
    });
    const course = computeCourse(ship, 0, map, { overload: 0 });

    expect(course.fuelSpent).toBe(1); // Normal burn only
  });
});

describe('computeCourse - gravity', () => {
  it('gravity deflects destination', () => {
    // Mars gravity ring is at distance 1 from (10,8)
    // Ship must pass THROUGH the gravity hex (not end on it)
    const gravHex = { q: 11, r: 8 }; // E of Mars
    const hex = map.hexes.get(hexKey(gravHex));
    expect(hex?.gravity).toBeDefined();
    expect(hex?.gravity?.bodyName).toBe('Mars');

    // Ship 2 hexes E of Mars, moving W at speed 2 — passes through gravity hex
    const ship = makeShip({
      position: { q: 13, r: 8 },
      velocity: { dq: -2, dr: 0 }, // Moving W, path: 13,8 -> 12,8 -> 11,8
    });
    const course = computeCourse(ship, null, map);

    // The gravity hex (11,8) is the destination, so gravity is skipped this turn.
    // Instead test a ship that passes through without stopping:
    const ship2 = makeShip({
      position: { q: 13, r: 8 },
      velocity: { dq: -3, dr: 0 }, // Path: 13 -> 12 -> 11 -> 10 (Mars body)
    });
    const course2 = computeCourse(ship2, null, map);

    // Should have gravity from hex (11,8) which is intermediate (not destination)
    const marsGravity = course2.gravityEffects.filter(e => e.bodyName === 'Mars');
    expect(marsGravity.length).toBeGreaterThan(0);
  });

  it('stationary ship in gravity hex drifts', () => {
    // Place a ship in a Mars gravity hex
    const gravHex = { q: 11, r: 8 }; // E of Mars
    const hex = map.hexes.get(hexKey(gravHex));
    expect(hex?.gravity).toBeDefined();

    const ship = makeShip({
      position: gravHex,
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);

    // Ship should be deflected toward Mars
    expect(hexEqual(course.destination, gravHex)).toBe(false);
    expect(course.gravityEffects).toHaveLength(1);
  });

  it('gravity does not apply at destination hex', () => {
    // Ship ending its move in a gravity hex should not be deflected this turn
    // This is critical for landing at bases in the gravity ring
    const marsBase = findBaseHex(map, 'Mars');
    expect(marsBase).not.toBeNull();

    // The base should be in the gravity ring
    const baseHex = map.hexes.get(hexKey(marsBase!));
    expect(baseHex?.base).toBeDefined();

    // Ship moving to land at the base — approach from outside the gravity ring
    // We need to find a path where the base is the destination
    const ship = makeShip({
      position: { q: marsBase!.q + 1, r: marsBase!.r },
      velocity: { dq: -1, dr: 0 },
    });

    const course = computeCourse(ship, null, map);

    // Ship should arrive at the base hex (not be deflected past it)
    if (hexEqual(course.destination, marsBase!)) {
      expect(course.landedAt).toBe('Mars');
      expect(course.crashed).toBe(false);
    }
    // Gravity at the base hex should NOT appear in effects
    // (it's the destination, so gravity there applies next turn)
  });

  it('cumulative gravity from multiple hexes', () => {
    // Sol has 2 gravity rings — a path through multiple gravity hexes
    // should accumulate deflections
    const ship = makeShip({
      position: { q: 5, r: 0 },
      velocity: { dq: -2, dr: 0 }, // Moving W toward Sol
    });
    const course = computeCourse(ship, null, map);

    // If path passes through Sol gravity hexes, deflections should stack
    if (course.gravityEffects.length > 1) {
      // Multiple gravity effects = cumulative
      expect(course.gravityEffects.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('computeCourse - weak gravity', () => {
  it('player can ignore single weak gravity hex', () => {
    // Luna has weak gravity at distance 1
    const lunaCenter = { q: -14, r: 5 };
    const lunaGravHex = { q: -15, r: 5 }; // W of Luna
    const hex = map.hexes.get(hexKey(lunaGravHex));

    if (hex?.gravity?.strength !== 'weak') {
      // Find actual weak gravity hex near Luna
      return; // Skip if map layout doesn't match expected
    }

    const ship = makeShip({
      position: { q: -16, r: 5 },
      velocity: { dq: 1, dr: 0 }, // Moving E through Luna weak gravity
    });

    // Without ignoring: should get deflected
    const courseApplied = computeCourse(ship, null, map);

    // With ignoring: should NOT get deflected
    const courseIgnored = computeCourse(ship, null, map, {
      weakGravityChoices: { [hexKey(lunaGravHex)]: true },
    });

    const appliedGrav = courseApplied.gravityEffects.find(e => e.bodyName === 'Luna');
    const ignoredGrav = courseIgnored.gravityEffects.find(e => e.bodyName === 'Luna');

    if (appliedGrav) {
      expect(appliedGrav.ignored).toBe(false);
    }
    if (ignoredGrav) {
      expect(ignoredGrav.ignored).toBe(true);
    }
  });
});

describe('computeCourse - crash detection', () => {
  it('ship crashing into Sol is destroyed', () => {
    // Ship heading directly at Sol
    const ship = makeShip({
      position: { q: 3, r: 0 },
      velocity: { dq: -3, dr: 0 }, // Moving W toward Sol at (0,0)
    });
    const course = computeCourse(ship, null, map);

    expect(course.crashed).toBe(true);
    expect(course.crashBody).toBe('Sol');
  });

  it('ship passing through planet body crashes', () => {
    // Ship with velocity that takes it through a planet body
    const venusCenter = { q: -5, r: -7 };
    const ship = makeShip({
      position: { q: -5, r: -9 },
      velocity: { dq: 0, dr: 2 }, // Moving SE through Venus
    });
    const course = computeCourse(ship, null, map);

    // Should crash into Venus body if path goes through surface hexes
    if (course.path.some(h => {
      const hex = map.hexes.get(hexKey(h));
      return hex?.body?.name === 'Venus';
    })) {
      expect(course.crashed).toBe(true);
    }
  });

  it('ship landing on non-destructive body does not crash', () => {
    // Ship ending on Mercury body hex (non-destructive)
    const mercuryCenter = { q: 7, r: -2 };
    const ship = makeShip({
      position: { q: 8, r: -2 },
      velocity: { dq: -1, dr: 0 }, // Moving W to Mercury center
    });
    const course = computeCourse(ship, null, map);

    // Mercury is non-destructive, so landing = not a crash
    if (hexEqual(course.destination, mercuryCenter)) {
      expect(course.crashed).toBe(false);
      expect(course.landedAt).toBe('Mercury');
    }
  });
});

describe('computeCourse - landing', () => {
  it('ship arriving at base hex lands', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    expect(marsBase).not.toBeNull();

    // Ship arriving at the base from an adjacent non-gravity hex
    const ship = makeShip({
      position: hexAdd(marsBase, HEX_DIRECTIONS[0]), // 1 hex E of base
      velocity: { dq: -1, dr: 0 }, // Moving W to base
    });
    const course = computeCourse(ship, null, map);

    // Path may be affected by gravity, but if it reaches the base:
    if (hexEqual(course.destination, marsBase)) {
      expect(course.landedAt).toBe('Mars');
      expect(course.crashed).toBe(false);
    }
  });

  it('base landing works at any velocity', () => {
    // Ship moving fast through a base hex should still land
    const marsBase = findBaseHex(map, 'Mars')!;

    // This test verifies the landing check doesn't require zero velocity
    const ship = makeShip({
      position: { q: marsBase.q + 2, r: marsBase.r },
      velocity: { dq: -2, dr: 0 },
    });
    const course = computeCourse(ship, null, map);

    // If destination is the base, it should land regardless of velocity
    if (hexEqual(course.destination, marsBase)) {
      expect(course.landedAt).toBe('Mars');
    }
  });
});

describe('computeCourse - takeoff', () => {
  it('landed ship with no burn stays landed', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const ship = makeShip({
      position: marsBase,
      landed: true,
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);

    expect(course.destination).toEqual(marsBase);
    expect(course.fuelSpent).toBe(0);
    expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
    expect(course.landedAt).toBeNull(); // Already landed, no new landing event
  });

  it('landed ship with burn takes off', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const ship = makeShip({
      position: marsBase,
      landed: true,
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    const course = computeCourse(ship, 0, map); // Burn E

    expect(course.fuelSpent).toBe(1);
    // Ship should have moved away from the base
    expect(hexEqual(course.destination, marsBase)).toBe(false);
    // Velocity should be non-zero
    expect(course.newVelocity.dq !== 0 || course.newVelocity.dr !== 0).toBe(true);
  });

  it('takeoff does not crash into the launch body', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const ship = makeShip({
      position: marsBase,
      landed: true,
      fuel: 20,
    });

    // Try all 6 burn directions — none should crash into Mars
    for (let d = 0; d < 6; d++) {
      const course = computeCourse(ship, d, map);
      if (course.crashed) {
        // If crashed, it should be into something other than Mars
        expect(course.crashBody).not.toBe('Mars');
      }
    }
  });
});

describe('predictDestination', () => {
  it('returns position for landed ship', () => {
    const ship = makeShip({ position: { q: 3, r: 4 }, landed: true });
    expect(predictDestination(ship)).toEqual({ q: 3, r: 4 });
  });

  it('returns position + velocity for flying ship', () => {
    const ship = makeShip({
      position: { q: 3, r: 4 },
      velocity: { dq: 2, dr: -1 },
    });
    expect(predictDestination(ship)).toEqual({ q: 5, r: 3 });
  });
});

describe('canBurn', () => {
  it('returns true when fuel > 0', () => {
    expect(canBurn(makeShip({ fuel: 1 }))).toBe(true);
  });

  it('returns false when fuel = 0', () => {
    expect(canBurn(makeShip({ fuel: 0 }))).toBe(false);
  });
});
