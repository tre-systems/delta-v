import * as fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import type { HexCoord, HexVec } from './hex';
import { HEX_DIRECTIONS, hexDistance, hexEqual, hexSubtract } from './hex';
import { buildSolarSystemMap } from './map-data';
import { computeCourse } from './movement';
import type { Ship, SolarSystemMap } from './types';

let map: SolarSystemMap;

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'prop-test',
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

// Generate positions in open space (away from bodies/gravity)
const arbOpenPosition = (): fc.Arbitrary<HexCoord> =>
  fc.record({
    q: fc.integer({ min: 3, max: 7 }),
    r: fc.integer({ min: 3, max: 7 }),
  });

const arbSmallVelocity = (): fc.Arbitrary<HexVec> =>
  fc.record({
    dq: fc.integer({ min: -3, max: 3 }),
    dr: fc.integer({ min: -3, max: 3 }),
  });

const arbBurnDirection = () => fc.integer({ min: 0, max: 5 });

const arbOptionalBurn = () => fc.option(arbBurnDirection(), { nil: null });

beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('movement invariants', () => {
  it('fuel spent is never negative', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        (pos, vel, burn) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
          });
          const course = computeCourse(ship, burn, map);

          expect(course.fuelSpent).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('fuel spent never exceeds available fuel', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        fc.integer({ min: 0, max: 50 }),
        (pos, vel, burn, fuel) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
            fuel,
          });
          const course = computeCourse(ship, burn, map);

          expect(course.fuelSpent).toBeLessThanOrEqual(fuel);
        },
      ),
    );
  });

  it('no burn means no fuel spent (in open space)', () => {
    fc.assert(
      fc.property(arbOpenPosition(), arbSmallVelocity(), (pos, vel) => {
        const ship = makeShip({
          position: pos,
          velocity: vel,
        });
        const course = computeCourse(ship, null, map);

        expect(course.fuelSpent).toBe(0);
      }),
    );
  });

  it('burn costs exactly 1 fuel when ship has fuel', () => {
    fc.assert(
      fc.property(arbOpenPosition(), arbBurnDirection(), (pos, dir) => {
        const ship = makeShip({
          position: pos,
          velocity: { dq: 0, dr: 0 },
          fuel: 20,
        });
        const course = computeCourse(ship, dir, map);

        expect(course.fuelSpent).toBe(1);
      }),
    );
  });

  it('path starts at ship position', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        (pos, vel, burn) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
          });
          const course = computeCourse(ship, burn, map);

          expect(hexEqual(course.path[0], pos)).toBe(true);
        },
      ),
    );
  });

  it('path ends at destination', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        (pos, vel, burn) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
          });
          const course = computeCourse(ship, burn, map);

          expect(
            hexEqual(course.path[course.path.length - 1], course.destination),
          ).toBe(true);
        },
      ),
    );
  });

  it('new velocity equals destination minus position (in open space without gravity)', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        (pos, vel, burn) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
            pendingGravityEffects: [],
          });
          const course = computeCourse(ship, burn, map);

          // Only check when no gravity effects were applied
          if (course.gravityEffects.length === 0) {
            const expectedVel = hexSubtract(course.destination, pos);

            expect(course.newVelocity).toEqual(expectedVel);
          }
        },
      ),
    );
  });

  it('stationary ship with no burn stays at same position', () => {
    fc.assert(
      fc.property(arbOpenPosition(), (pos) => {
        const ship = makeShip({
          position: pos,
          velocity: { dq: 0, dr: 0 },
        });
        const course = computeCourse(ship, null, map);

        expect(hexEqual(course.destination, pos)).toBe(true);
        expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
      }),
    );
  });

  it('consecutive path hexes are distance 1 apart', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbOptionalBurn(),
        (pos, vel, burn) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
          });
          const course = computeCourse(ship, burn, map);

          for (let i = 1; i < course.path.length; i++) {
            expect(hexDistance(course.path[i - 1], course.path[i])).toBe(1);
          }
        },
      ),
    );
  });
});

