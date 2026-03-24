import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  attachRendererGameStateMirrorEffect,
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

  it('syncs renderer from mirror.gameState on attach and on change', () => {
    const mirror = createSessionReactiveMirror({
      gameState: null,
      state: 'menu',
    });
    const setGameState = vi.fn();
    const dispose = attachRendererGameStateMirrorEffect(mirror, {
      setGameState,
    });

    expect(setGameState).toHaveBeenCalledWith(null);
    setGameState.mockClear();

    const gs = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG2',
      findBaseHex,
    );
    mirror.gameState.value = gs;
    expect(setGameState).toHaveBeenCalledTimes(1);
    expect(setGameState).toHaveBeenCalledWith(gs);

    setGameState.mockClear();
    mirror.gameState.value = null;
    expect(setGameState).toHaveBeenCalledWith(null);

    dispose();
  });

  it('stops syncing renderer after dispose', () => {
    const mirror = createSessionReactiveMirror({
      gameState: null,
      state: 'menu',
    });
    const setGameState = vi.fn();
    const dispose = attachRendererGameStateMirrorEffect(mirror, {
      setGameState,
    });
    setGameState.mockClear();

    dispose();
    mirror.gameState.value = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG3',
      findBaseHex,
    );
    expect(setGameState).not.toHaveBeenCalled();
  });
});
