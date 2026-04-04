import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { ErrorCode, type FleetPurchase } from '../../shared/types/domain';
import type { ScenarioDefinition } from '../../shared/types/scenario';
import { buildAIFleetPurchases, resolveLocalFleetReady } from './fleet';

describe('game-client-fleet', () => {
  it('builds AI purchases from credits, difficulty, and availability', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.interplanetaryWar,
      map,
      asGameId('FLEET-AI'),
      findBaseHex,
    );

    state.players[0].credits = 100;
    expect(
      buildAIFleetPurchases(
        state,
        0,
        ['corvette', 'corsair', 'packet'],
        'easy',
      ),
    ).toEqual([
      { kind: 'ship', shipType: 'corvette' },
      { kind: 'ship', shipType: 'corvette' },
      { kind: 'ship', shipType: 'packet' },
    ]);

    state.players[0].credits = 200;
    expect(
      buildAIFleetPurchases(
        state,
        0,
        ['corvette', 'corsair', 'frigate'],
        'normal',
      ),
    ).toEqual([
      { kind: 'ship', shipType: 'frigate' },
      { kind: 'ship', shipType: 'corvette' },
    ]);

    state.players[0].credits = 300;
    expect(
      buildAIFleetPurchases(state, 0, ['corsair', 'frigate'], 'hard'),
    ).toEqual([
      { kind: 'ship', shipType: 'frigate' },
      { kind: 'ship', shipType: 'frigate' },
    ]);
  });

  it('returns an error when the local player purchases are invalid', () => {
    const map = buildSolarSystemMap();
    const scenario = SCENARIOS.interplanetaryWar;
    const state = createGameOrThrow(
      scenario,
      map,
      asGameId('LOCAL'),
      findBaseHex,
    );
    state.players[0].credits = 2000;

    expect(
      resolveLocalFleetReady(
        state,
        0,
        [{ kind: 'ship', shipType: 'frigate' }, { kind: 'orbitalBaseCargo' }],
        map,
        scenario,
        'normal',
      ),
    ).toEqual({
      kind: 'error',
      error: 'Orbital base cargo requires an available transport or packet',
    });
  });

  it('resolves the local fleet-ready flow through both player submissions', () => {
    const map = buildSolarSystemMap();
    const scenario = SCENARIOS.interplanetaryWar;
    const state = createGameOrThrow(
      scenario,
      map,
      asGameId('LOCAL'),
      findBaseHex,
    );

    const initialPlayerShips = state.ships.filter(
      (ship) => ship.owner === 0,
    ).length;
    const initialAiShips = state.ships.filter(
      (ship) => ship.owner === 1,
    ).length;

    const result = resolveLocalFleetReady(
      state,
      0,
      [{ kind: 'ship', shipType: 'corvette' }],
      map,
      scenario,
      'easy',
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    expect(result.aiError).toBeUndefined();
    expect(result.state.phase).toBe('astrogation');
    expect(result.state.players[0].ready).toBe(true);
    expect(result.state.players[1].ready).toBe(true);

    expect(
      result.state.ships.filter((ship) => ship.owner === 0).length,
    ).toBeGreaterThan(initialPlayerShips);

    expect(
      result.state.ships.filter((ship) => ship.owner === 1).length,
    ).toBeGreaterThan(initialAiShips);
  });

  it('keeps the player result when the AI fleet-ready step fails', () => {
    const map = buildSolarSystemMap();
    const scenario: ScenarioDefinition = {
      ...SCENARIOS.interplanetaryWar,
      availableFleetPurchases: ['corvette', 'corsair'],
    };
    const state = createGameOrThrow(
      scenario,
      map,
      asGameId('LOCAL'),
      findBaseHex,
    );

    const processReady = vi
      .fn()
      .mockReturnValueOnce({ state })
      .mockReturnValueOnce({
        error: {
          code: ErrorCode.STATE_CONFLICT,
          message: 'AI fleet build failed',
        },
      });

    const buildAIPurchases = vi.fn((): FleetPurchase[] => [
      { kind: 'ship', shipType: 'corsair' },
    ]);

    expect(
      resolveLocalFleetReady(
        state,
        0,
        [{ kind: 'ship', shipType: 'corvette' }],
        map,
        scenario,
        'hard',
        {
          processReady,
          buildAIPurchases,
        },
      ),
    ).toEqual({
      kind: 'success',
      state,
      aiError: 'AI fleet build failed',
    });

    expect(processReady).toHaveBeenNthCalledWith(
      1,
      state,
      0,
      [{ kind: 'ship', shipType: 'corvette' }],
      map,
    );

    expect(processReady).toHaveBeenNthCalledWith(
      2,
      state,
      1,
      [{ kind: 'ship', shipType: 'corsair' }],
      map,
    );
  });

  it('lets the AI add a tanker in logistics-enabled fleet battles', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.interplanetaryWar,
      map,
      asGameId('SUPPORT-AI'),
      findBaseHex,
    );

    state.players[0].credits = 170;

    expect(
      buildAIFleetPurchases(
        state,
        0,
        ['frigate', 'tanker', 'corvette'],
        'normal',
      ),
    ).toEqual([
      { kind: 'ship', shipType: 'frigate' },
      { kind: 'ship', shipType: 'tanker' },
    ]);
  });
});
