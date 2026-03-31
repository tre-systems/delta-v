// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap, SCENARIOS } from '../../shared/map-data';
import type { GameTransport } from './transport';

const mocks = vi.hoisted(() => ({
  beginJoinGameSession: vi.fn(),
  beginSpectateGameSession: vi.fn(),
  exitToMenuSession: vi.fn(),
  startLocalGameSession: vi.fn(),
  handleServerMessage: vi.fn(),
}));

vi.mock('./session-controller', () => ({
  beginJoinGameSession: mocks.beginJoinGameSession,
  beginSpectateGameSession: mocks.beginSpectateGameSession,
  exitToMenuSession: mocks.exitToMenuSession,
  startLocalGameSession: mocks.startLocalGameSession,
}));

vi.mock('./message-handler', () => ({
  handleServerMessage: mocks.handleServerMessage,
}));

import {
  beginJoinGameFromMain,
  beginSpectateGameFromMain,
  exitToMenuFromMain,
  handleServerMessageFromMain,
  type MainNetworkDeps,
  startLocalGameFromMain,
} from './main-session-network';

const createTransport = (): GameTransport => ({
  submitAstrogation: vi.fn(),
  submitCombat: vi.fn(),
  submitSingleCombat: vi.fn(),
  endCombat: vi.fn(),
  submitOrdnance: vi.fn(),
  submitEmplacement: vi.fn(),
  submitFleetReady: vi.fn(),
  submitLogistics: vi.fn(),
  submitSurrender: vi.fn(),
  skipOrdnance: vi.fn(),
  skipCombat: vi.fn(),
  skipLogistics: vi.fn(),
  beginCombat: vi.fn(),
  requestRematch: vi.fn(),
  sendChat: vi.fn(),
});

const createDeps = (): MainNetworkDeps => ({
  ctx: {
    aiDifficulty: 'normal',
  } as unknown as MainNetworkDeps['ctx'],
  map: buildSolarSystemMap(),
  renderer: {
    clearTrails: vi.fn(),
  } as unknown as MainNetworkDeps['renderer'],
  ui: {
    overlay: {
      hideGameOver: vi.fn(),
      showToast: vi.fn(),
    },
    log: {
      setLocalGame: vi.fn(),
      clear: vi.fn(),
      setChatEnabled: vi.fn(),
      logText: vi.fn(),
    },
  } as unknown as MainNetworkDeps['ui'],
  hud: {
    logScenarioBriefing: vi.fn(),
  } as unknown as MainNetworkDeps['hud'],
  actionDeps: {} as unknown as MainNetworkDeps['actionDeps'],
  turnTelemetry: {
    reset: vi.fn(),
  } as unknown as MainNetworkDeps['turnTelemetry'],
  sessionApi: {
    getStoredPlayerToken: vi.fn(() => 'stored-token'),
    storePlayerToken: vi.fn(),
    validateJoin: vi.fn(async () => ({ ok: true, value: null })),
  } as unknown as MainNetworkDeps['sessionApi'],
  connection: {
    connect: vi.fn(),
    stopPing: vi.fn(),
    close: vi.fn(),
  } as unknown as MainNetworkDeps['connection'],
  setState: vi.fn(),
  applyGameState: vi.fn(),
  transitionToPhase: vi.fn(),
  onAnimationComplete: vi.fn(),
  runLocalAI: vi.fn(),
  track: vi.fn(),
  createLocalTransport: vi.fn(() => createTransport()),
  stopTurnTimer: vi.fn(),
});

