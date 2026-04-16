import { describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap, SCENARIOS } from '../../shared/map-data';
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
});
