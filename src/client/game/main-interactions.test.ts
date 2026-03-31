import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameCommand } from './commands';
import { createMainInteractionController } from './main-interactions';
import type { MainNetworkDeps } from './main-session-network';
import type { GameTransport } from './transport';

const mocks = vi.hoisted(() => ({
  dispatchGameCommand: vi.fn(),
  keyboardActionToCommand: vi.fn(),
  interpretInput: vi.fn(),
  resolveUIEventPlan: vi.fn(),
  beginJoinGameFromMain: vi.fn(),
  beginSpectateGameFromMain: vi.fn(),
  startLocalGameFromMain: vi.fn(),
}));

vi.mock('./command-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./command-router')>();

  return {
    ...actual,
    dispatchGameCommand: mocks.dispatchGameCommand,
  };
});

vi.mock('./commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commands')>();

  return {
    ...actual,
    keyboardActionToCommand: mocks.keyboardActionToCommand,
  };
});

vi.mock('./input-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./input-events')>();

  return {
    ...actual,
    interpretInput: mocks.interpretInput,
  };
});

vi.mock('./ui-event-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ui-event-router')>();

  return {
    ...actual,
    resolveUIEventPlan: mocks.resolveUIEventPlan,
  };
});

vi.mock('./main-session-network', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./main-session-network')>();

  return {
    ...actual,
    beginJoinGameFromMain: mocks.beginJoinGameFromMain,
    beginSpectateGameFromMain: mocks.beginSpectateGameFromMain,
    startLocalGameFromMain: mocks.startLocalGameFromMain,
  };
});

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

const createController = () => {
  let currentState:
    | 'menu'
    | 'playing_astrogation'
    | 'playing_fleetBuilding'
    | 'playing_movementAnim' = 'playing_astrogation';
  let currentGameState = { gameId: 'GAME1' } as object | null;
  const transport = createTransport();
  const planningState = { id: 'planning-state' };
  const mainNetworkDeps = { id: 'network-deps' } as unknown as MainNetworkDeps;
  const ctx = {
    stateSignal: { peek: vi.fn(() => currentState) },
    gameStateSignal: { peek: vi.fn(() => currentGameState) },
    logisticsStateSignal: { peek: vi.fn(() => null) },
    planningState,
    playerId: 0,
    transport,
    isLocalGame: false,
  };
  const actionDeps = {
    astrogationDeps: { id: 'astrogation-deps' },
    combatDeps: { id: 'combat-deps' },
    ordnanceDeps: { id: 'ordnance-deps' },
  };
  const ui = {
    overlay: {
      showToast: vi.fn(),
    },
    log: {
      toggle: vi.fn(),
    },
    showFleetWaiting: vi.fn(),
    toggleHelpOverlay: vi.fn(),
  };
  const renderer = {
    centerOnHex: vi.fn(),
    camera: {
      pan: vi.fn(),
      zoomAt: vi.fn(),
    },
  };
  const camera = {
    cycleShip: vi.fn(),
    focusNearestEnemy: vi.fn(),
    focusOwnFleet: vi.fn(),
  };
  const hud = {
    updateSoundButton: vi.fn(),
  };
  const replayController = {
    selectMatch: vi.fn(),
    toggleReplay: vi.fn(async () => {}),
    stepReplay: vi.fn(),
  };
  const sessionApi = {
    createGame: vi.fn(),
  };
  const setAIDifficulty = vi.fn();
  const exitToMenu = vi.fn();
  const trackEvent = vi.fn();

  const deps = {
    canvas: {
      clientWidth: 800,
      clientHeight: 600,
    } as Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>,
    map: buildSolarSystemMap(),
    ctx,
    actionDeps,
    ui,
    renderer,
    camera,
    hud,
    replayController,
    sessionApi,
    mainNetworkDeps,
    setAIDifficulty,
    exitToMenu,
    trackEvent,
  };

  return {
    controller: createMainInteractionController(
      deps as unknown as Parameters<typeof createMainInteractionController>[0],
    ),
    deps,
    transport,
    mainNetworkDeps,
    planningState,
    setState: (
      state:
        | 'menu'
        | 'playing_astrogation'
        | 'playing_fleetBuilding'
        | 'playing_movementAnim',
    ) => {
      currentState = state;
    },
    setGameState: (state: object | null) => {
      currentGameState = state;
    },
  };
};

