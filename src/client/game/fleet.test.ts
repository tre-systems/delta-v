import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
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
    expect(
      buildAIFleetPurchases(100, ['corvette', 'corsair', 'packet'], 'easy'),
    ).toEqual([
      { shipType: 'corvette' },
      { shipType: 'corvette' },
      { shipType: 'packet' },
    ]);

    expect(
      buildAIFleetPurchases(200, ['corvette', 'corsair', 'frigate'], 'normal'),
    ).toEqual([
      { shipType: 'corsair' },
      { shipType: 'corsair' },
      { shipType: 'corvette' },
    ]);

    expect(buildAIFleetPurchases(300, ['corsair', 'frigate'], 'hard')).toEqual([
      { shipType: 'frigate' },
      { shipType: 'frigate' },
    ]);
  });

  it('returns an error when the local player purchases are invalid', () => {
    const map = buildSolarSystemMap();
    const scenario = SCENARIOS.interplanetaryWar;
    const state = createGame(scenario, map, 'LOCAL', findBaseHex);

    expect(
      resolveLocalFleetReady(
        state,
        0,
        [{ shipType: 'orbitalBase' }],
        map,
        scenario,
        'normal',
      ),
    ).toEqual({
      kind: 'error',
      error:
        'Cannot purchase orbital bases directly — buy a transport and base cargo',
    });
  });

  it('resolves the local fleet-ready flow through both player submissions', () => {
    const map = buildSolarSystemMap();
    const scenario = SCENARIOS.interplanetaryWar;
    const state = createGame(scenario, map, 'LOCAL', findBaseHex);

    const initialPlayerShips = state.ships.filter(
      (ship) => ship.owner === 0,
    ).length;
    const initialAiShips = state.ships.filter(
      (ship) => ship.owner === 1,
    ).length;

    const result = resolveLocalFleetReady(
      state,
      0,
      [{ shipType: 'corvette' }],
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
      availableShipTypes: ['corvette', 'corsair'],
    };
    const state = createGame(scenario, map, 'LOCAL', findBaseHex);

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
      { shipType: 'corsair' },
    ]);

    expect(
      resolveLocalFleetReady(
        state,
        0,
        [{ shipType: 'corvette' }],
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
      [{ shipType: 'corvette' }],
      map,
      scenario.availableShipTypes,
    );

    expect(processReady).toHaveBeenNthCalledWith(
      2,
      state,
      1,
      [{ shipType: 'corsair' }],
      map,
      scenario.availableShipTypes,
    );
  });
});
