import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  attachSessionMirrorHudEffect,
  createSessionReactiveMirror,
} from './session-signals';

describe('session-signals', () => {
  it('notifies HUD effect when mirrored game or client state changes', () => {
    const mirror = createSessionReactiveMirror({
      gameState: null,
      state: 'menu',
    });
    const updateHUD = vi.fn();
    const dispose = attachSessionMirrorHudEffect(mirror, { updateHUD });

    expect(updateHUD.mock.calls.length).toBeGreaterThanOrEqual(1);

    updateHUD.mockClear();
    mirror.clientState.value = 'connecting';
    expect(updateHUD).toHaveBeenCalled();

    updateHUD.mockClear();
    const gs = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG1',
      findBaseHex,
    );
    mirror.gameState.value = gs;
    expect(updateHUD).toHaveBeenCalled();

    dispose();
  });

  it('notifies HUD when planning revision bumps', () => {
    const mirror = createSessionReactiveMirror({
      gameState: null,
      state: 'menu',
    });
    const updateHUD = vi.fn();
    const dispose = attachSessionMirrorHudEffect(mirror, { updateHUD });
    updateHUD.mockClear();

    mirror.planningRevision.update((n) => n + 1);
    expect(updateHUD).toHaveBeenCalled();

    dispose();
  });
});
