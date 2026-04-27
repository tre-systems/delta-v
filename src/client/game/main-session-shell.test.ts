import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import type { Renderer } from '../renderer/renderer';
import type { Tutorial } from '../tutorial';
import type { UIManager } from '../ui/ui';
import type { MainSessionShellActionDeps } from './main-session-shell';
import type { ClientSession } from './session-model';
import type { SessionTokenService } from './session-token-service';
import type { TurnTimerManager } from './timer';
import type { TurnTelemetryTracker } from './turn-telemetry';

const mocks = vi.hoisted(() => {
  const connection = {
    connect: vi.fn(),
    stopPing: vi.fn(),
    close: vi.fn(),
  };

  const sessionApi = {
    fetchReplay: vi.fn(),
    validateJoin: vi.fn(),
  };

  const replayController = {
    controlsSignal: { peek: vi.fn(() => null) },
    onGameOverMessage: vi.fn(),
    onGameOverShown: vi.fn(),
    clearForState: vi.fn(),
  };

  return {
    connection,
    sessionApi,
    replayController,
    setLatencyMs: vi.fn(),
    setOpponentDisconnectDeadlineMs: vi.fn(),
    setReconnectAttempts: vi.fn(),
    setReconnectOverlayState: vi.fn(),
    setScenario: vi.fn(),
    setTransport: vi.fn(),
    createConnectionManager: vi.fn(() => connection),
    applyClientGameState: vi.fn(),
    runAI: vi.fn(),
    exitToMenuFromMain: vi.fn(),
    handleServerMessageFromMain: vi.fn(),
    startLocalGameFromMain: vi.fn(),
    transitionClientPhase: vi.fn(),
    createReplayController: vi.fn(() => replayController),
    createSessionApi: vi.fn(() => sessionApi),
    applyClientStateTransition: vi.fn(),
    createLocalGameTransport: vi.fn(() => ({ kind: 'local-transport' })),
    advanceToNextAttacker: vi.fn(),
    autoSkipCombat: vi.fn(),
    beginCombat: vi.fn(),
  };
});

vi.mock('./client-context-store', () => ({
  setLatencyMs: mocks.setLatencyMs,
  setOpponentDisconnectDeadlineMs: mocks.setOpponentDisconnectDeadlineMs,
  setReconnectAttempts: mocks.setReconnectAttempts,
  setReconnectOverlayState: mocks.setReconnectOverlayState,
  setScenario: mocks.setScenario,
  setTransport: mocks.setTransport,
}));

vi.mock('./combat-actions', () => ({
  advanceToNextAttacker: mocks.advanceToNextAttacker,
  autoSkipCombatIfNoTargets: mocks.autoSkipCombat,
  beginCombatPhase: mocks.beginCombat,
}));

vi.mock('./connection', () => ({
  createConnectionManager: mocks.createConnectionManager,
}));

vi.mock('./game-state-store', () => ({
  applyClientGameState: mocks.applyClientGameState,
}));

vi.mock('./local-game-flow', () => ({
  runAITurn: mocks.runAI,
}));

vi.mock('./main-session-network', () => ({
  exitToMenuFromMain: mocks.exitToMenuFromMain,
  handleServerMessageFromMain: mocks.handleServerMessageFromMain,
  startLocalGameFromMain: mocks.startLocalGameFromMain,
}));

vi.mock('./phase-controller', () => ({
  transitionClientPhase: mocks.transitionClientPhase,
}));

vi.mock('./replay-controller', () => ({
  createReplayController: mocks.createReplayController,
}));

vi.mock('./session-api', () => ({
  createSessionApi: mocks.createSessionApi,
}));

vi.mock('./state-transition', () => ({
  applyClientStateTransition: mocks.applyClientStateTransition,
}));

vi.mock('./transport', () => ({
  createLocalGameTransport: mocks.createLocalGameTransport,
}));

import { asGameId } from '../../shared/ids';
import { createMainSessionShell } from './main-session-shell';

const createSignal = <T>(value: T) => ({
  peek: vi.fn(() => value),
});

