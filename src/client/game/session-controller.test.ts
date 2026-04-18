import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  isValidScenario,
  SCENARIOS,
} from '../../shared/map-data';
import type { ReplayTimeline } from '../../shared/replay';
import { ErrorCode, type GameState } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import {
  type ArchivedReplaySessionDeps,
  beginArchivedReplaySession,
  beginJoinGameSession,
  beginSpectateGameSession,
  type CreatedGameSessionDeps,
  completeCreatedGameSession,
  type ExitToMenuSessionDeps,
  exitToMenuSession,
  type JoinGameSessionDeps,
  type LocalGameSessionDeps,
  type SpectateGameSessionDeps,
  startLocalGameSession,
} from './session-controller';
import type { ClientSession } from './session-model';
import { stubClientSession } from './session-model';

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('SESSION'),
    findBaseHex,
  ),
  phase: 'astrogation',
  activePlayer: 0,
  ...overrides,
});

const createCreatedGameDeps = (): CreatedGameSessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: stubClientSession({
      scenario: 'biplanetary',
      isLocalGame: true,
      latencyMs: 123,
      playerId: -1,
      gameCode: 'STALE',
      gameState: null,
      reconnectAttempts: 2,
      reconnectOverlayState: {
        attempt: 1,
        maxAttempts: 5,
        onCancel: () => {},
      },
      opponentDisconnectDeadlineMs: Date.now() + 10_000,
      spectatorMode: true,
      transport: null,
      aiDifficulty: 'normal',
    }),
    storePlayerToken: track('storePlayerToken'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    connect: track('connect'),
    setWaitingScreenState: track('setWaitingScreenState'),
    setState: track('setState'),
    trackGameCreated: track('trackGameCreated'),
    calls,
  };
};

const createLocalGameDeps = (): LocalGameSessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  const state = createState();
  const deps: LocalGameSessionDeps & {
    calls: Record<string, unknown[][]>;
  } = {
    ctx: stubClientSession({
      scenario: 'biplanetary',
      isLocalGame: false,
      latencyMs: 250,
      playerId: -1,
      gameCode: 'REMOTE1',
      gameState: null,
      reconnectAttempts: 4,
      reconnectOverlayState: {
        attempt: 3,
        maxAttempts: 5,
        onCancel: () => {},
      },
      opponentDisconnectDeadlineMs: Date.now() + 15_000,
      spectatorMode: true,
      transport: null,
      aiDifficulty: 'hard',
    }),
    createLocalTransport: () => ({ kind: 'local' }) as never,
    createLocalGameState: () => ({ ok: true, value: state }),
    getScenarioName: (scenario) =>
      isValidScenario(scenario) ? SCENARIOS[scenario].name : 'Unknown',
    resetTurnTelemetry: track('resetTurnTelemetry'),
    clearTrails: track('clearTrails'),
    clearLog: track('clearLog'),
    setChatEnabled: track('setChatEnabled'),
    logText: track('logText'),
    trackGameCreated: track('trackGameCreated'),
    applyGameState: (gameState) => {
      deps.ctx.gameState = gameState;
      track('applyGameState')(gameState);
    },
    logScenarioBriefing: track('logScenarioBriefing'),
    setState: (clientState) => {
      track('setState')(clientState);
    },
    runLocalAI: track('runLocalAI'),
    calls,
  };

  return deps;
};

const createJoinGameDeps = (): JoinGameSessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: stubClientSession({
      gameCode: null,
      isLocalGame: true,
      spectatorMode: true,
      reconnectOverlayState: {
        attempt: 2,
        maxAttempts: 5,
        onCancel: () => {},
      },
      opponentDisconnectDeadlineMs: Date.now() + 20_000,
    }),
    getStoredPlayerToken: () => null,
    storePlayerToken: track('storePlayerToken'),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    connect: track('connect'),
    setWaitingScreenState: track('setWaitingScreenState'),
    setState: track('setState'),
    validateJoin: async (_code, playerToken) => ({
      ok: true,
      value: playerToken,
    }),
    showToast: track('showToast'),
    exitToMenu: track('exitToMenu'),
    calls,
  };
};

