import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from '../../client/game/message-handler';
import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import type { Env } from './game-do';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { GameDO } from './game-do';
import { toMovementResultMessage, toStateUpdateMessage } from './messages';

class MockStorage {
  private data = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
  async setAlarm(value: number): Promise<void> {
    this.alarmAt = value;
  }
}

interface MockDurableObjectState {
  storage: MockStorage;
  acceptWebSocket: (ws: object, wsTags: string[]) => void;
  getTags: (ws: object) => string[];
  getWebSockets: (tag?: string) => object[];
}

const createGameDO = (
  ctx: MockDurableObjectState,
  env: Partial<Env> = {},
): GameDO => new GameDO(ctx as unknown as DurableObjectState, env as Env);

function createCtx(): MockDurableObjectState {
  const storage = new MockStorage();
  const sockets: object[] = [];
  const tags = new WeakMap<object, string[]>();
  return {
    storage,
    acceptWebSocket(ws: object, wsTags: string[]) {
      sockets.push(ws);
      tags.set(ws, wsTags);
    },
    getTags(ws: object) {
      return tags.get(ws) ?? [];
    },
    getWebSockets(tag?: string) {
      if (!tag) return sockets;
      return sockets.filter((ws) => (tags.get(ws) ?? []).includes(tag));
    },
  };
}

const createSocket = () => ({
  sent: [] as string[],
  send(payload: string) {
    this.sent.push(payload);
  },
});

const createMessageHandlerDeps = (
  state: GameState | null = null,
): MessageHandlerDeps & { transitionCount: number } => {
  let transitionCount = 0;
  const deps: MessageHandlerDeps & { transitionCount: number } = {
    ctx: {
      state: 'playing_astrogation',
      playerId: 0,
      gameCode: null,
      reconnectAttempts: 0,
      latencyMs: 0,
      gameState: state,
    },
    transitionCount,
    setState(nextState) {
      deps.ctx.state = nextState;
    },
    applyGameState(nextState) {
      deps.ctx.gameState = nextState;
    },
    transitionToPhase() {
      transitionCount += 1;
      deps.transitionCount = transitionCount;
      deps.ctx.state = 'playing_ordnance';
    },
    presentMovementResult() {},
    presentCombatResults() {},
    showGameOverOutcome() {},
    storePlayerToken() {},
    resetTurnTelemetry() {},
    onAnimationComplete() {},
    logScenarioBriefing() {},
    deserializeState(raw) {
      return raw;
    },
    renderer: {
      setPlayerId() {},
      clearTrails() {},
    },
    ui: {
      showToast() {},
      logText() {},
      setChatEnabled() {},
      hideReconnecting() {},
      setPlayerId() {},
      clearLog() {},
      showRematchPending() {},
      showGameOver() {},
      updateLatency() {},
    },
  };
  return deps;
};

