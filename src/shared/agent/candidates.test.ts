import { describe, expect, it } from 'vitest';

import { createGameOrThrow, processAstrogation } from '../engine/game-engine';
import { asGameId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import { buildCandidates, buildIdleAstrogationOrders } from './candidates';

describe('agent candidates', () => {
  it('omits emplaced orbital bases from idle astrogation orders', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CAND1'),
      findBaseHex,
    );
    const playerId = state.activePlayer;
    const ship = state.ships.find((candidate) => candidate.owner === playerId);
    if (!ship) throw new Error('Expected active player ship');
    ship.baseStatus = 'emplaced';

    expect(buildIdleAstrogationOrders(state, playerId)).toEqual([]);

    const candidates = buildCandidates(state, playerId, map).filter(
      (candidate) => candidate.type === 'astrogation',
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.orders).not.toContainEqual(
        expect.objectContaining({ shipId: ship.id }),
      );
      const result = processAstrogation(
        state,
        playerId,
        candidate.orders,
        map,
        () => 0.5,
      );
      expect('error' in result).toBe(false);
    }
  });
});