const createExitToMenuDeps = (): ExitToMenuSessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: stubClientSession({
      gameCode: 'ABCDE',
      gameState: createState(),
      isLocalGame: true,
      latencyMs: 250,
      opponentDisconnectDeadlineMs: Date.now() + 30_000,
      playerId: 1,
      reconnectOverlayState: {
        attempt: 2,
        maxAttempts: 5,
        onCancel: () => {},
      },
      reconnectAttempts: 3,
      spectatorMode: true,
      transport: { kind: 'local' } as never,
    }),
    stopPing: track('stopPing'),
    stopTurnTimer: track('stopTurnTimer'),
    closeConnection: track('closeConnection'),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    setState: track('setState'),
    calls,
  };
};

const createSpectateGameDeps = (): SpectateGameSessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: stubClientSession({
      gameCode: null,
      isLocalGame: true,
      spectatorMode: false,
      reconnectOverlayState: {
        attempt: 1,
        maxAttempts: 5,
        onCancel: () => {},
      },
      opponentDisconnectDeadlineMs: Date.now() + 25_000,
    }),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    connect: track('connect'),
    setWaitingScreenState: track('setWaitingScreenState'),
    setState: track('setState'),
    calls,
  };
};

const createArchivedReplayDeps = (
  timeline: ReplayTimeline | null,
): ArchivedReplaySessionDeps & {
  calls: Record<string, unknown[][]>;
} => {
  const calls: Record<string, unknown[][]> = {};
  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: stubClientSession({
      gameCode: null,
      isLocalGame: false,
      spectatorMode: false,
      reconnectOverlayState: null,
      opponentDisconnectDeadlineMs: null,
    }),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    setWaitingScreenState: track('setWaitingScreenState'),
    setState: track('setState'),
    fetchArchivedReplay: async (...args) => {
      track('fetchArchivedReplay')(...args);
      return timeline;
    },
    applyGameState: track('applyGameState'),
    startArchivedReplay: track('startArchivedReplay'),
    showToast: track('showToast'),
    exitToMenu: track('exitToMenu'),
    setScenario: track('setScenario'),
    calls,
  };
};

const buildTimeline = (): ReplayTimeline => {
  const firstState = createState({ turnNumber: 1, phase: 'astrogation' });
  const lastState = createState({
    turnNumber: 4,
    phase: 'gameOver',
    outcome: { winner: 0, reason: 'Fleet eliminated!' },
  });
  return {
    gameId: asGameId('ZNMC6-m1'),
    roomCode: 'ZNMC6',
    matchNumber: 1,
    scenario: 'duel',
    createdAt: 1,
    entries: [
      {
        sequence: 1,
        recordedAt: 1,
        turn: 1,
        phase: 'astrogation',
        message: { type: 'stateUpdate', state: firstState },
      },
      {
        sequence: 2,
        recordedAt: 2,
        turn: 4,
        phase: 'gameOver',
        message: { type: 'stateUpdate', state: lastState },
      },
    ],
  };
};

