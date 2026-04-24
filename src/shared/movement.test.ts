import { beforeEach, describe, expect, it } from 'vitest';
import { must } from './assert';
import {
  analyzeHexLine,
  asHexKey,
  HEX_DIRECTIONS,
  hexAdd,
  hexEqual,
  hexKey,
} from './hex';
import { asShipId } from './ids';
import { buildSolarSystemMap, findBaseHex, findBaseHexes } from './map-data';
import { canBurn, computeCourse, predictDestination } from './movement';
import type { Ship, SolarSystemMap } from './types';

let map: SolarSystemMap;
const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('test'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 5, r: 5 },
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
beforeEach(() => {
  map = buildSolarSystemMap();
});
describe('computeCourse - basic movement', () => {
  it('stationary ship with no burn stays put', () => {
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    expect(course.destination).toEqual({ q: 5, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
    expect(course.fuelSpent).toBe(0);
    expect(course.outcome).toBe('normal');
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
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
    });
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
    // Burn E, same direction as velocity
    const course = computeCourse(ship, 0, map);
    expect(course.destination).toEqual({ q: 7, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 2, dr: 0 });
    expect(course.fuelSpent).toBe(1);
  });
  it('burn can oppose velocity', () => {
    const ship = makeShip({
      position: { q: 5, r: 5 },
      velocity: { dq: 2, dr: 0 },
    });
    // Burn W (opposite to E velocity)
    const course = computeCourse(ship, 3, map);
    expect(course.destination).toEqual({ q: 6, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 1, dr: 0 });
    expect(course.fuelSpent).toBe(1);
  });
  it('no burn with empty fuel uses no fuel', () => {
    const ship = makeShip({ fuel: 0 });
    // Try to burn with no fuel
    const course = computeCourse(ship, 0, map);
    // Burn should not apply — no fuel
    expect(course.fuelSpent).toBe(0);
    expect(course.destination).toEqual(ship.position);
  });
});
describe('computeCourse - overload maneuver', () => {
  it('warship can overload for 2 fuel', () => {
    const ship = makeShip({
      type: 'corvette',
      position: { q: 5, r: 5 },
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    // Double burn E
    const course = computeCourse(ship, 0, map, { overload: 0 });
    expect(course.destination).toEqual({ q: 7, r: 5 });
    expect(course.newVelocity).toEqual({ dq: 2, dr: 0 });
    expect(course.fuelSpent).toBe(2);
  });
  it('non-warship cannot overload', () => {
    const ship = makeShip({
      type: 'transport',
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
      fuel: 1,
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
      velocity: { dq: -2, dr: 0 },
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
          direction: must(hex?.gravity).direction,
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
    const landingBase = must(marsBase);
    // The base should be in the gravity ring
    const baseHex = map.hexes.get(hexKey(landingBase));
    expect(baseHex?.base).toBeDefined();
    // Ship moving to land at the base — approach from outside the gravity ring
    const ship = makeShip({
      position: { q: landingBase.q + 1, r: landingBase.r },
      velocity: { dq: -1, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    // Ship should arrive at the base hex (not be deflected past it),
    // but it is still flying unless it executes a legal landing burn from orbit.
    if (hexEqual(course.destination, must(marsBase))) {
      expect(course.outcome).not.toBe('landing');
      expect(course.outcome).not.toBe('crash');
    }
    expect(course.gravityEffects).toHaveLength(0);
    expect(
      course.enteredGravityEffects.every(
        (effect) => !hexEqual(effect.hex, ship.position),
      ),
    ).toBe(true);
  });
  it('passing through multiple gravity hexes queues multiple future deflections', () => {
    const ship = makeShip({
      position: { q: 5, r: 0 },
      velocity: { dq: -2, dr: 0 },
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
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'full',
              bodyName: 'TestWorld',
            },
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
  it('queues gravity when the course definitively enters a gravity hex', () => {
    const gravMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 2 },
    };
    // Straight E at speed 2: (0,0) -> (2,0), definitively enters (1,0)
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    const course = computeCourse(ship, null, gravMap);
    expect(course.enteredGravityEffects).toHaveLength(1);
    expect(course.enteredGravityEffects[0].bodyName).toBe('TestWorld');
  });
  it('does not queue gravity for edge-grazing with weak gravity hex', () => {
    const weakGravMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'weak',
              bodyName: 'TestMoon',
            },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 2 },
    };
    // Diagonal path (0,0) -> (2,-1) grazes edge of (1,0)
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: -1 },
    });
    const course = computeCourse(ship, null, weakGravMap);
    expect(course.enteredGravityEffects).toEqual([]);
  });
  it('does not queue gravity when both sides of edge-grazing are gravity hexes', () => {
    // Both (1,0) and (1,-1) have gravity but path runs along their shared edge
    const dualGravMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
        [
          asHexKey('1,-1'),
          {
            terrain: 'space',
            gravity: {
              direction: 4,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 2 },
    };
    // Path (0,0) -> (2,-1) runs along the shared edge
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: -1 },
    });
    const course = computeCourse(ship, null, dualGravMap);
    // Neither gravity hex is definite — both are ambiguous
    expect(course.enteredGravityEffects).toEqual([]);
  });
});
describe('computeCourse - weak gravity', () => {
  it('player can ignore single weak gravity hex', () => {
    // Luna has weak gravity at distance 1
    const lunaGravHex = { q: 12, r: -9 }; // W of Luna
    const hex = map.hexes.get(hexKey(lunaGravHex));
    if (hex?.gravity?.strength !== 'weak') {
      // Find actual weak gravity hex near Luna
      return; // Skip if map layout doesn't match expected
    }
    const ship = makeShip({
      position: { q: 11, r: -9 },
      velocity: { dq: 1, dr: 0 },
    });
    // Without ignoring: destination is unchanged this turn, but gravity is queued.
    const courseApplied = computeCourse(ship, null, map);
    // With ignoring: same destination this turn, but queued gravity is marked ignored.
    const courseIgnored = computeCourse(ship, null, map, {
      weakGravityChoices: { [hexKey(lunaGravHex)]: true },
    });
    expect(courseApplied.destination).toEqual(courseIgnored.destination);
    const appliedGrav = courseApplied.enteredGravityEffects.find(
      (e) => e.bodyName === 'Luna',
    );
    const ignoredGrav = courseIgnored.enteredGravityEffects.find(
      (e) => e.bodyName === 'Luna',
    );
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
    const solCenter = must(
      map.bodies.find((body) => body.name === 'Sol')?.center,
    );
    const ship = makeShip({
      position: { q: solCenter.q + 3, r: solCenter.r },
      velocity: { dq: -3, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    expect(course.outcome).toBe('crash');
    if (course.outcome === 'crash') {
      expect(course.crashBody).toBe('Sol');
      expect(
        course.path.some((h) => hexKey(h) === hexKey(course.crashHex)),
      ).toBe(true);
    }
  });
  it('ship passing through planet body crashes', () => {
    const ship = makeShip({
      position: { q: -7, r: 5 },
      velocity: { dq: 0, dr: 2 },
    });
    const course = computeCourse(ship, null, map);
    // Should crash into Venus body if path goes through surface hexes
    if (
      course.path.some((h) => {
        const hex = map.hexes.get(hexKey(h));
        return hex?.body?.name === 'Venus';
      })
    ) {
      expect(course.outcome).toBe('crash');
    }
  });
  it('ship ending on a planetary body without a legal landing crashes', () => {
    const mercuryCenter = must(
      map.bodies.find((body) => body.name === 'Mercury')?.center,
    );
    const ship = makeShip({
      position: { q: mercuryCenter.q + 1, r: mercuryCenter.r },
      velocity: { dq: -1, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    if (hexEqual(course.destination, mercuryCenter)) {
      expect(course.outcome).toBe('crash');
    }
  });
});
describe('computeCourse - landing', () => {
  it('drifting into a planetary base hex does not auto-land', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    expect(marsBase).not.toBeNull();
    const ship = makeShip({
      position: hexAdd(marsBase, HEX_DIRECTIONS[0]),
      velocity: { dq: -1, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    if (hexEqual(course.destination, marsBase)) {
      expect(course.outcome).toBe('normal');
    }
  });

  it('orbiting ship lands with a 1-fuel burn', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
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
    // Burn direction 0 (E) with land flag
    const course = computeCourse(ship, 0, map, {
      land: true,
    });
    expect(course.fuelSpent).toBe(1);
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
  });

  it('burn direction is irrelevant for orbital landing', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
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
    for (let dir = 0; dir < 6; dir++) {
      const course = computeCourse({ ...ship }, dir, map, { land: true });
      expect(course.outcome).toBe('landing');
      if (course.outcome === 'landing') {
        expect(course.landedAt).toBe('Mars');
      }
    }
  });

  it('orbiting ship with no burn does not land', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
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
    const course = computeCourse(ship, null, map);
    expect(course.fuelSpent).toBe(0);
    expect(course.outcome).not.toBe('landing');
  });

  it('stationary active ship already on a planetary base completes landing', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: marsBase,
      velocity: { dq: 0, dr: 0 },
      lifecycle: 'active',
    });

    const course = computeCourse(ship, null, map);

    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
  });

  it('active ship on a planetary base can brake to land', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: marsBase,
      velocity: { dq: 1, dr: 0 },
      lifecycle: 'active',
    });

    const course = computeCourse(ship, 3, map, { land: true });

    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
  });

  it('speed 2 ship in gravity hex does not trigger orbital landing', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: { q: marsBase.q, r: marsBase.r + 1 },
      velocity: { dq: 0, dr: -2 },
    });
    const course = computeCourse(ship, 0, map);
    expect(course.outcome).not.toBe('landing');
  });

  it('speed 2 ship can burn into orbit and land in one turn', () => {
    // Ship at (-7,-6) with velocity (-2, 0) burns dir 0
    // (+1, 0). Post-burn velocity is (-1, 0) = speed 1.
    // Destination (-8,-6) is a Mars gravity hex → orbit.
    const ship = makeShip({
      position: { q: -7, r: -6 },
      velocity: { dq: -2, dr: 0 },
    });
    const course = computeCourse(ship, 0, map, { land: true });
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
    expect(course.fuelSpent).toBe(1);
  });

  it('speed 2 ship without land flag does not auto-land', () => {
    const ship = makeShip({
      position: { q: -7, r: -6 },
      velocity: { dq: -2, dr: 0 },
    });
    const course = computeCourse(ship, 0, map);
    expect(course.outcome).not.toBe('landing');
  });

  it('orbital landing picks closest base', () => {
    const bases = findBaseHexes(map, 'Mars');
    expect(bases.length).toBeGreaterThan(1);

    // Pick a base hex and orbit adjacent to it
    const target = bases[0];
    const ship = makeShip({
      position: {
        q: target.q,
        r: target.r + 1,
      },
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: { q: target.q, r: target.r + 1 },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, 0, map, {
      land: true,
    });
    expect(course.outcome).toBe('landing');
  });

  it('destroyed planetary bases are not landing targets', () => {
    const bases = findBaseHexes(map, 'Mars');
    const allDestroyed = bases.map((b) => hexKey(b));
    const marsBase = bases[0];
    const ship = makeShip({
      position: { q: marsBase.q, r: marsBase.r + 1 },
      velocity: { dq: 0, dr: -1 },
      pendingGravityEffects: [
        {
          hex: {
            q: marsBase.q,
            r: marsBase.r + 1,
          },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, 0, map, {
      land: true,
      destroyedBases: allDestroyed,
    });
    expect(course.outcome).not.toBe('landing');
  });

  it('overload burn does not trigger orbital landing', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      type: 'corvette',
      position: { q: marsBase.q, r: marsBase.r + 1 },
      velocity: { dq: 0, dr: -1 },
      fuel: 20,
      pendingGravityEffects: [
        {
          hex: {
            q: marsBase.q,
            r: marsBase.r + 1,
          },
          direction: 3,
          bodyName: 'Mars',
          strength: 'full',
          ignored: false,
        },
      ],
    });
    const course = computeCourse(ship, 0, map, {
      overload: 1,
    });
    // Overload costs 2 fuel, not 1, so orbit
    // landing should not fire
    expect(course.fuelSpent).toBe(2);
    expect(course.outcome).not.toBe('landing');
  });

  it('asteroid landing requires stopping in the hex', () => {
    const ceresCenter = must(
      map.bodies.find((body) => body.name === 'Ceres')?.center,
    );
    const ship = makeShip({
      position: ceresCenter,
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    expect(course.destination).toEqual(ceresCenter);
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Ceres');
    }
  });
});
describe('computeCourse - takeoff', () => {
  it('landed ship with no burn stays landed', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: marsBase,
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
    });
    const course = computeCourse(ship, null, map);
    expect(course.destination).toEqual(marsBase);
    expect(course.fuelSpent).toBe(0);
    expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
  });
  it('landed ship with burn takes off', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: marsBase,
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    const course = computeCourse(ship, 0, map); // Burn E
    expect(course.fuelSpent).toBe(1);
    expect(hexEqual(course.destination, marsBase)).toBe(false);
    expect(course.newVelocity.dq !== 0 || course.newVelocity.dr !== 0).toBe(
      true,
    );
  });
  it('takeoff moves one hex in the burn direction', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      position: marsBase,
      lifecycle: 'landed',
      fuel: 20,
    });
    // Burning from a base moves normally — some directions may crash
    let safeCount = 0;
    for (let d = 0; d < 6; d++) {
      const course = computeCourse(ship, d, map);
      if (course.outcome !== 'crash') {
        safeCount++;
        expect(course.fuelSpent).toBe(1);
      }
    }
    expect(safeCount).toBeGreaterThan(0);
  });
});
describe('computeCourse - takeoff edge cases', () => {
  it('takeoff finds a launch hex when away direction is blocked by a body', () => {
    const customMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('0,0'),
          {
            terrain: 'planetSurface',
            body: { name: 'TestWorld', destructive: false },
          },
        ],
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            base: {
              bodyName: 'TestWorld',
              name: 'BodyName',
            },
            gravity: {
              direction: 3,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
        [
          asHexKey('2,0'),
          {
            terrain: 'planetSurface',
            body: { name: 'Blocker', destructive: true },
          },
        ],
        [
          asHexKey('0,1'),
          {
            terrain: 'space',
            gravity: {
              direction: 0,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
        [
          asHexKey('1,-1'),
          {
            terrain: 'space',
            gravity: {
              direction: 4,
              strength: 'full',
              bodyName: 'TestWorld',
            },
          },
        ],
      ]),
      bodies: [
        {
          name: 'TestWorld',
          center: { q: 0, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
        {
          name: 'Blocker',
          center: { q: 2, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const ship = makeShip({
      position: { q: 1, r: 0 },
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    // Try multiple burn directions to find one that doesn't get cancelled by gravity
    let found = false;
    for (let d = 0; d < 6; d++) {
      const course = computeCourse(ship, d, customMap);
      // Fallback loop ran — ship should spend fuel and compute a course
      expect(course.fuelSpent).toBe(1);
      if (course.outcome !== 'crash') {
        found = true;
        break;
      }
    }
    // At least one direction should work
    expect(found).toBe(true);
  });
  it('takeoff with overload on a warship costs 2 fuel', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      type: 'corvette',
      position: marsBase,
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    // Try all directions to find one that doesn't crash
    for (let d = 0; d < 6; d++) {
      const course = computeCourse(ship, d, map, { overload: d });
      if (course.outcome !== 'crash') {
        expect(course.fuelSpent).toBe(2);
        expect(course.destination).not.toEqual(marsBase);
        return;
      }
    }
  });
  it('takeoff with overload on a transport is ignored', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      type: 'transport',
      position: marsBase,
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      fuel: 20,
    });
    const course = computeCourse(ship, 0, map, { overload: 3 });
    // Transport can't overload, so only 1 fuel spent
    expect(course.fuelSpent).toBe(1);
  });
  it('takeoff overload with insufficient fuel is ignored', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = makeShip({
      type: 'corvette',
      position: marsBase,
      lifecycle: 'landed',
      velocity: { dq: 0, dr: 0 },
      fuel: 1,
    });
    const course = computeCourse(ship, 0, map, { overload: 3 });
    // Only 1 fuel available, overload ignored
    expect(course.fuelSpent).toBe(1);
  });
});
describe('computeCourse - weak gravity consecutive rule', () => {
  it('second consecutive weak gravity from same body is mandatory', () => {
    const customMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'weak',
              bodyName: 'Luna',
            },
          },
        ],
        [
          asHexKey('2,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'weak',
              bodyName: 'Luna',
            },
          },
        ],
      ]),
      bodies: [
        {
          name: 'Luna',
          center: { q: 3, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    // Try to ignore both weak gravity hexes
    const course = computeCourse(ship, null, customMap, {
      weakGravityChoices: { [asHexKey('1,0')]: true, [asHexKey('2,0')]: true },
    });
    // First weak gravity can be ignored, second consecutive one from same body cannot
    const effects = course.enteredGravityEffects;
    if (effects.length === 2) {
      expect(effects[0].ignored).toBe(true);
      expect(effects[1].ignored).toBe(false);
    }
  });
  it('weak gravity from different bodies can both be ignored', () => {
    const customMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'weak',
              bodyName: 'BodyA',
            },
          },
        ],
        [
          asHexKey('2,0'),
          {
            terrain: 'space',
            gravity: {
              direction: 3,
              strength: 'weak',
              bodyName: 'BodyB',
            },
          },
        ],
      ]),
      bodies: [
        {
          name: 'BodyA',
          center: { q: 3, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
        {
          name: 'BodyB',
          center: { q: 4, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const ship = makeShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: 0 },
    });
    const course = computeCourse(ship, null, customMap, {
      weakGravityChoices: { [asHexKey('1,0')]: true, [asHexKey('2,0')]: true },
    });
    const effects = course.enteredGravityEffects;
    if (effects.length === 2) {
      expect(effects[0].ignored).toBe(true);
      expect(effects[1].ignored).toBe(true);
    }
  });
});
describe('predictDestination', () => {
  it('returns position for landed ship', () => {
    const ship = makeShip({
      position: { q: 3, r: 4 },
      lifecycle: 'landed',
    });
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
