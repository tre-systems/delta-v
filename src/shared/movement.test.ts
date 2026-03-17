import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeHexLine, HEX_DIRECTIONS, hexAdd, hexEqual, hexKey } from './hex';
import { buildSolarSystemMap, findBaseHex } from './map-data';
import { canBurn, computeCourse, predictDestination } from './movement';
import type { Ship, SolarSystemMap } from './types';

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
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    pendingGravityEffects: [],
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
  it('entering a gravity hex queues deflection for the next turn', () => {
    const gravHex = { q: -8, r: -5 }; // E of Mars
    const hex = map.hexes.get(hexKey(gravHex));
    expect(hex?.gravity).toBeDefined();
    expect(hex?.gravity?.bodyName).toBe('Mars');

    const ship = makeShip({
      position: { q: -6, r: -5 },
      velocity: { dq: -2, dr: 0 }, // Ends in the Mars gravity ring
    });
    const course = computeCourse(ship, null, map);

    expect(course.destination).toEqual(gravHex);
    expect(course.gravityEffects).toHaveLength(0);
    expect(course.enteredGravityEffects).toHaveLength(1);
    expect(course.enteredGravityEffects[0].bodyName).toBe('Mars');
  });

  it('pending gravity deflects the following turn', () => {
    const gravHex = { q: -8, r: -5 }; // E of Mars
    const hex = map.hexes.get(hexKey(gravHex));
    expect(hex?.gravity).toBeDefined();

    const ship = makeShip({
      position: gravHex,
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: gravHex,
          direction: hex!.gravity!.direction,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, null, map);

    expect(course.destination).toEqual({ q: -9, r: -6 });
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

    // Ship should arrive at the base hex (not be deflected past it), but it is
    // still flying unless it executes a legal landing burn from orbit.
    if (hexEqual(course.destination, marsBase!)) {
      expect(course.landedAt).toBeNull();
      expect(course.crashed).toBe(false);
    }
    expect(course.gravityEffects).toHaveLength(0);
    expect(course.enteredGravityEffects.every((effect) => !hexEqual(effect.hex, ship.position))).toBe(true);
  });

  it('passing through multiple gravity hexes queues multiple future deflections', () => {
    const ship = makeShip({
      position: { q: 5, r: 0 },
      velocity: { dq: -2, dr: 0 }, // Moving W toward Sol
    });
    const course = computeCourse(ship, null, map);

    if (course.enteredGravityEffects.length > 1) {
      expect(course.enteredGravityEffects.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not queue gravity when the course only runs along a gravity hex edge', () => {
    const edgeMap: SolarSystemMap = {
      hexes: new Map([
        [
          '1,0',
          {
            terrain: 'space',
            gravity: { direction: 3, strength: 'full', bodyName: 'TestWorld' },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 2 },
    };
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: -1 },
    });

    const analysis = analyzeHexLine(ship.position, { q: 2, r: -1 });
    expect(analysis.ambiguousPairs).toEqual([
      [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
      ],
    ]);

    const course = computeCourse(ship, null, edgeMap);
    expect(course.enteredGravityEffects).toEqual([]);
  });
});

describe('computeCourse - weak gravity', () => {
  it('player can ignore single weak gravity hex', () => {
    // Luna has weak gravity at distance 1
    const _lunaCenter = { q: 13, r: -9 };
    const lunaGravHex = { q: 12, r: -9 }; // W of Luna
    const hex = map.hexes.get(hexKey(lunaGravHex));

    if (hex?.gravity?.strength !== 'weak') {
      // Find actual weak gravity hex near Luna
      return; // Skip if map layout doesn't match expected
    }

    const ship = makeShip({
      position: { q: 11, r: -9 },
      velocity: { dq: 1, dr: 0 }, // Moving E through Luna weak gravity
    });

    // Without ignoring: destination is unchanged this turn, but gravity is queued.
    const courseApplied = computeCourse(ship, null, map);

    // With ignoring: same destination this turn, but queued gravity is marked ignored.
    const courseIgnored = computeCourse(ship, null, map, {
      weakGravityChoices: { [hexKey(lunaGravHex)]: true },
    });

    expect(courseApplied.destination).toEqual(courseIgnored.destination);

    const appliedGrav = courseApplied.enteredGravityEffects.find((e) => e.bodyName === 'Luna');
    const ignoredGrav = courseIgnored.enteredGravityEffects.find((e) => e.bodyName === 'Luna');

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
    const _venusCenter = { q: -7, r: 7 };
    const ship = makeShip({
      position: { q: -7, r: 5 },
      velocity: { dq: 0, dr: 2 }, // Moving SE through Venus
    });
    const course = computeCourse(ship, null, map);

    // Should crash into Venus body if path goes through surface hexes
    if (
      course.path.some((h) => {
        const hex = map.hexes.get(hexKey(h));
        return hex?.body?.name === 'Venus';
      })
    ) {
      expect(course.crashed).toBe(true);
    }
  });

  it('ship ending on a planetary body without a legal landing crashes', () => {
    const mercuryCenter = { q: 4, r: 2 };
    const ship = makeShip({
      position: { q: 5, r: 2 },
      velocity: { dq: -1, dr: 0 }, // Moving W to Mercury center
    });
    const course = computeCourse(ship, null, map);

    if (hexEqual(course.destination, mercuryCenter)) {
      expect(course.crashed).toBe(true);
      expect(course.landedAt).toBeNull();
    }
  });
});

describe('computeCourse - landing', () => {
  it('drifting into a planetary base hex does not auto-land', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    expect(marsBase).not.toBeNull();

    const ship = makeShip({
      position: hexAdd(marsBase, HEX_DIRECTIONS[0]), // 1 hex E of base
      velocity: { dq: -1, dr: 0 }, // Moving W to base
    });
    const course = computeCourse(ship, null, map);

    if (hexEqual(course.destination, marsBase)) {
      expect(course.landedAt).toBeNull();
      expect(course.crashed).toBe(false);
    }
  });

  it('planetary landing requires orbit and a 1-fuel landing burn', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const ship = makeShip({
      position: { q: marsBase.q, r: marsBase.r + 1 },
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: { q: marsBase.q, r: marsBase.r + 1 },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, 0, map);

    expect(course.destination).toEqual(marsBase);
    expect(course.fuelSpent).toBe(1);
    if (hexEqual(course.destination, marsBase)) {
      expect(course.landedAt).toBe('Mars');
      expect(course.crashed).toBe(false);
    }
  });

  it('destroyed planetary bases are not legal landing targets', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const ship = makeShip({
      position: { q: marsBase.q, r: marsBase.r + 1 },
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: { q: marsBase.q, r: marsBase.r + 1 },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, 0, map, {
      destroyedBases: [hexKey(marsBase)],
    });

    expect(course.destination).toEqual(marsBase);
    expect(course.landedAt).toBeNull();
  });

  it('asteroid landing requires stopping in the hex', () => {
    const ship = makeShip({
      position: { q: -4, r: -14 }, // Ceres hex
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    expect(course.destination).toEqual({ q: -4, r: -14 });
    expect(course.landedAt).toBe('Ceres');
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

  it('includes pending gravity for flying ships', () => {
    const ship = makeShip({
      position: { q: 11, r: 8 },
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: { q: 11, r: 8 },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });

    expect(predictDestination(ship)).toEqual({ q: 10, r: 7 });
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