describe('session-controller', () => {
  it('completes hosted game creation and connects to the room', () => {
    const deps = createCreatedGameDeps();

    completeCreatedGameSession(deps, 'duel', 'ABCDE', 'token-1');

    expect(deps.ctx.isLocalGame).toBe(false);
    expect(deps.ctx.spectatorMode).toBe(false);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.ctx.scenario).toBe('duel');
    expect(deps.ctx.gameCode).toBe('ABCDE');
    expect(deps.calls.storePlayerToken).toEqual([['ABCDE', 'token-1']]);
    expect(deps.calls.replaceRoute).toEqual([['/game/ABCDE']]);
    expect(deps.calls.trackGameCreated).toEqual([
      [{ scenario: 'duel', mode: 'multiplayer' }],
    ]);
    expect(deps.calls.connect).toEqual([['ABCDE']]);
    expect(deps.calls.setState).toEqual([['waitingForOpponent']]);
  });

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DELTAV_FORCE_PLAYER_SIDE = 0;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).__DELTAV_FORCE_PLAYER_SIDE =
      undefined;
  });

  it('starts a local game session and transitions into play', () => {
    const deps = createLocalGameDeps();

    startLocalGameSession(deps, 'duel');

    expect(deps.ctx.isLocalGame).toBe(true);
    expect(deps.ctx.spectatorMode).toBe(false);
    expect(deps.ctx.scenario).toBe('duel');
    expect(deps.ctx.gameCode).toBeNull();
    expect(deps.ctx.latencyMs).toBe(-1);
    expect(deps.ctx.playerId).toBe(0);
    expect(deps.ctx.reconnectAttempts).toBe(0);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.ctx.transport).not.toBeNull();
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.clearTrails).toHaveLength(1);
    expect(deps.calls.clearLog).toHaveLength(1);
    expect(deps.calls.setChatEnabled).toEqual([[false]]);
    expect(deps.calls.logText).toEqual([['vs AI (hard) — Duel']]);
    expect(deps.calls.trackGameCreated).toEqual([
      [{ scenario: 'duel', mode: 'local', difficulty: 'hard' }],
    ]);
    expect(deps.calls.applyGameState).toHaveLength(1);
    expect(deps.calls.logScenarioBriefing).toHaveLength(1);
    expect(deps.calls.setState).toEqual([['playing_astrogation']]);
    expect(deps.calls.runLocalAI).toBeUndefined();
  });

  it('validates and stores player tokens when joining a multiplayer room', async () => {
    const deps = createJoinGameDeps();

    await beginJoinGameSession(deps, 'FGHIJ', 'token-2');

    expect(deps.ctx.gameCode).toBe('FGHIJ');
    expect((deps.ctx as ClientSession).isLocalGame).toBe(false);
    expect((deps.ctx as ClientSession).spectatorMode).toBe(false);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.calls.storePlayerToken).toEqual([['FGHIJ', 'token-2']]);
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.replaceRoute).toEqual([['/game/FGHIJ']]);
    expect(deps.calls.setState).toEqual([['connecting']]);
    expect(deps.calls.connect).toEqual([['FGHIJ']]);
  });

  it('aborts join flow when preflight validation fails', async () => {
    const deps = createJoinGameDeps();
    deps.validateJoin = async () => ({
      ok: false,
      error: { message: 'That game is already full' },
    });

    await beginJoinGameSession(deps, 'FGHIJ', 'token-2');

    expect(deps.ctx.gameCode).toBeNull();
    expect(deps.calls.showToast).toEqual([
      ['That game is already full', 'error'],
    ]);
    expect(deps.calls.exitToMenu).toHaveLength(1);
    expect(deps.calls.storePlayerToken).toBeUndefined();
    expect(deps.calls.resetTurnTelemetry).toBeUndefined();
    expect(deps.calls.replaceRoute).toBeUndefined();
    expect(deps.calls.setState).toBeUndefined();
    expect(deps.calls.connect).toBeUndefined();
  });

  it('falls back to spectator when the room is full and a fallback is wired', async () => {
    const deps = createJoinGameDeps();
    const fallbackSpy = vi.fn();
    deps.fallbackToSpectator = fallbackSpy;
    deps.validateJoin = async () => ({
      ok: false,
      error: {
        message: 'That game is already full',
        code: ErrorCode.ROOM_FULL,
      },
    });

    await beginJoinGameSession(deps, 'FGHIJ');

    expect(fallbackSpy).toHaveBeenCalledWith('FGHIJ');
    expect(deps.calls.showToast).toEqual([
      [TOAST.sessionController.joinRoomFullSpectator, 'info'],
    ]);
    expect(deps.calls.exitToMenu).toBeUndefined();
  });

  it('exits to menu on ROOM_FULL when no spectator fallback is configured', async () => {
    const deps = createJoinGameDeps();
    deps.validateJoin = async () => ({
      ok: false,
      error: {
        message: 'That game is already full',
        code: ErrorCode.ROOM_FULL,
      },
    });

    await beginJoinGameSession(deps, 'FGHIJ');

    expect(deps.calls.showToast).toEqual([
      ['That game is already full', 'error'],
    ]);
    expect(deps.calls.exitToMenu).toHaveLength(1);
  });

  it('clears spectator mode after a normal join succeeds', async () => {
    const deps = createJoinGameDeps();
    (deps.ctx as ClientSession).spectatorMode = true;

    await beginJoinGameSession(deps, 'FGHIJ');

    expect((deps.ctx as ClientSession).spectatorMode).toBe(false);
  });

  it('starts spectating without join preflight', () => {
    const deps = createSpectateGameDeps();

    beginSpectateGameSession(deps, 'ABCDE');

    expect((deps.ctx as ClientSession).isLocalGame).toBe(false);
    expect(deps.ctx.spectatorMode).toBe(true);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.ctx.gameCode).toBe('ABCDE');
    expect(deps.calls.replaceRoute).toEqual([['/game/ABCDE']]);
    expect(deps.calls.setState).toEqual([['connecting']]);
    expect(deps.calls.connect).toEqual([['ABCDE']]);
  });

  it('reuses the stored token when rejoining from a saved room route', async () => {
    const deps = createJoinGameDeps();
    deps.getStoredPlayerToken = () => 'stored-token';

    await beginJoinGameSession(deps, 'FGHIJ');

    expect(deps.ctx.gameCode).toBe('FGHIJ');
    expect(deps.calls.storePlayerToken).toEqual([['FGHIJ', 'stored-token']]);
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.replaceRoute).toEqual([['/game/FGHIJ']]);
    expect(deps.calls.setState).toEqual([['connecting']]);
    expect(deps.calls.connect).toEqual([['FGHIJ']]);
  });

  it('does not re-store a token when join preflight falls back to tokenless access', async () => {
    const deps = createJoinGameDeps();
    deps.getStoredPlayerToken = () => 'stale-token';
    deps.validateJoin = async () => ({ ok: true, value: null });

    await beginJoinGameSession(deps, 'FGHIJ');

    expect(deps.calls.storePlayerToken).toBeUndefined();
    expect(deps.calls.connect).toEqual([['FGHIJ']]);
  });

  it('enters archived-replay mode without opening a WebSocket', async () => {
    const timeline = buildTimeline();
    const deps = createArchivedReplayDeps(timeline);

    await beginArchivedReplaySession(deps, 'ZNMC6', 'ZNMC6-m1');

    // Spectator flag set so the rest of the UI behaves read-only.
    expect(deps.ctx.spectatorMode).toBe(true);
    expect((deps.ctx as ClientSession).isLocalGame).toBe(false);
    expect(deps.ctx.gameCode).toBe('ZNMC6');
    // No connect() surface on this deps shape — archived replay never
    // opens a live WebSocket. Scenario hydrated from the timeline.
    expect(deps.calls.setScenario).toEqual([['duel']]);
    expect(deps.calls.fetchArchivedReplay).toEqual([['ZNMC6', 'ZNMC6-m1']]);
    // Final state applied before the replay controller starts.
    const appliedStates = deps.calls.applyGameState as Array<[GameState]>;
    expect(appliedStates).toHaveLength(1);
    expect(appliedStates[0][0].phase).toBe('gameOver');
    // Replay controller handed the full timeline.
    expect(deps.calls.startArchivedReplay).toEqual([[timeline]]);
    // State transitions connecting → gameOver (replay takes over from here).
    expect(deps.calls.setState).toEqual([['connecting'], ['gameOver']]);
    expect(deps.calls.showToast).toBeUndefined();
    expect(deps.calls.exitToMenu).toBeUndefined();
  });

  it('returns to menu with a toast when the archived replay is unavailable', async () => {
    const deps = createArchivedReplayDeps(null);

    await beginArchivedReplaySession(deps, 'MISSG', 'MISSG-m1');

    expect(deps.calls.showToast).toEqual([
      [TOAST.sessionController.replayUnavailable, 'error'],
    ]);
    expect(deps.calls.exitToMenu).toHaveLength(1);
    expect(deps.calls.startArchivedReplay).toBeUndefined();
    expect(deps.calls.applyGameState).toBeUndefined();
  });

  it('clears the active session when returning to menu', () => {
    const deps = createExitToMenuDeps();

    exitToMenuSession(deps);

    expect(deps.calls.stopPing).toHaveLength(1);
    expect(deps.calls.stopTurnTimer).toHaveLength(1);
    expect(deps.calls.closeConnection).toHaveLength(1);
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.ctx.gameCode).toBeNull();
    expect(deps.ctx.gameState).toBeNull();
    expect(deps.ctx.isLocalGame).toBe(false);
    expect(deps.ctx.latencyMs).toBe(-1);
    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.ctx.playerId).toBe(-1);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.ctx.spectatorMode).toBe(false);
    expect(deps.ctx.reconnectAttempts).toBe(0);
    expect(deps.ctx.transport).toBeNull();
    expect(deps.calls.replaceRoute).toEqual([['/']]);
    expect(deps.calls.setState).toEqual([['menu']]);
  });
});
