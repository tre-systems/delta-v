import { describe, expect, it } from 'vitest';

import { createGame } from '../shared/game-engine';
import { findBaseHex, getSolarSystemMap, SCENARIOS } from '../shared/map-data';
import type { GameState } from '../shared/types';
import { resolveTurnTimeoutOutcome } from './game-do-turns';

function createState(): GameState {
  return createGame(SCENARIOS.biplanetary, getSolarSystemMap(), 'TURN1', findBaseHex);
}

describe('game-do-turns', () => {
  it('auto-submits empty burns for timed-out astrogation turns', () => {
    const state = createState();

    const outcome = resolveTurnTimeoutOutcome(state, getSolarSystemMap());

    expect(outcome).not.toBeNull();
    expect(outcome?.primaryMessage?.type).toBe('movementResult');
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('resolves timed-out ordnance turns with the appropriate broadcast', () => {
    const state = createState();
    state.phase = 'ordnance';

    const outcome = resolveTurnTimeoutOutcome(state, getSolarSystemMap());

    expect(outcome).not.toBeNull();
    expect(outcome?.primaryMessage?.type).toMatch(/^(movementResult|stateUpdate)$/);
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('skips timed-out combat turns', () => {
    const state = createState();
    state.phase = 'combat';

    const outcome = resolveTurnTimeoutOutcome(state, getSolarSystemMap());

    expect(outcome).not.toBeNull();
    expect(outcome?.state.activePlayer).toBe(1);
  });

  it('returns null for phases without timeout automation', () => {
    const state = createState();
    state.phase = 'gameOver';

    expect(resolveTurnTimeoutOutcome(state, getSolarSystemMap())).toBeNull();
  });
});