describe('main-interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds live command-router deps and fleet-ready callbacks', () => {
    const {
      controller,
      deps,
      transport,
      planningState,
      setState,
      setGameState,
    } = createController();
    const purchases = [{ kind: 'ship', shipType: 'frigate' }] as const;

    controller.dispatch({ type: 'confirmOrders' });

    expect(mocks.dispatchGameCommand).toHaveBeenCalledWith(expect.any(Object), {
      type: 'confirmOrders',
    });

    const routerDeps = mocks.dispatchGameCommand.mock.calls[0]?.[0];
    if (!routerDeps) {
      throw new Error('Expected command-router deps');
    }

    expect(routerDeps.ctx.getState()).toBe('playing_astrogation');
    setState('playing_fleetBuilding');
    expect(routerDeps.ctx.getState()).toBe('playing_fleetBuilding');
    expect(routerDeps.ctx.getGameState()).toEqual({ gameId: 'GAME1' });
    expect(routerDeps.ctx.getPlayerId()).toBe(0);
    expect(routerDeps.ctx.getTransport()).toBe(transport);
    expect(routerDeps.ctx.planningState).toBe(planningState);

    routerDeps.sendFleetReady(purchases);
    expect(transport.submitFleetReady).toHaveBeenCalledWith(purchases);
    expect(deps.ui.showFleetWaiting).toHaveBeenCalledOnce();

    setState('menu');
    setGameState(null);
    routerDeps.sendFleetReady(purchases);
    expect(transport.submitFleetReady).toHaveBeenCalledTimes(1);

    routerDeps.sendRematch();
    routerDeps.exitToMenu();
    routerDeps.toggleHelp();
    routerDeps.updateSoundButton();
    expect(transport.requestRematch).toHaveBeenCalledOnce();
    expect(deps.exitToMenu).toHaveBeenCalledOnce();
    expect(deps.ui.toggleHelpOverlay).toHaveBeenCalledOnce();
    expect(deps.hud.updateSoundButton).toHaveBeenCalledOnce();
  });

  it('dispatches interpreted input and mapped keyboard commands', () => {
    const { controller, deps, setState } = createController();
    const clickEvent = {
      type: 'clickHex',
      hex: { q: 1, r: 2 },
    } as const;
    const interpretedCommands: GameCommand[] = [
      { type: 'confirmOrders' },
      { type: 'toggleHelp' },
    ];

    setState('playing_movementAnim');
    controller.handleInput(clickEvent);
    expect(mocks.interpretInput).not.toHaveBeenCalled();

    setState('playing_astrogation');
    mocks.interpretInput.mockReturnValue(interpretedCommands);
    controller.handleInput(clickEvent);

    expect(mocks.interpretInput).toHaveBeenCalledWith(
      clickEvent,
      { gameId: 'GAME1' },
      deps.map,
      0,
      deps.ctx.planningState,
    );
    expect(mocks.dispatchGameCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      interpretedCommands[0],
    );
    expect(mocks.dispatchGameCommand).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      interpretedCommands[1],
    );

    mocks.keyboardActionToCommand.mockReturnValueOnce(null);
    mocks.keyboardActionToCommand.mockReturnValueOnce({
      type: 'requestRematch',
    });
    controller.handleKeyboardAction({ kind: 'none', preventDefault: false });
    controller.handleKeyboardAction({
      kind: 'toggleHelp',
      preventDefault: false,
    });

    expect(mocks.dispatchGameCommand).toHaveBeenCalledTimes(3);
    expect(mocks.dispatchGameCommand).toHaveBeenLastCalledWith(
      expect.any(Object),
      { type: 'requestRematch' },
    );
  });

  it('delegates join, spectate, and toast helpers', () => {
    const { controller, deps, mainNetworkDeps } = createController();

    controller.joinGame('ROOM1', 'token');
    controller.spectateGame('ROOM2');
    controller.showToast('Saved');

    expect(mocks.beginJoinGameFromMain).toHaveBeenCalledWith(
      mainNetworkDeps,
      'ROOM1',
      'token',
    );
    expect(mocks.beginSpectateGameFromMain).toHaveBeenCalledWith(
      mainNetworkDeps,
      'ROOM2',
    );
    expect(deps.ui.overlay.showToast).toHaveBeenCalledWith('Saved', 'info');
  });

  it('routes UI event plans to session, replay, chat, tracking, and commands', async () => {
    const { controller, deps, mainNetworkDeps, transport } = createController();

    mocks.resolveUIEventPlan
      .mockReturnValueOnce({ kind: 'createGame', scenario: 'duel' })
      .mockReturnValueOnce({
        kind: 'startSinglePlayer',
        scenario: 'escape',
        difficulty: 'hard',
      })
      .mockReturnValueOnce({
        kind: 'joinGame',
        code: 'ROOM3',
        playerToken: 'player-token',
      })
      .mockReturnValueOnce({
        kind: 'command',
        command: { type: 'exitToMenu' },
      })
      .mockReturnValueOnce({
        kind: 'selectReplayMatch',
        direction: 'prev',
      })
      .mockReturnValueOnce({ kind: 'toggleReplay' })
      .mockReturnValueOnce({
        kind: 'replayNav',
        direction: 'end',
      })
      .mockReturnValueOnce({
        kind: 'sendChat',
        text: 'hello',
      })
      .mockReturnValueOnce({
        kind: 'trackOnly',
        event: 'scenario_browsed',
      });

    controller.handleUIEvent({ type: 'selectScenario', scenario: 'duel' });
    controller.handleUIEvent({
      type: 'startSinglePlayer',
      scenario: 'escape',
      difficulty: 'hard',
    });
    controller.handleUIEvent({
      type: 'join',
      code: 'ROOM3',
      playerToken: 'player-token',
    });
    controller.handleUIEvent({ type: 'confirm' });
    controller.handleUIEvent({ type: 'replayMatchPrev' });
    controller.handleUIEvent({ type: 'toggleReplay' });
    controller.handleUIEvent({ type: 'replayEnd' });
    controller.handleUIEvent({ type: 'chat', text: 'hello' });
    controller.handleUIEvent({ type: 'backToMenu' });
    await Promise.resolve();

    expect(deps.sessionApi.createGame).toHaveBeenCalledWith('duel');
    expect(deps.setAIDifficulty).toHaveBeenCalledWith('hard');
    expect(mocks.startLocalGameFromMain).toHaveBeenCalledWith(
      mainNetworkDeps,
      'escape',
    );
    expect(mocks.beginJoinGameFromMain).toHaveBeenCalledWith(
      mainNetworkDeps,
      'ROOM3',
      'player-token',
    );
    expect(mocks.dispatchGameCommand).toHaveBeenCalledWith(expect.any(Object), {
      type: 'exitToMenu',
    });
    expect(deps.replayController.selectMatch).toHaveBeenCalledWith('prev');
    expect(deps.replayController.toggleReplay).toHaveBeenCalledOnce();
    expect(deps.replayController.stepReplay).toHaveBeenCalledWith('end');
    expect(transport.sendChat).toHaveBeenCalledWith('hello');
    expect(deps.trackEvent).toHaveBeenCalledWith('scenario_browsed');
  });
});
