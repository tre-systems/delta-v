import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../shared/engine/game-engine';
import { hexKey } from '../../shared/hex';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createLogisticsStore } from './logistics-ui';
import { createInitialClientSession } from './session-model';
import {
  attachRendererGameStateEffect,
  attachSessionCombatButtonsEffect,
  attachSessionHudEffect,
  attachSessionLatencyEffect,
  attachSessionLogisticsPanelEffect,
  attachSessionPlanningSelectionEffect,
} from './session-signals';

describe('session-signals', () => {
  it('exposes signal-backed session properties', () => {
    const session = createInitialClientSession();

    expect(session.stateSignal.peek()).toBe('menu');
    expect(session.gameStateSignal.peek()).toBeNull();
    expect(session.isLocalGameSignal.peek()).toBe(false);
    expect(session.latencyMsSignal.peek()).toBe(-1);

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

    session.isLocalGame = true;
    session.latencyMs = 150;

    expect(session.isLocalGameSignal.peek()).toBe(true);
    expect(session.latencyMsSignal.peek()).toBe(150);
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

  it('syncs combat action buttons from session state and planning', () => {
    const session = createInitialClientSession();
    const showAttackButton = vi.fn();
    const showFireButton = vi.fn();
    const dispose = attachSessionCombatButtonsEffect(session, {
      showAttackButton,
      showFireButton,
    });

    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

    session.state = 'playing_combat';
    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

    session.planningState.applyCombatPlanUpdate({
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 2,
    });
    expect(showAttackButton).toHaveBeenLastCalledWith(true);
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

    session.planningState.queueCombatAttack({
      attackerIds: ['ship-0'],
      targetId: 'enemy',
      targetType: 'ship',
      attackStrength: 2,
    });
    expect(showFireButton).toHaveBeenLastCalledWith(true, 1);

    session.planningState.clearCombatSelectionState();
    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(true, 1);

    session.planningState.applyCombatPlanUpdate({
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 2,
    });
    session.state = 'playing_opponentTurn';
    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(false, 1);

    dispose();
  });

  it('syncs latency display from reactive session state', () => {
    const session = createInitialClientSession();
    const updateLatency = vi.fn();
    const dispose = attachSessionLatencyEffect(session, {
      updateLatency,
    });

    expect(updateLatency).toHaveBeenLastCalledWith(null);

    session.latencyMs = 275;
    expect(updateLatency).toHaveBeenLastCalledWith(275);

    session.isLocalGame = true;
    expect(updateLatency).toHaveBeenLastCalledWith(null);

    dispose();
  });

  it('syncs the logistics panel from session logistics state', () => {
    const session = createInitialClientSession();
    const renderLogisticsPanel = vi.fn();
    const dispose = attachSessionLogisticsPanelEffect(session, {
      renderLogisticsPanel,
    });

    expect(renderLogisticsPanel).toHaveBeenLastCalledWith(null);

    session.logisticsState = createLogisticsStore(
      createGame(SCENARIOS.duel, buildSolarSystemMap(), 'SIG5', findBaseHex),
      0,
    );
    expect(renderLogisticsPanel).toHaveBeenLastCalledWith(
      session.logisticsState,
    );

    session.logisticsState = null;
    expect(renderLogisticsPanel).toHaveBeenLastCalledWith(null);

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
