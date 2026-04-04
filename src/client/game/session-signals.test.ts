import { describe, expect, it, vi } from 'vitest';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { hexKey } from '../../shared/hex';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createLogisticsStore } from './logistics-store';
import { createInitialClientSession } from './session-model';
import {
  attachMainSessionEffects,
  attachRendererGameStateEffect,
  attachSessionCombatButtonsEffect,
  attachSessionFleetPanelEffect,
  attachSessionHudEffect,
  attachSessionLatencyEffect,
  attachSessionLogisticsPanelEffect,
  attachSessionPlanningSelectionEffect,
  attachSessionPlayerIdentityEffect,
  attachSessionWaitingScreenEffect,
} from './session-signals';

describe('session-signals', () => {
  it('exposes signal-backed session properties', () => {
    const session = createInitialClientSession();

    expect(session.stateSignal.peek()).toBe('menu');
    expect(session.playerIdSignal.peek()).toBe(-1);
    expect(session.gameCodeSignal.peek()).toBeNull();
    expect(session.gameStateSignal.peek()).toBeNull();
    expect(session.isLocalGameSignal.peek()).toBe(false);
    expect(session.latencyMsSignal.peek()).toBe(-1);

    session.state = 'connecting';

    expect(session.stateSignal.peek()).toBe('connecting');

    const gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG0'),
      findBaseHex,
    );
    session.gameState = gameState;
    session.playerId = 0;
    session.gameCode = 'SIG0';

    expect(session.gameStateSignal.peek()).toBe(gameState);
    expect(session.playerIdSignal.peek()).toBe(0);
    expect(session.gameCodeSignal.peek()).toBe('SIG0');

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
    session.gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG1'),
      findBaseHex,
    );
    expect(updateHUD).toHaveBeenCalled();

    dispose();
  });

  it('bundles main session effects behind a single disposer', () => {
    const session = createInitialClientSession();
    const deps = {
      renderer: {
        setPlayerId: vi.fn(),
        setGameState: vi.fn(),
      },
      ui: {
        setPlayerId: vi.fn(),
        showAttackButton: vi.fn(),
        showFireButton: vi.fn(),
        setWaitingState: vi.fn(),
        updateLatency: vi.fn(),
        updateFleetStatus: vi.fn(),
        updateShipList: vi.fn(),
        bindClientStateSignal: vi.fn(),
      },
      hud: {
        updateHUD: vi.fn(),
      },
      logistics: {
        renderLogisticsPanel: vi.fn(),
      },
    };
    const dispose = attachMainSessionEffects(session, deps);

    expect(deps.renderer.setPlayerId).toHaveBeenLastCalledWith(-1);
    expect(deps.ui.setPlayerId).toHaveBeenLastCalledWith(-1);
    expect(deps.ui.showAttackButton).toHaveBeenLastCalledWith(false);
    expect(deps.ui.showFireButton).toHaveBeenLastCalledWith(false, 0);
    expect(deps.ui.setWaitingState).toHaveBeenLastCalledWith(null, false);
    expect(deps.ui.updateLatency).toHaveBeenLastCalledWith(null);
    expect(deps.ui.updateFleetStatus).toHaveBeenLastCalledWith('');
    expect(deps.ui.updateShipList).toHaveBeenLastCalledWith(
      [],
      null,
      expect.any(Map),
    );
    expect(deps.logistics.renderLogisticsPanel).toHaveBeenLastCalledWith(null);
    expect(deps.renderer.setGameState).toHaveBeenLastCalledWith(null);
    expect(deps.hud.updateHUD).toHaveBeenCalled();

    vi.clearAllMocks();
    dispose();

    session.state = 'playing_astrogation';
    session.playerId = 0;
    session.gameCode = 'ROOM2';
    session.latencyMs = 90;
    session.gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG7'),
      findBaseHex,
    );
    session.logisticsState = createLogisticsStore(session.gameState, 0);

    expect(session.planningState.selectedShipId).toBeNull();
    expect(deps.renderer.setPlayerId).not.toHaveBeenCalled();
    expect(deps.ui.setPlayerId).not.toHaveBeenCalled();
    expect(deps.ui.showAttackButton).not.toHaveBeenCalled();
    expect(deps.ui.showFireButton).not.toHaveBeenCalled();
    expect(deps.ui.setWaitingState).not.toHaveBeenCalled();
    expect(deps.ui.updateLatency).not.toHaveBeenCalled();
    expect(deps.ui.updateFleetStatus).not.toHaveBeenCalled();
    expect(deps.ui.updateShipList).not.toHaveBeenCalled();
    expect(deps.logistics.renderLogisticsPanel).not.toHaveBeenCalled();
    expect(deps.renderer.setGameState).not.toHaveBeenCalled();
    expect(deps.hud.updateHUD).not.toHaveBeenCalled();
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
    session.gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG4'),
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

  it('syncs renderer and UI identity from reactive player id', () => {
    const session = createInitialClientSession();
    const setRendererPlayerId = vi.fn();
    const setUIPlayerId = vi.fn();
    const dispose = attachSessionPlayerIdentityEffect(session, {
      renderer: { setPlayerId: setRendererPlayerId },
      ui: { setPlayerId: setUIPlayerId },
    });

    expect(setRendererPlayerId).toHaveBeenLastCalledWith(-1);
    expect(setUIPlayerId).toHaveBeenLastCalledWith(-1);

    session.playerId = 1;
    expect(setRendererPlayerId).toHaveBeenLastCalledWith(1);
    expect(setUIPlayerId).toHaveBeenLastCalledWith(1);

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
    // No ship selected yet — fire button hidden to avoid "END COMBAT" flash
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

    session.planningState.applyCombatPlanUpdate({
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0'],
      combatAttackStrength: 2,
    });
    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(true, 1);

    session.planningState.clearCombatSelectionState();
    // Between attacks — button hidden during dice animation transition
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

    session.state = 'playing_opponentTurn';
    expect(showAttackButton).toHaveBeenLastCalledWith(false);
    expect(showFireButton).toHaveBeenLastCalledWith(false, 0);

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

  it('syncs waiting screen copy from reactive session state', () => {
    const session = createInitialClientSession();
    const setWaitingState = vi.fn();
    const dispose = attachSessionWaitingScreenEffect(session, {
      setWaitingState,
    });

    expect(setWaitingState).toHaveBeenLastCalledWith(null, false);

    session.state = 'connecting';
    expect(setWaitingState).toHaveBeenLastCalledWith(null, true);

    session.gameCode = 'ROOM1';
    session.state = 'waitingForOpponent';
    expect(setWaitingState).toHaveBeenLastCalledWith('ROOM1', false);

    dispose();
  });

  it('syncs fleet status and ship list from reactive session state', () => {
    const session = createInitialClientSession();
    const updateFleetStatus = vi.fn();
    const updateShipList = vi.fn();
    const dispose = attachSessionFleetPanelEffect(session, {
      updateFleetStatus,
      updateShipList,
    });

    expect(updateFleetStatus).toHaveBeenLastCalledWith('');
    expect(updateShipList).toHaveBeenLastCalledWith([], null, expect.any(Map));

    session.playerId = 0;
    session.gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG6'),
      findBaseHex,
    );

    expect(updateFleetStatus).toHaveBeenLastCalledWith('');
    expect(updateShipList).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ owner: 0 })]),
      expect.any(String),
      session.planningState.burns,
    );

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
      createGameOrThrow(
        SCENARIOS.duel,
        buildSolarSystemMap(),
        asGameId('SIG5'),
        findBaseHex,
      ),
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

    const gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG2'),
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
    session.gameState = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SIG3'),
      findBaseHex,
    );
    expect(setGameState).not.toHaveBeenCalled();
  });
});