describe('GameDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it('initializes a room and schedules inactivity cleanup immediately', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'ABCDE',
          scenario: 'escape',
          playerToken: 'A'.repeat(32),
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await ctx.storage.get('gameCode')).toBe('ABCDE');
    expect(await ctx.storage.get('roomConfig')).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, null],
    });
    const inactivityAt = await ctx.storage.get<number>('inactivityAt');
    expect(typeof inactivityAt).toBe('number');
    expect(must(inactivityAt)).toBeGreaterThan(Date.now());
    expect(ctx.storage.alarmAt).toBe(inactivityAt);
  });
  it('rejects websocket fetches for uninitialized rooms', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/ws/ABCDE', {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Game not found');
  });
  it('rejects malformed player tokens before websocket upgrade', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, null],
    });
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/ws/ABCDE?playerToken=bad-token', {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid player token');
  });
  it('rejects malformed client payloads before dispatching handlers', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const ws = {
      sent: [] as string[],
      send(payload: string) {
        this.sent.push(payload);
      },
    };
    await game.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ type: 'combat', attacks: null }),
    );
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(must(ws.sent[0]))).toEqual({
      type: 'error',
      message: 'Invalid combat payload',
    });
  });
  it('stores a disconnect marker and alarm when a live player disconnects', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const ctx = createCtx();
    await ctx.storage.put('gameState', { phase: 'astrogation' });
    await ctx.storage.put('inactivityAt', 99999);
    const ws = { send() {} };
    ctx.acceptWebSocket(ws, ['player:1']);
    const game = createGameDO(ctx);
    await game.webSocketClose(ws as unknown as WebSocket);
    expect(await ctx.storage.get('disconnectedPlayer')).toBe(1);
    expect(await ctx.storage.get('disconnectTime')).toBe(1000);
    expect(await ctx.storage.get('disconnectAt')).toBe(31000);
    expect(ctx.storage.alarmAt).toBe(31000);
  });
  it('clears an expired disconnect marker and notifies the remaining player', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const ctx = createCtx();
    await ctx.storage.put('disconnectedPlayer', 0);
    await ctx.storage.put('disconnectTime', 5000);
    await ctx.storage.put('disconnectAt', 9000);
    await ctx.storage.put('inactivityAt', 20000);
    const ws = {
      sent: [] as string[],
      send(payload: string) {
        this.sent.push(payload);
      },
    };
    ctx.acceptWebSocket(ws, ['player:1']);
    const game = createGameDO(ctx);
    await game.alarm();
    expect(await ctx.storage.get('disconnectedPlayer')).toBeUndefined();
    expect(await ctx.storage.get('disconnectTime')).toBeUndefined();
    expect(await ctx.storage.get('disconnectAt')).toBeUndefined();
    expect(ctx.storage.alarmAt).toBe(20000);
    expect(JSON.parse(must(ws.sent[0]))).toEqual({
      type: 'opponentDisconnected',
    });
  });
  it('advances a timed-out turn through the alarm path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const ctx = createCtx();
    const state = createGame(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      'TIME1',
      findBaseHex,
    );
    await ctx.storage.put('gameState', state);
    await ctx.storage.put('turnTimeoutAt', 9500);
    await ctx.storage.put('inactivityAt', 30000);
    const game = createGameDO(ctx);
    await game.alarm();
    const nextState = await ctx.storage.get<GameState>('gameState');
    expect(must(nextState).activePlayer).toBe(1);
    expect(await ctx.storage.get('turnTimeoutAt')).toBeGreaterThan(10000);
    expect(ctx.storage.alarmAt).toBe(30000);
  });

  it('persists state before broadcasting it to clients', async () => {
    const ctx = createCtx();
    const trace: string[] = [];
    const originalPut = ctx.storage.put.bind(ctx.storage);
    vi.spyOn(ctx.storage, 'put').mockImplementation(async (key, value) => {
      if (key === 'gameState') {
        trace.push('put:gameState');
      }
      await originalPut(key, value);
    });
    const ws = {
      sent: [] as string[],
      send(payload: string) {
        trace.push('send');
        this.sent.push(payload);
      },
    };
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SAVE1',
      findBaseHex,
    );

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: { restartTurnTimer?: boolean; events?: unknown[] },
        ) => Promise<void>;
      }
    ).publishStateChange(state, undefined, {
      restartTurnTimer: false,
    });

    expect(trace).toContain('put:gameState');
    expect(trace).toContain('send');
    expect(trace.indexOf('put:gameState')).toBeLessThan(trace.indexOf('send'));
    expect(await ctx.storage.get('gameState')).toEqual(state);
  });

  it('emits one state-bearing message for state-update actions', async () => {
    const ctx = createCtx();
    const ws = createSocket();
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'STAT1',
      findBaseHex,
    );

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: { restartTurnTimer?: boolean; events?: unknown[] },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toStateUpdateMessage(state), {
      restartTurnTimer: false,
    });

    const messages = ws.sent.map((payload) => JSON.parse(payload) as S2C);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'stateUpdate',
      state,
    });

    const deps = createMessageHandlerDeps();
    for (const message of messages) {
      handleServerMessage(deps, message);
    }
    expect(deps.transitionCount).toBe(1);
  });

  it('keeps movement results as the only state-bearing message', async () => {
    const ctx = createCtx();
    const ws = createSocket();
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'MOVE1',
      findBaseHex,
    );
    const movementResult: MovementResult = {
      state,
      movements: [],
      ordnanceMovements: [],
      events: [],
    };

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: { restartTurnTimer?: boolean; events?: unknown[] },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toMovementResultMessage(movementResult), {
      restartTurnTimer: false,
    });

    const messages = ws.sent.map((payload) => JSON.parse(payload) as S2C);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'movementResult',
      movements: [],
      ordnanceMovements: [],
      events: [],
      state,
    });
  });

  it('appends game-over after a single state-bearing terminal update', async () => {
    const ctx = createCtx();
    const ws = createSocket();
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const base = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'OVER1',
      findBaseHex,
    );
    const state: GameState = {
      ...base,
      phase: 'gameOver',
      winner: 0,
      winReason: 'Fleet eliminated!',
    };

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: { restartTurnTimer?: boolean; events?: unknown[] },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toStateUpdateMessage(state), {
      restartTurnTimer: false,
    });

    const messages = ws.sent.map((payload) => JSON.parse(payload) as S2C);

    expect(messages).toEqual([
      {
        type: 'stateUpdate',
        state,
      },
      {
        type: 'gameOver',
        winner: 0,
        reason: 'Fleet eliminated!',
      },
    ]);
  });
});
