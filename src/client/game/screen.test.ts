import { describe, expect, it } from 'vitest';

import type { ClientState } from './phase';
import { deriveClientScreenPlan } from './screen';

describe('game-client-screen', () => {
  it('maps menu, connecting, fleet building, and game over states', () => {
    expect(deriveClientScreenPlan('menu', null, null, null, 'https://delta-v.example')).toEqual({
      kind: 'menu',
    });
    expect(deriveClientScreenPlan('connecting', null, null, null, 'https://delta-v.example')).toEqual({
      kind: 'connecting',
    });
    expect(deriveClientScreenPlan('playing_fleetBuilding', null, null, null, 'https://delta-v.example')).toEqual({
      kind: 'fleetBuilding',
    });
    expect(deriveClientScreenPlan('gameOver', 'ABCDE', null, 'invite', 'https://delta-v.example')).toEqual({
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
      expect(deriveClientScreenPlan(state, null, null, null, 'https://delta-v.example')).toEqual({
        kind: 'hud',
      });
    }
  });

  it('recovers or preserves invite links on the waiting screen', () => {
    expect(
      deriveClientScreenPlan('waitingForOpponent', 'ABCDE', null, 'invite-token', 'https://delta-v.example'),
    ).toEqual({
      kind: 'waiting',
      code: 'ABCDE',
      inviteLink: 'https://delta-v.example/?code=ABCDE&playerToken=invite-token',
    });

    expect(
      deriveClientScreenPlan(
        'waitingForOpponent',
        'ABCDE',
        'https://saved.example/invite',
        'invite-token',
        'https://delta-v.example',
      ),
    ).toEqual({
      kind: 'waiting',
      code: 'ABCDE',
      inviteLink: 'https://saved.example/invite',
    });

    expect(deriveClientScreenPlan('waitingForOpponent', null, null, null, 'https://delta-v.example')).toEqual({
      kind: 'waiting',
      code: '',
      inviteLink: null,
    });
  });
});