const createArgs = () => {
  const ctx = {
    spectatorMode: false,
    reconnectAttempts: 2,
    playerId: 0,
    gameCode: 'ROOM1',
    scenario: 'duel',
    aiDifficulty: 'normal',
    isLocalGame: false,
    gameStateSignal: createSignal({ gameId: asGameId('GAME') }),
    stateSignal: createSignal('menu'),
    reconnectOverlayStateSignal: createSignal(null),
    opponentDisconnectDeadlineMsSignal: createSignal(null),
  } as unknown as ClientSession;

  const overlay = {
    bindReconnectStateSignal: vi.fn(),
    bindOpponentDisconnectDeadlineSignal: vi.fn(),
    bindHideOpponentDisconnected: vi.fn(),
    bindReplayControlsSignal: vi.fn(),
  };

  const ui = {
    overlay,
    setMenuLoading: vi.fn(),
    showScenarioBriefing: vi.fn(),
  } as unknown as UIManager;

  return {
    ctx,
    overlay,
    map: {} as SolarSystemMap,
    renderer: {
      clearTrails: vi.fn(),
    } as unknown as Renderer,
    ui,
    hud: {
      updateHUD: vi.fn(),
      updateTooltip: vi.fn(),
      logScenarioBriefing: vi.fn(),
      updateSoundButton: vi.fn(),
    },
    actionDeps: {
      combatDeps: { tag: 'combat-deps' },
      localGameFlowDeps: { tag: 'local-deps' },
    } as unknown as MainSessionShellActionDeps,
    turnTelemetry: {} as TurnTelemetryTracker,
    playerProfile: {
      getProfile: vi.fn(() => ({
        playerKey: 'playerkey1',
        username: 'Pilot 1',
      })),
    },
    sessionTokens: {
      clearStoredPlayerToken: vi.fn(),
      getStoredPlayerToken: vi.fn(),
      storePlayerToken: vi.fn(),
    } as Pick<
      SessionTokenService,
      'clearStoredPlayerToken' | 'getStoredPlayerToken' | 'storePlayerToken'
    >,
    tutorial: {} as Tutorial,
    turnTimer: {
      stop: vi.fn(),
    } as unknown as TurnTimerManager,
    tooltipEl: {} as HTMLElement,
    showToast: vi.fn(),
    track: vi.fn(),
    fetchImpl: vi.fn() as typeof fetch,
    location: window.location,
    webSocketCtor: WebSocket,
  };
};

