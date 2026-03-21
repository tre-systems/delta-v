import { describe, expect, it } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types';
import {
  beginJoinGameSession,
  type CreatedGameSessionDeps,
  completeCreatedGameSession,
  type ExitToMenuSessionDeps,
  exitToMenuSession,
  type JoinGameSessionDeps,
  type LocalGameSessionDeps,
  startLocalGameSession,
} from './session-controller';

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createGame(SCENARIOS.duel, buildSolarSystemMap(), 'SESSION', findBaseHex),
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
    ctx: {
      scenario: 'biplanetary',
      isLocalGame: false,
      playerId: -1,
      gameCode: null,
      gameState: null,
      transport: null,
      aiDifficulty: 'normal',
    },
    storePlayerToken: track('storePlayerToken'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    connect: track('connect'),
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
    ctx: {
      scenario: 'biplanetary',
      isLocalGame: false,
      playerId: -1,
      gameCode: null,
      gameState: null,
      transport: null,
      aiDifficulty: 'hard',
    },
    createLocalTransport: () => ({ kind: 'local' }) as never,
    createLocalGameState: () => state,
    getScenarioName: (scenario) => SCENARIOS[scenario]?.name ?? 'Unknown',
    resetTurnTelemetry: track('resetTurnTelemetry'),
    setRendererPlayerId: track('setRendererPlayerId'),
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
    ctx: {
      gameCode: null,
    },
    storePlayerToken: track('storePlayerToken'),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    buildGameRoute: (code) => `/game/${code}`,
    connect: track('connect'),
    setState: track('setState'),
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
    ctx: {
      gameState: createState(),
      isLocalGame: true,
      transport: { kind: 'local' } as never,
    },
    stopPing: track('stopPing'),
    stopTurnTimer: track('stopTurnTimer'),
    closeConnection: track('closeConnection'),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    replaceRoute: track('replaceRoute'),
    setState: track('setState'),
    calls,
  };
};

describe('session-controller', () => {
  it('completes hosted game creation and connects to the room', () => {
    const deps = createCreatedGameDeps();

    completeCreatedGameSession(deps, 'duel', 'ABCDE', 'token-1');

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

  it('starts a local game session and transitions into play', () => {
    const deps = createLocalGameDeps();

    startLocalGameSession(deps, 'duel');

    expect(deps.ctx.isLocalGame).toBe(true);
    expect(deps.ctx.scenario).toBe('duel');
    expect(deps.ctx.playerId).toBe(0);
    expect(deps.ctx.transport).not.toBeNull();
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.setRendererPlayerId).toEqual([[0]]);
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

  it('stores invite tokens when joining a multiplayer room', () => {
    const deps = createJoinGameDeps();

    beginJoinGameSession(deps, 'FGHIJ', 'token-2');

    expect(deps.ctx.gameCode).toBe('FGHIJ');
    expect(deps.calls.storePlayerToken).toEqual([['FGHIJ', 'token-2']]);
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.replaceRoute).toEqual([['/game/FGHIJ']]);
    expect(deps.calls.connect).toEqual([['FGHIJ']]);
    expect(deps.calls.setState).toEqual([['connecting']]);
  });

  it('clears the active session when returning to menu', () => {
    const deps = createExitToMenuDeps();

    exitToMenuSession(deps);

    expect(deps.calls.stopPing).toHaveLength(1);
    expect(deps.calls.stopTurnTimer).toHaveLength(1);
    expect(deps.calls.closeConnection).toHaveLength(1);
    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.ctx.gameState).toBeNull();
    expect(deps.ctx.isLocalGame).toBe(false);
    expect(deps.ctx.transport).toBeNull();
    expect(deps.calls.replaceRoute).toEqual([['/']]);
    expect(deps.calls.setState).toEqual([['menu']]);
  });
});
