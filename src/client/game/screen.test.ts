import { describe, expect, it } from 'vitest';

import type { ClientState } from './phase';
import { deriveClientScreenPlan } from './screen';

describe('game-client-screen', () => {
  it('maps menu, connecting, fleet building, and game over states', () => {
    expect(deriveClientScreenPlan('menu')).toEqual({
      kind: 'menu',
    });

    expect(deriveClientScreenPlan('connecting')).toEqual({
      kind: 'connecting',
    });

    expect(deriveClientScreenPlan('playing_fleetBuilding')).toEqual({
      kind: 'fleetBuilding',
    });

    expect(deriveClientScreenPlan('gameOver')).toEqual({
      kind: 'none',
    });
  });

  it('maps all active play states to the HUD screen', () => {
    const states: ClientState[] = [
      'playing_astrogation',
      'playing_ordnance',
      'playing_logistics',
      'playing_combat',
      'playing_movementAnim',
      'playing_opponentTurn',
    ];

    for (const state of states) {
      expect(deriveClientScreenPlan(state)).toEqual({
        kind: 'hud',
      });
    }
  });

  it('shows waiting screen for waiting state', () => {
    expect(deriveClientScreenPlan('waitingForOpponent')).toEqual({
      kind: 'waiting',
    });
  });
});