describe('main-session-shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates state changes through replay cleanup and shared state transition deps', () => {
    const args = createArgs();
    const shell = createMainSessionShell(args);

    shell.setState('playing_astrogation');

    expect(mocks.replayController.clearForState).toHaveBeenCalledWith(
      'playing_astrogation',
    );
    expect(mocks.applyClientStateTransition).toHaveBeenCalledWith(
      expect.objectContaining({ ui: args.ui, renderer: args.renderer }),
      'playing_astrogation',
    );
  });

  it('routes incoming messages and local game starts through the shared main-session bridge', () => {
    const args = createArgs();
    createMainSessionShell(args);

    const connectionArgs = (
      mocks.createConnectionManager.mock.calls as unknown[][]
    )[0]?.[0] as { handleMessage: (message: S2C) => void } | undefined;
    if (!connectionArgs) {
      throw new Error('Expected connection args');
    }

    const message = { type: 'opponentStatus', status: 'reconnected' } as S2C;
    connectionArgs.handleMessage(message);

    expect(mocks.handleServerMessageFromMain).toHaveBeenCalledWith(
      expect.objectContaining({ ctx: args.ctx, ui: args.ui }),
      message,
      expect.any(Function),
    );

    const onGameOver = (
      mocks.handleServerMessageFromMain.mock.calls as unknown[][]
    )[0]?.[2] as (() => void) | undefined;
    onGameOver?.();
    expect(mocks.replayController.onGameOverMessage).toHaveBeenCalledOnce();
  });

  it('builds local transport and exit handlers around one shared network dep object', () => {
    const args = createArgs();
    const shell = createMainSessionShell(args);

    shell.exitToMenu();
    expect(mocks.exitToMenuFromMain).toHaveBeenCalledWith(shell.networkDeps);

    shell.networkDeps.createLocalTransport();

    const transportArgs = (
      mocks.createLocalGameTransport.mock.calls as unknown[][]
    )[0]?.[0] as { startLocalGame: (scenario: string) => void } | undefined;
    if (!transportArgs) {
      throw new Error('Expected local transport args');
    }

    transportArgs.startLocalGame('duel');

    expect(mocks.startLocalGameFromMain).toHaveBeenCalledWith(
      shell.networkDeps,
      'duel',
    );
  });

  it('wires overlay bindings and connection setters through the client context store', () => {
    const args = createArgs();
    createMainSessionShell(args);

    expect(args.overlay.bindReconnectStateSignal).toHaveBeenCalledWith(
      args.ctx.reconnectOverlayStateSignal,
    );
    expect(
      args.overlay.bindOpponentDisconnectDeadlineSignal,
    ).toHaveBeenCalledWith(args.ctx.opponentDisconnectDeadlineMsSignal);
    expect(args.overlay.bindReplayControlsSignal).toHaveBeenCalledWith(
      mocks.replayController.controlsSignal,
    );

    const hideCallback =
      args.overlay.bindHideOpponentDisconnected.mock.calls[0]?.[0];
    hideCallback?.();
    expect(mocks.setOpponentDisconnectDeadlineMs).toHaveBeenCalledWith(
      args.ctx,
      null,
    );

    const connectionArgs = (
      mocks.createConnectionManager.mock.calls as unknown[][]
    )[0]?.[0] as
      | {
          setReconnectAttempts: (attempts: number) => void;
          setLatencyMs: (latencyMs: number) => void;
          setReconnectOverlayState: (state: string | null) => void;
          setTransport: (transport: unknown) => void;
        }
      | undefined;
    if (!connectionArgs) {
      throw new Error('Expected connection args');
    }

    connectionArgs.setReconnectAttempts(4);
    connectionArgs.setLatencyMs(120);
    connectionArgs.setReconnectOverlayState('reconnecting');
    connectionArgs.setTransport({ transport: true });

    expect(mocks.setReconnectAttempts).toHaveBeenCalledWith(args.ctx, 4);
    expect(mocks.setLatencyMs).toHaveBeenCalledWith(args.ctx, 120);
    expect(mocks.setReconnectOverlayState).toHaveBeenCalledWith(
      args.ctx,
      'reconnecting',
    );
    expect(mocks.setTransport).toHaveBeenCalledWith(args.ctx, {
      transport: true,
    });
  });

  it('forwards menu loading kind from session API to the lobby UI', () => {
    const args = createArgs();
    createMainSessionShell(args);

    type SessionApiCtorArg = {
      setMenuLoading: (
        loading: boolean,
        kind?: 'create' | 'quickMatch',
      ) => void;
    };
    const calls = mocks.createSessionApi.mock.calls as unknown as Array<
      [SessionApiCtorArg]
    >;
    const sessionDeps = calls[0]?.[0];
    if (!sessionDeps) {
      throw new Error('Expected createSessionApi deps');
    }

    sessionDeps.setMenuLoading(true, 'quickMatch');
    expect(args.ui.setMenuLoading).toHaveBeenCalledWith(true, 'quickMatch');

    sessionDeps.setMenuLoading(false);
    expect(args.ui.setMenuLoading).toHaveBeenLastCalledWith(false, undefined);
  });

  it('threads explicit browser seams into connection and session API deps', () => {
    const args = createArgs();
    createMainSessionShell(args);

    const connectionDeps = (
      mocks.createConnectionManager.mock.calls as unknown[][]
    )[0]?.[0] as { webSocketCtor: typeof WebSocket } | undefined;
    const sessionApiDeps = (
      mocks.createSessionApi.mock.calls as unknown[][]
    )[0]?.[0] as
      | {
          fetchImpl: typeof fetch;
          location: Location;
        }
      | undefined;

    expect(connectionDeps?.webSocketCtor).toBe(args.webSocketCtor);
    expect(sessionApiDeps?.fetchImpl).toBe(args.fetchImpl);
    expect(sessionApiDeps?.location).toBe(args.location);
  });

  it('applies client game state through the shared projection helper', () => {
    const args = createArgs();
    const shell = createMainSessionShell(args);
    const state = { gameId: asGameId('NEXT') } as GameState;

    shell.applyGameState(state);

    expect(mocks.applyClientGameState).toHaveBeenCalledWith(
      { ctx: args.ctx, isSpectator: false },
      state,
    );
  });
});