describe('velocity and burn relationship', () => {
  it('burn in a direction adds that direction vector to velocity (no gravity)', () => {
    fc.assert(
      fc.property(arbOpenPosition(), arbBurnDirection(), (pos, dir) => {
        const ship = makeShip({
          position: pos,
          velocity: { dq: 0, dr: 0 },
          pendingGravityEffects: [],
        });
        const course = computeCourse(ship, dir, map);

        if (course.gravityEffects.length === 0) {
          expect(course.newVelocity).toEqual(HEX_DIRECTIONS[dir]);
        }
      }),
    );
  });

  it('burn adds direction vector to existing velocity (no gravity)', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbBurnDirection(),
        (pos, vel, dir) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
            pendingGravityEffects: [],
          });
          const course = computeCourse(ship, dir, map);

          if (course.gravityEffects.length === 0 && !course.crashed) {
            const expected: HexVec = {
              dq: vel.dq + HEX_DIRECTIONS[dir].dq,
              dr: vel.dr + HEX_DIRECTIONS[dir].dr,
            };

            expect(course.newVelocity).toEqual(expected);
          }
        },
      ),
    );
  });
});

describe('overload mechanics', () => {
  it('overload costs exactly 2 fuel for warships', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbBurnDirection(),
        arbBurnDirection(),
        (pos, burn, overload) => {
          const ship = makeShip({
            position: pos,
            velocity: { dq: 0, dr: 0 },
            type: 'corvette',
            fuel: 20,
          });
          const course = computeCourse(ship, burn, map, {
            overload,
          });

          expect(course.fuelSpent).toBe(2);
        },
      ),
    );
  });

  it('overload has no effect on non-warships', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbBurnDirection(),
        arbBurnDirection(),
        (pos, burn, overload) => {
          const ship = makeShip({
            position: pos,
            velocity: { dq: 0, dr: 0 },
            type: 'transport',
            fuel: 10,
          });
          const course = computeCourse(ship, burn, map, {
            overload,
          });

          expect(course.fuelSpent).toBe(1);
        },
      ),
    );
  });

  it('overload requires burn (overload alone does nothing)', () => {
    fc.assert(
      fc.property(arbOpenPosition(), arbBurnDirection(), (pos, overload) => {
        const ship = makeShip({
          position: pos,
          velocity: { dq: 0, dr: 0 },
          type: 'corvette',
          fuel: 20,
        });
        const course = computeCourse(ship, null, map, {
          overload,
        });

        expect(course.fuelSpent).toBe(0);
      }),
    );
  });
});

describe('landed ship properties', () => {
  it('landed ship with no burn stays at position', () => {
    fc.assert(
      fc.property(arbOpenPosition(), (pos) => {
        const ship = makeShip({
          position: pos,
          lifecycle: 'landed',
          velocity: { dq: 0, dr: 0 },
        });
        const course = computeCourse(ship, null, map);

        expect(hexEqual(course.destination, pos)).toBe(true);
        expect(course.fuelSpent).toBe(0);
        expect(course.newVelocity).toEqual({ dq: 0, dr: 0 });
      }),
    );
  });
});

describe('ship type fuel constraints', () => {
  it('zero-fuel ship cannot burn', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbSmallVelocity(),
        arbBurnDirection(),
        (pos, vel, dir) => {
          const ship = makeShip({
            position: pos,
            velocity: vel,
            fuel: 0,
          });
          const course = computeCourse(ship, dir, map);

          expect(course.fuelSpent).toBe(0);
        },
      ),
    );
  });

  it('ship with 1 fuel cannot overload', () => {
    fc.assert(
      fc.property(
        arbOpenPosition(),
        arbBurnDirection(),
        arbBurnDirection(),
        (pos, burn, overload) => {
          const ship = makeShip({
            position: pos,
            velocity: { dq: 0, dr: 0 },
            type: 'corvette',
            fuel: 1,
          });
          const course = computeCourse(ship, burn, map, {
            overload,
          });

          expect(course.fuelSpent).toBe(1);
        },
      ),
    );
  });
});
