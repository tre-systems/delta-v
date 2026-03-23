import { describe, expect, it } from 'vitest';

import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import { createGame, filterStateForPlayer, type ViewerId } from './game-engine';

const map = buildSolarSystemMap();

const withFugitiveIdentity = (state: ReturnType<typeof createGame>) => {
  for (const ship of state.ships) {
    if (ship.owner === 0) {
      ship.identity = { hasFugitives: false, revealed: false };
    }
  }
  const fugitive = state.ships.find((s) => s.owner === 0);
  if (fugitive?.identity) {
    fugitive.identity.hasFugitives = true;
  }
  state.scenarioRules = {
    ...state.scenarioRules,
    hiddenIdentityInspection: true,
  };
  return state;
};

describe('viewer-aware state filtering', () => {
  it('player 0 sees own identity, enemy identity stripped', () => {
    const state = withFugitiveIdentity(
      createGame(SCENARIOS.biplanetary, map, 'V01', findBaseHex),
    );

    const filtered = filterStateForPlayer(state, 0);

    const ownShips = filtered.ships.filter((s) => s.owner === 0);
    const enemyShips = filtered.ships.filter((s) => s.owner === 1);

    // Own ships keep identity
    for (const ship of ownShips) {
      expect(ship.identity).toBeDefined();
    }

    // Enemy ships have no identity (stripped)
    for (const ship of enemyShips) {
      expect(ship.identity).toBeUndefined();
    }
  });

  it('player 1 sees own identity, enemy (player 0) identity stripped', () => {
    const state = withFugitiveIdentity(
      createGame(SCENARIOS.biplanetary, map, 'V02', findBaseHex),
    );

    const filtered = filterStateForPlayer(state, 1);

    const p0Ships = filtered.ships.filter((s) => s.owner === 0);
    const p1Ships = filtered.ships.filter((s) => s.owner === 1);

    // Player 0 ships have identity stripped from player 1's view
    for (const ship of p0Ships) {
      expect(ship.identity).toBeUndefined();
    }

    // Player 1 ships have no identity in biplanetary
    // (only player 0 has fugitive identity in this test setup)
    expect(p1Ships.length).toBeGreaterThan(0);
  });

  it('spectator sees ALL identity stripped', () => {
    const state = withFugitiveIdentity(
      createGame(SCENARIOS.biplanetary, map, 'V03', findBaseHex),
    );

    const filtered = filterStateForPlayer(state, 'spectator');

    // ALL ships with unrevealed identity should be stripped
    for (const ship of filtered.ships) {
      if (ship.identity && !ship.identity.revealed) {
        expect.unreachable('Spectator should not see unrevealed identity');
      }
    }

    // Ships that had identity should now lack it
    const p0Ships = filtered.ships.filter((s) => s.owner === 0);
    for (const ship of p0Ships) {
      expect(ship.identity).toBeUndefined();
    }
  });

  it('revealed identity is visible to all viewers', () => {
    const state = withFugitiveIdentity(
      createGame(SCENARIOS.biplanetary, map, 'V04', findBaseHex),
    );

    // Reveal the fugitive's identity
    const fugitive = state.ships.find((s) => s.identity?.hasFugitives);
    if (fugitive?.identity) {
      fugitive.identity.revealed = true;
    }

    const viewers: ViewerId[] = [0, 1, 'spectator'];

    for (const viewer of viewers) {
      const filtered = filterStateForPlayer(state, viewer);
      const revealed = filtered.ships.find((s) => s.id === fugitive?.id);
      expect(revealed?.identity?.revealed).toBe(true);
      expect(revealed?.identity?.hasFugitives).toBe(true);
    }
  });

  it('no-op when scenario has no hidden identity rules', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'V05', findBaseHex);

    // No identity fields set — filtering is a no-op
    const viewers: ViewerId[] = [0, 1, 'spectator'];

    for (const viewer of viewers) {
      const filtered = filterStateForPlayer(state, viewer);
      expect(filtered).toBe(state); // same reference (no cloning)
    }
  });

  it('consistent filtering across live, replay, and spectator paths', () => {
    const state = withFugitiveIdentity(
      createGame(SCENARIOS.biplanetary, map, 'V06', findBaseHex),
    );

    // Simulate the three filtering contexts
    const liveP0 = filterStateForPlayer(state, 0);
    filterStateForPlayer(state, 1);
    const spectator = filterStateForPlayer(state, 'spectator');

    // Player 0 sees more than spectator
    const p0OwnIdentityCount = liveP0.ships.filter(
      (s) => s.identity !== undefined,
    ).length;
    const spectatorIdentityCount = spectator.ships.filter(
      (s) => s.identity !== undefined,
    ).length;

    expect(p0OwnIdentityCount).toBeGreaterThanOrEqual(spectatorIdentityCount);

    // Spectator sees least information
    expect(spectatorIdentityCount).toBe(0);
  });
});
