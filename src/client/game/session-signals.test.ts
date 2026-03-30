import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../shared/engine/game-engine';
import { hexKey } from '../../shared/hex';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createInitialClientSession } from './session-model';
import {
  attachRendererGameStateEffect,
  attachSessionCombatAttackButtonEffect,
  attachSessionHudEffect,
  attachSessionPlanningSelectionEffect,
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

  it('reconciles planning selection from derived session state', () => {
    const session = createInitialClientSession();
    session.playerId = 0;
    session.state = 'playing_astrogation';
    session.gameState = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SIG4',
      findBaseHex,
    );
    const selectedShip = session.gameState.ships.find(
      (ship) => ship.owner === 0,
    );

    if (!selectedShip) {
      throw new Error('Expected duel scenario to provide a player ship');
    }

    const dispose = attachSessionPlanningSelectionEffect(session);

    expect(session.planningState.selectedShipId).toBe(selectedShip.id);
    expect(session.planningState.lastSelectedHex).toBe(
      hexKey(selectedShip.position),
    );

    session.planningState.setSelectedShipId(null);
    expect(session.planningState.selectedShipId).toBe(selectedShip.id);

    dispose();
  });

  it('syncs combat attack button visibility from session state and planning', () => {
    const session = createInitialClientSession();
    const showAttackButton = vi.fn();
    const dispose = attachSessionCombatAttackButtonEffect(session, {
      showAttackButton,
    });

    expect(showAttackButton).toHaveBeenLastCalledWith(false);

    session.state = 'playing_combat';
    expect(showAttackButton).toHaveBeenLastCalledWith(false);

    session.planningState.applyCombatPlanUpdate({
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 2,
    });
    expect(showAttackButton).toHaveBeenLastCalledWith(true);

    session.planningState.clearCombatSelectionState();
    expect(showAttackButton).toHaveBeenLastCalledWith(false);

    session.planningState.applyCombatPlanUpdate({
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 2,
    });
    session.state = 'playing_opponentTurn';
    expect(showAttackButton).toHaveBeenLastCalledWith(false);

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
