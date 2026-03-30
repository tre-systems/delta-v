import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createInitialClientSession } from './session-model';
import {
  attachRendererGameStateEffect,
  attachSessionHudEffect,
} from './session-signals';

describe('session-signals', () => {
  it('exposes signal-backed session properties', () => {
    const session = createInitialClientSession();

    expect(session.stateSignal.peek()).toBe('menu');
    expect(session.gameStateSignal.peek()).toBeNull();

    session.state = 'connecting';

    expect(session.stateSignal.peek()).toBe('connecting');

    const gameState = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG0',
      findBaseHex,
    );
    session.gameState = gameState;

    expect(session.gameStateSignal.peek()).toBe(gameState);
  });

  it('notifies HUD effect when session game or client state changes', () => {
    const session = createInitialClientSession();
    const updateHUD = vi.fn();
    const dispose = attachSessionHudEffect(session, {
      updateHUD,
    });

    expect(updateHUD.mock.calls.length).toBeGreaterThanOrEqual(1);

    updateHUD.mockClear();
    session.state = 'connecting';
    expect(updateHUD).toHaveBeenCalled();

    updateHUD.mockClear();
    session.gameState = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG1',
      findBaseHex,
    );
    expect(updateHUD).toHaveBeenCalled();

    dispose();
  });

  it('notifies HUD when planning changes', () => {
    const session = createInitialClientSession();
    const updateHUD = vi.fn();
    const dispose = attachSessionHudEffect(session, {
      updateHUD,
    });
    updateHUD.mockClear();

    session.planningState.setSelectedShipId('ship-1');
    expect(updateHUD).toHaveBeenCalled();

    dispose();
  });

  it('syncs renderer from session.gameState on attach and on change', () => {
    const session = createInitialClientSession();
    const setGameState = vi.fn();
    const dispose = attachRendererGameStateEffect(session, {
      setGameState,
    });

    expect(setGameState).toHaveBeenCalledWith(null);
    setGameState.mockClear();

    const gameState = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG2',
      findBaseHex,
    );
    session.gameState = gameState;
    expect(setGameState).toHaveBeenCalledTimes(1);
    expect(setGameState).toHaveBeenCalledWith(gameState);

    setGameState.mockClear();
    session.gameState = null;
    expect(setGameState).toHaveBeenCalledWith(null);

    dispose();
  });

  it('stops syncing renderer after dispose', () => {
    const session = createInitialClientSession();
    const setGameState = vi.fn();
    const dispose = attachRendererGameStateEffect(session, {
      setGameState,
    });
    setGameState.mockClear();

    dispose();
    session.gameState = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG3',
      findBaseHex,
    );
    expect(setGameState).not.toHaveBeenCalled();
  });
});
