import { describe, expect, it } from 'vitest';

import type { ClientState } from './phase';
import { deriveClientScreenPlan } from './screen';

describe('game-client-screen', () => {
  it('maps menu, connecting, fleet building, and game over states', () => {
    expect(deriveClientScreenPlan('menu', null)).toEqual({
      kind: 'menu',
    });

    expect(deriveClientScreenPlan('connecting', null)).toEqual({
      kind: 'connecting',
    });

    expect(deriveClientScreenPlan('playing_fleetBuilding', null)).toEqual({
      kind: 'fleetBuilding',
    });

    expect(deriveClientScreenPlan('gameOver', 'ABCDE')).toEqual({
      kind: 'none',
    });
  });

  it('maps all active play states to the HUD screen', () => {
    const states: ClientState[] = [
      'playing_astrogation',
      'playing_ordnance',
      'playing_combat',
      'playing_movementAnim',
      'playing_opponentTurn',
    ];

    for (const state of states) {
      expect(deriveClientScreenPlan(state, null)).toEqual({
        kind: 'hud',
      });
    }
  });

  it('shows waiting screen with code', () => {
    expect(deriveClientScreenPlan('waitingForOpponent', 'ABCDE')).toEqual({
      kind: 'waiting',
      code: 'ABCDE',
    });

    expect(deriveClientScreenPlan('waitingForOpponent', null)).toEqual({
      kind: 'waiting',
      code: '',
    });
  });
});
