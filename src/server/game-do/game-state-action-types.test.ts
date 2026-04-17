import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { ErrorCode } from '../../shared/types/domain';
import {
  createGameStateActionHandlers,
  GAME_STATE_ACTION_TYPES,
} from './actions';

describe('GAME_STATE_ACTION_TYPES registry', () => {
  it('defines a handler entry for every game-state action type', () => {
    const map = buildSolarSystemMap();
    const handlers = createGameStateActionHandlers({
      map,
      getScenario: async () => SCENARIOS.duel,
      getActionRng: async () => () => 0.5,
      publishStateChange: vi.fn().mockResolvedValue(undefined),
    });

    for (const actionType of GAME_STATE_ACTION_TYPES) {
      expect(handlers).toHaveProperty(actionType);
    }
  });

  it('expands shorthand surrender to eligible own ships', async () => {
    const map = buildSolarSystemMap();
    const handlers = createGameStateActionHandlers({
      map,
      getScenario: async () => SCENARIOS.biplanetary,
      getActionRng: async () => () => 0.5,
      publishStateChange: vi.fn().mockResolvedValue(undefined),
    });
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST-m1'),
      findBaseHex,
    );
    state.phase = 'astrogation';
    state.activePlayer = 0;
    state.scenarioRules.logisticsEnabled = true;

    const result = await handlers.surrender.run(state, 0, {
      type: 'surrender',
      shipIds: [],
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(
      result.state.ships.some(
        (ship) => ship.owner === 0 && ship.control === 'surrendered',
      ),
    ).toBe(true);
  });

  it('rejects shorthand surrender when no ships are eligible', async () => {
    const map = buildSolarSystemMap();
    const handlers = createGameStateActionHandlers({
      map,
      getScenario: async () => SCENARIOS.biplanetary,
      getActionRng: async () => () => 0.5,
      publishStateChange: vi.fn().mockResolvedValue(undefined),
    });
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST-m2'),
      findBaseHex,
    );
    state.phase = 'astrogation';
    state.activePlayer = 0;
    state.scenarioRules.logisticsEnabled = true;
    for (const ship of state.ships) {
      if (ship.owner === 0) {
        ship.lifecycle = 'destroyed';
      }
    }

    const result = await handlers.surrender.run(state, 0, {
      type: 'surrender',
      shipIds: [],
    });

    expect(result).toEqual({
      error: {
        code: ErrorCode.NOT_ALLOWED,
        message: 'No eligible ships available to surrender',
      },
    });
  });
});
