import { describe, expect, it } from 'vitest';

import { must } from '../../shared/assert';
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexDirectionToward,
  hexKey,
} from '../../shared/hex';
import { buildSolarSystemMap, findBaseHex } from '../../shared/map-data';
import { createTestShip, createTestState } from '../../shared/test-helpers';
import type { ShipMovement } from '../../shared/types/domain';
import {
  deriveTrainingFirstBurnDirection,
  deriveTrainingMovementFeedback,
} from './training-guidance';

describe('Training Flight guidance', () => {
  it('chooses a safe first burn toward the objective for either seat', () => {
    const map = buildSolarSystemMap();

    for (const [playerId, home, target] of [
      [0, 'Venus', 'Mars'],
      [1, 'Mars', 'Venus'],
    ] as const) {
      const ship = createTestShip({
        owner: playerId,
        originalOwner: playerId,
        position: must(findBaseHex(map, home)),
        lifecycle: 'landed',
      });
      const state = createTestState({
        phase: 'astrogation',
        activePlayer: playerId,
        ships: [ship],
        players:
          playerId === 0
            ? [{ homeBody: home, targetBody: target }, {}]
            : [{}, { homeBody: home, targetBody: target }],
      });

      expect(
        deriveTrainingFirstBurnDirection(state, playerId, ship, map),
      ).toBeTypeOf('number');
    }
  });

  it('explains when momentum is carrying the player toward the target', () => {
    const solarMap = buildSolarSystemMap();
    const from = must(findBaseHex(solarMap, 'Venus'));
    const map = { ...solarMap, hexes: new Map() };
    const target = must(map.bodies.find((body) => body.name === 'Mars')).center;
    const direction = hexDirectionToward(from, target);
    const velocity = HEX_DIRECTIONS[direction];
    const to = hexAdd(from, velocity);
    const ship = createTestShip({ position: to, velocity });
    const state = createTestState({ ships: [ship] });
    const movement: ShipMovement = {
      shipId: ship.id,
      from,
      to,
      path: [from, to],
      newVelocity: velocity,
      fuelSpent: 1,
      gravityEffects: [],
      outcome: 'normal',
    };

    expect(deriveTrainingMovementFeedback(state, 0, [movement], map)).toContain(
      'velocity now carries you toward Mars',
    );
  });

  it('suggests correcting a move that increased objective distance', () => {
    const solarMap = buildSolarSystemMap();
    const from = must(findBaseHex(solarMap, 'Venus'));
    const map = { ...solarMap, hexes: new Map() };
    const target = must(map.bodies.find((body) => body.name === 'Mars')).center;
    const direction = hexDirectionToward(target, from);
    const velocity = HEX_DIRECTIONS[direction];
    const to = hexAdd(from, velocity);
    const ship = createTestShip({ position: to, velocity });
    const state = createTestState({ ships: [ship] });
    const movement: ShipMovement = {
      shipId: ship.id,
      from,
      to,
      path: [from, to],
      newVelocity: velocity,
      fuelSpent: 1,
      gravityEffects: [],
      outcome: 'normal',
    };

    expect(deriveTrainingMovementFeedback(state, 0, [movement], map)).toContain(
      'moved farther from Mars',
    );
  });

  it('warns when the next free drift would crash', () => {
    const map = {
      hexes: new Map([
        [
          hexKey({ q: 1, r: 0 }),
          {
            terrain: 'planetSurface' as const,
            body: { name: 'Venus', destructive: true },
          },
        ],
      ]),
      bodies: [
        {
          name: 'Mars',
          center: { q: 4, r: 0 },
          surfaceRadius: 1,
          color: '#fff',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const state = createTestState({ ships: [ship] });
    const movement: ShipMovement = {
      shipId: ship.id,
      from: { q: -1, r: 0 },
      to: ship.position,
      path: [{ q: -1, r: 0 }, ship.position],
      newVelocity: ship.velocity,
      fuelSpent: 1,
      gravityEffects: [],
      outcome: 'normal',
    };

    expect(deriveTrainingMovementFeedback(state, 0, [movement], map)).toContain(
      'clears the CRASH warning',
    );
  });
});
