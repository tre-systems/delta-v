import { beforeEach, describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { SolarSystemMap } from '../../shared/types/domain';
import {
  hasOwnedPendingAsteroidHazards,
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveSkipCombatStep,
} from './local';

let map: SolarSystemMap;

beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('game-client-local', () => {
  it('classifies launched movement as a movement result', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST1',
      findBaseHex,
    );
    const ship = state.ships[0];

    const resolution = resolveAstrogationStep(
      state,
      0,
      [{ shipId: ship.id, burn: 0, overload: null }],
      map,
    );

    expect(resolution.kind).toBe('movement');
  });

  it('classifies in-space astrogation as an ordnance state update', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'TEST2', findBaseHex);
    const ship = state.ships[0];

    state.activePlayer = 0;
    ship.lifecycle = 'active';
    ship.position = { q: 20, r: 0 };
    ship.velocity = { dq: 0, dr: 0 };

    const resolution = resolveAstrogationStep(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      map,
    );

    expect(resolution).toMatchObject({
      kind: 'state',
      state: { phase: 'ordnance' },
    });
  });

  it('classifies asteroid hazard resolution as combat results', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST3',
      findBaseHex,
    );
    const ship = state.ships[0];

    ship.lifecycle = 'active';
    state.phase = 'combat';
    state.activePlayer = 0;
    state.pendingAsteroidHazards = [
      { shipId: ship.id, hex: { ...ship.position } },
    ];

    const resolution = resolveBeginCombatStep(state, 0, map);

    expect(resolution.kind).toBe('combat');
    if (resolution.kind !== 'combat') {
      throw new Error('Expected combat resolution');
    }
    expect(resolution.previousState).toBe(state);
    expect(resolution.results).toHaveLength(1);
    expect(resolution.resetCombat).toBe(false);
  });

  it('advances the turn when combat is skipped without queued results', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'TEST4', findBaseHex);

    state.phase = 'combat';
    state.activePlayer = 0;
    state.pendingAsteroidHazards = [];

    const resolution = resolveSkipCombatStep(state, 0, map);

    expect(resolution).toMatchObject({
      kind: 'state',
      state: { phase: 'astrogation', activePlayer: 1 },
    });
  });

  it('preserves caller-controlled combat reset behavior', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'TEST4B', findBaseHex);

    state.phase = 'combat';
    state.activePlayer = 0;
    state.ships[0].lifecycle = 'active';
    state.ships[1].lifecycle = 'active';
    state.ships[1].detected = true;
    state.ships[0].position = { q: 20, r: 0 };
    state.ships[1].position = { q: 21, r: 0 };
    state.ships[0].velocity = { dq: 0, dr: 0 };
    state.ships[1].velocity = { dq: 0, dr: 0 };

    const resolution = resolveCombatStep(
      state,
      0,
      [
        {
          attackerIds: [state.ships[0].id],
          targetId: state.ships[1].id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      map,
      false,
    );

    expect(resolution.kind).toBe('combat');
    if (resolution.kind !== 'combat') {
      throw new Error('Expected combat resolution');
    }
    expect(resolution.previousState).toBe(state);
    expect(resolution.resetCombat).toBe(false);
  });

  it('only reports pending asteroid hazards for live ships owned by the player', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST5',
      findBaseHex,
    );
    const myShip = state.ships[0];
    const enemyShip = state.ships[1];

    state.pendingAsteroidHazards = [
      {
        shipId: myShip.id,
        hex: { ...myShip.position },
      },
      {
        shipId: enemyShip.id,
        hex: { ...enemyShip.position },
      },
    ];

    expect(hasOwnedPendingAsteroidHazards(state, 0)).toBe(true);

    myShip.lifecycle = 'destroyed';

    expect(hasOwnedPendingAsteroidHazards(state, 0)).toBe(false);
  });
});