describe('main-session-network', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds local session deps through one adapter', () => {
    const deps = createDeps();

    startLocalGameFromMain(deps, 'missing-scenario');

    expect(deps.ui.overlay.hideGameOver).toHaveBeenCalledOnce();
    expect(deps.ui.log.setLocalGame).toHaveBeenCalledWith(true);
    expect(mocks.startLocalGameSession).toHaveBeenCalledWith(
      expect.any(Object),
      'missing-scenario',
    );

    const localDeps = mocks.startLocalGameSession.mock.calls[0]?.[0];
    if (!localDeps) {
      throw new Error('Expected local session deps');
    }

    expect(localDeps.getScenarioName('missing-scenario')).toBe(
      SCENARIOS.biplanetary.name,
    );
    expect(localDeps.createLocalTransport()).toEqual(expect.any(Object));
    expect(deps.createLocalTransport).toHaveBeenCalledOnce();

    localDeps.resetTurnTelemetry();
    localDeps.clearTrails();
    localDeps.clearLog();
    localDeps.setChatEnabled(false);
    localDeps.logText('hello');
    localDeps.trackGameCreated({
      scenario: 'duel',
      mode: 'local',
      difficulty: 'normal',
    });
    localDeps.applyGameState({ gameId: 'GAME' });
    localDeps.logScenarioBriefing();
    localDeps.setState('playing_astrogation');
    localDeps.runLocalAI();

    expect(deps.turnTelemetry.reset).toHaveBeenCalledOnce();
    expect(deps.renderer.clearTrails).toHaveBeenCalledOnce();
    expect(deps.ui.log.clear).toHaveBeenCalledOnce();
    expect(deps.ui.log.setChatEnabled).toHaveBeenCalledWith(false);
    expect(deps.ui.log.logText).toHaveBeenCalledWith('hello');
    expect(deps.track).toHaveBeenCalledWith('game_created', {
      scenario: 'duel',
      mode: 'local',
      difficulty: 'normal',
    });
    expect(deps.applyGameState).toHaveBeenCalledWith({ gameId: 'GAME' });
    expect(deps.hud.logScenarioBriefing).toHaveBeenCalledOnce();
    expect(deps.setState).toHaveBeenCalledWith('playing_astrogation');
    expect(deps.runLocalAI).toHaveBeenCalledOnce();
  });

  it('reuses the shared remote-session bridge for spectating', () => {
    const deps = createDeps();
    const replaceState = vi
      .spyOn(history, 'replaceState')
      .mockImplementation(() => {});

    beginSpectateGameFromMain(deps, 'ROOM1');

    expect(mocks.beginSpectateGameSession).toHaveBeenCalledWith(
      expect.any(Object),
      'ROOM1',
    );

    const spectateDeps = mocks.beginSpectateGameSession.mock.calls[0]?.[0];
    if (!spectateDeps) {
      throw new Error('Expected spectate session deps');
    }

    spectateDeps.resetTurnTelemetry();
    spectateDeps.replaceRoute('/?code=ROOM1');
    spectateDeps.connect('ROOM1');
    spectateDeps.setState('connecting');

    expect(deps.turnTelemetry.reset).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?code=ROOM1');
    expect(spectateDeps.buildGameRoute('ROOM1')).toBe('/?code=ROOM1');
    expect(deps.connection.connect).toHaveBeenCalledWith('ROOM1');
    expect(deps.setState).toHaveBeenCalledWith('connecting');
  });

  it('reuses the shared remote-session bridge for joining', async () => {
    const deps = createDeps();

    beginJoinGameFromMain(deps, 'ROOM2', 'player-token');

    expect(deps.ui.log.setLocalGame).toHaveBeenCalledWith(false);
    expect(mocks.beginJoinGameSession).toHaveBeenCalledWith(
      expect.any(Object),
      'ROOM2',
      'player-token',
    );

    const joinDeps = mocks.beginJoinGameSession.mock.calls[0]?.[0];
    if (!joinDeps) {
      throw new Error('Expected join session deps');
    }

    expect(joinDeps.getStoredPlayerToken('ROOM2')).toBe('stored-token');
    joinDeps.storePlayerToken('ROOM2', 'new-token');
    await expect(
      joinDeps.validateJoin('ROOM2', 'player-token'),
    ).resolves.toEqual({
      ok: true,
      value: null,
    });
    joinDeps.showToast('toast', 'info');
    joinDeps.exitToMenu();

    expect(deps.sessionApi.getStoredPlayerToken).toHaveBeenCalledWith('ROOM2');
    expect(deps.sessionApi.storePlayerToken).toHaveBeenCalledWith(
      'ROOM2',
      'new-token',
    );
    expect(deps.sessionApi.validateJoin).toHaveBeenCalledWith(
      'ROOM2',
      'player-token',
    );
    expect(deps.ui.overlay.showToast).toHaveBeenCalledWith('toast', 'info');
    expect(mocks.exitToMenuSession).toHaveBeenCalledOnce();
  });

  it('builds exit-to-menu deps through one adapter', () => {
    const deps = createDeps();
    const replaceState = vi
      .spyOn(history, 'replaceState')
      .mockImplementation(() => {});

    exitToMenuFromMain(deps);

    expect(mocks.exitToMenuSession).toHaveBeenCalledWith(expect.any(Object));

    const exitDeps = mocks.exitToMenuSession.mock.calls[0]?.[0];
    if (!exitDeps) {
      throw new Error('Expected exit session deps');
    }

    exitDeps.stopPing();
    exitDeps.stopTurnTimer();
    exitDeps.closeConnection();
    exitDeps.resetTurnTelemetry();
    exitDeps.replaceRoute('/');
    exitDeps.setState('menu');

    expect(deps.connection.stopPing).toHaveBeenCalledOnce();
    expect(deps.stopTurnTimer).toHaveBeenCalledOnce();
    expect(deps.connection.close).toHaveBeenCalledOnce();
    expect(deps.turnTelemetry.reset).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(deps.setState).toHaveBeenCalledWith('menu');
  });

  it('only runs the game-over hook for game-over messages', () => {
    const handlerDeps = { name: 'handler-deps' } as never;
    const onGameOver = vi.fn();

    handleServerMessageFromMain(
      handlerDeps,
      { type: 'chat', playerId: 0, text: 'hello' },
      onGameOver,
    );
    handleServerMessageFromMain(
      handlerDeps,
      { type: 'gameOver', winner: 0, reason: 'done' },
      onGameOver,
    );

    expect(mocks.handleServerMessage).toHaveBeenNthCalledWith(1, handlerDeps, {
      type: 'chat',
      playerId: 0,
      text: 'hello',
    });
    expect(mocks.handleServerMessage).toHaveBeenNthCalledWith(2, handlerDeps, {
      type: 'gameOver',
      winner: 0,
      reason: 'done',
    });
    expect(onGameOver).toHaveBeenCalledOnce();
  });
});
