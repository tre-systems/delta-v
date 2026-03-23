import { readFileSync } from 'node:fs';
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
import type { ReplayTimeline } from '../../shared/replay';
import {
  appendEnvelopedEvents,
  getEventStream,
  getProjectedCurrentStateRaw,
  saveCheckpoint,
} from './archive';
import { GameDO } from './game-do';
import { toMovementResultMessage, toStateUpdateMessage } from './messages';

const transportFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/transport.json', import.meta.url),
    'utf8',
  ),
) as {
  http: {
    initResponse: unknown;
    joinResponse: unknown;
  };
};

class MockStorage {
  private data = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof key === 'string') {
      this.data.set(key, value);
      return;
    }

    for (const [entryKey, entryValue] of Object.entries(key)) {
      this.data.set(entryKey, entryValue);
    }
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

const createCtx = (): MockDurableObjectState => {
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
};

const createSocket = () => ({
  sent: [] as string[],
  closed: false,
  closeCode: 0,
  closeReason: '',
  send(payload: string) {
    this.sent.push(payload);
  },
  close(code: number, reason: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
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
    trackEvent() {},
    deserializeState(raw) {
      return raw;
    },
    renderer: {
      setPlayerId() {},
      clearTrails() {},
    },
    ui: {
      setPlayerId() {},
      log: {
        logText() {},
        setChatEnabled() {},
        clear() {},
      },
      overlay: {
        showToast() {},
        hideReconnecting() {},
        showRematchPending() {},
        showGameOver() {},
      },
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
    });
    const inactivityAt = await ctx.storage.get<number>('inactivityAt');
    expect(typeof inactivityAt).toBe('number');
    expect(must(inactivityAt)).toBeGreaterThan(Date.now());
    expect(ctx.storage.alarmAt).toBe(inactivityAt);
  });

  it('returns fixture-backed create and join responses', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);

    const initResponse = await game.fetch(
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

    expect(await initResponse.json()).toEqual(
      transportFixtures.http.initResponse,
    );

    const joinResponse = await game.fetch(
      new Request(`https://room.internal/join?playerToken=${'A'.repeat(32)}`, {
        method: 'GET',
      }),
    );

    expect(await joinResponse.json()).toEqual(
      transportFixtures.http.joinResponse,
    );
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
  it('rejects spectator websocket fetches explicitly at the durable object boundary', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/ws/ABCDE?viewer=spectator', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(501);
    expect(await response.text()).toContain(
      'Spectator websocket joins are not supported',
    );
  });
  it('supports join preflight checks without mutating room tokens', async () => {
    const ctx = createCtx();
    const roomConfig = {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null] as [string, string | null],
    };
    await ctx.storage.put('roomConfig', roomConfig);
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request(`https://room.internal/join?playerToken=${'A'.repeat(32)}`, {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await ctx.storage.get('roomConfig')).toEqual(roomConfig);
  });
  it('accepts a stored player token even while the old socket is still open', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
    });
    const oldSocket = createSocket();
    ctx.acceptWebSocket(oldSocket, ['player:0']);
    const game = createGameDO(ctx);

    const joinAttempt = await (
      game as unknown as {
        resolveJoinAttempt: (playerToken: string | null) => Promise<
          | { ok: false; response: Response }
          | {
              ok: true;
              playerId: 0 | 1;
              issueNewToken: boolean;
              disconnectedPlayer: number | null;
              seatOpen: [boolean, boolean];
            }
        >;
      }
    ).resolveJoinAttempt('A'.repeat(32));

    expect(joinAttempt).toMatchObject({
      ok: true,
      playerId: 0,
      issueNewToken: false,
      disconnectedPlayer: null,
      seatOpen: [false, true],
    });
    expect(oldSocket.closed).toBe(false);
  });
  it('counts unique connected seats after a reclaim instead of raw socket count', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);

    const getConnectedSeatCountAfterJoin = (
      game as unknown as {
        getConnectedSeatCountAfterJoin: (
          seatOpen: [boolean, boolean],
          playerId: 0 | 1,
        ) => number;
      }
    ).getConnectedSeatCountAfterJoin.bind(game);

    expect(getConnectedSeatCountAfterJoin([false, true], 0)).toBe(1);
    expect(getConnectedSeatCountAfterJoin([true, false], 0)).toBe(2);
  });
  it('closes existing sockets only after a reclaim is accepted', async () => {
    const ctx = createCtx();
    const oldSocket = createSocket();
    ctx.acceptWebSocket(oldSocket, ['player:0']);
    const game = createGameDO(ctx);

    (
      game as unknown as {
        replacePlayerSockets: (playerId: 0 | 1) => void;
      }
    ).replacePlayerSockets(0);

    expect(oldSocket.closed).toBe(true);
    expect(oldSocket.closeCode).toBe(1000);
    expect(oldSocket.closeReason).toBe('Replaced by new connection');
    expect(
      (
        game as unknown as { replacedSockets: WeakSet<WebSocket> }
      ).replacedSockets.has(oldSocket as unknown as WebSocket),
    ).toBe(true);
  });
  it('keeps existing sockets open when a wrong but well-formed token is rejected', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
    });
    const oldSocket = createSocket();
    ctx.acceptWebSocket(oldSocket, ['player:0']);
    const game = createGameDO(ctx);

    const joinAttempt = await (
      game as unknown as {
        resolveJoinAttempt: (
          playerToken: string | null,
        ) => Promise<{ ok: false; response: Response } | { ok: true }>;
      }
    ).resolveJoinAttempt('B'.repeat(32));

    expect(joinAttempt.ok).toBe(false);
    if (!joinAttempt.ok) {
      expect(joinAttempt.response.status).toBe(403);
    }
    expect(oldSocket.closed).toBe(false);
  });
  it('accepts reconnect during the disconnect grace window and surfaces the marker', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('disconnectedPlayer', 1);
    const game = createGameDO(ctx);

    const joinAttempt = await (
      game as unknown as {
        resolveJoinAttempt: (playerToken: string | null) => Promise<
          | { ok: false; response: Response }
          | {
              ok: true;
              playerId: 0 | 1;
              disconnectedPlayer: number | null;
              seatOpen: [boolean, boolean];
            }
        >;
      }
    ).resolveJoinAttempt('B'.repeat(32));

    expect(joinAttempt).toMatchObject({
      ok: true,
      playerId: 1,
      disconnectedPlayer: 1,
      seatOpen: [true, true],
    });
  });
  it('creates a stable match id on game start', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    await (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame();

    const state = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(must(state).gameId).toBe('ABCDE-m1');

    const eventStream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(eventStream[0]?.event.type).toBe('gameCreated');
    expect(await ctx.storage.get('matchCreatedAt:ABCDE-m1')).toEqual(
      expect.any(Number),
    );
  });
  it('keeps event streams isolated across rematches', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    const initGame = (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame.bind(game);

    await initGame();
    const firstState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );

    await initGame();
    const secondState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m2',
    );

    expect(must(firstState).gameId).toBe('ABCDE-m1');
    expect(must(secondState).gameId).toBe('ABCDE-m2');
    expect(
      await getEventStream(
        ctx.storage as unknown as DurableObjectStorage,
        'ABCDE-m1',
      ),
    ).toHaveLength(1);
    expect(
      await getEventStream(
        ctx.storage as unknown as DurableObjectStorage,
        'ABCDE-m2',
      ),
    ).toHaveLength(1);
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
  it('registers every stateful websocket action in the declarative handler table', () => {
    const game = createGameDO(createCtx()) as unknown as {
      gameStateActionHandlers: Record<string, unknown>;
    };

    expect(Object.keys(game.gameStateActionHandlers).sort()).toEqual([
      'astrogation',
      'beginCombat',
      'combat',
      'emplaceBase',
      'fleetReady',
      'logistics',
      'ordnance',
      'skipCombat',
      'skipLogistics',
      'skipOrdnance',
      'surrender',
    ]);
  });
  it('stores a disconnect marker and alarm when a live player disconnects', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const ctx = createCtx();
    const state = createGame(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      'DISC1-m1',
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'DISC1');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      'DISC1-m1',
      state,
      0,
    );
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
  it('ignores close events for intentionally replaced sockets', async () => {
    const ctx = createCtx();
    const state = createGame(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      'DISC2-m1',
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'DISC2');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      'DISC2-m1',
      state,
      0,
    );
    const ws = { send() {} };
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);

    (
      game as unknown as { replacedSockets: WeakSet<WebSocket> }
    ).replacedSockets.add(ws as unknown as WebSocket);

    await game.webSocketClose(ws as unknown as WebSocket);

    expect(await ctx.storage.get('disconnectedPlayer')).toBeUndefined();
    expect(await ctx.storage.get('disconnectAt')).toBeUndefined();
  });
  it('clears an expired disconnect marker and ends game as forfeit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const ctx = createCtx();
    const state = createGame(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      'DC01-m1',
      findBaseHex,
    );
    state.phase = 'astrogation';
    await ctx.storage.put('gameCode', 'DC01');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      'DC01-m1',
      state,
      0,
    );
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
    const saved = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'DC01-m1',
    );
    expect(saved?.phase).toBe('gameOver');
    expect(saved?.winner).toBe(1);
    expect(saved?.winReason).toBe('Opponent disconnected');
    const msgs = ws.sent.map((s) => JSON.parse(s));
    expect(msgs[0].type).toBe('stateUpdate');
    expect(msgs[1]).toEqual({
      type: 'gameOver',
      winner: 1,
      reason: 'Opponent disconnected',
    });
  });
  it('advances a timed-out turn through the alarm path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const ctx = createCtx();
    const state = createGame(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      'TIME1-m1',
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'TIME1');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      'TIME1-m1',
      state,
      0,
    );
    await ctx.storage.put('turnTimeoutAt', 9500);
    await ctx.storage.put('inactivityAt', 30000);
    const game = createGameDO(ctx);
    await game.alarm();
    const nextState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'TIME1-m1',
    );
    expect(must(nextState).activePlayer).toBe(1);
    expect(await ctx.storage.get('turnTimeoutAt')).toBeGreaterThan(10000);
    expect(ctx.storage.alarmAt).toBe(30000);
  });

  it('persists state before broadcasting it to clients', async () => {
    const ctx = createCtx();
    const trace: string[] = [];
    const originalPut = ctx.storage.put.bind(ctx.storage);
    vi.spyOn(ctx.storage, 'put').mockImplementation(async (key, value) => {
      if (
        (typeof key === 'string' && key.startsWith('events:SAVE1')) ||
        (typeof key !== 'string' &&
          Object.keys(key).some((entryKey) =>
            entryKey.startsWith('events:SAVE1'),
          ))
      ) {
        trace.push('put:events');
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
      events: [
        {
          type: 'gameCreated',
          scenario: state.scenario,
          turn: state.turnNumber,
          phase: state.phase,
          matchSeed: 0,
        },
      ],
    });

    expect(trace).toContain('put:events');
    expect(trace).toContain('send');
    expect(trace.indexOf('put:events')).toBeLessThan(trace.indexOf('send'));
    expect(
      await getProjectedCurrentStateRaw(
        ctx.storage as unknown as DurableObjectStorage,
        'SAVE1',
      ),
    ).toEqual(state);
  });

  it('records state-bearing updates in the event stream', async () => {
    const ctx = createCtx();
    await ctx.storage.put('gameCode', 'ABCDE');
    await ctx.storage.put('matchNumber', 1);
    const ws = createSocket();
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'ABCDE-m1',
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
      events: [
        {
          type: 'gameCreated',
          scenario: state.scenario,
          turn: state.turnNumber,
          phase: state.phase,
          matchSeed: 0,
        },
      ],
    });

    const stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(stream).toHaveLength(1);
    expect(stream[0]?.event).toEqual({
      type: 'gameCreated',
      scenario: state.scenario,
      turn: state.turnNumber,
      phase: state.phase,
      matchSeed: 0,
    });
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
      events: [
        {
          type: 'gameCreated',
          scenario: state.scenario,
          turn: state.turnNumber,
          phase: state.phase,
          matchSeed: 0,
        },
      ],
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
      engineEvents: [],
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

  it('closes sockets that exceed the message rate limit', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'RATE1',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
    });
    const ws = {
      sent: [] as string[],
      closed: false,
      closeCode: 0,
      closeReason: '',
      send(payload: string) {
        this.sent.push(payload);
      },
      close(code: number, reason: string) {
        this.closed = true;
        this.closeCode = code;
        this.closeReason = reason;
      },
    };
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);

    // 10 messages within the same window — allowed
    for (let i = 0; i < 10; i++) {
      await game.webSocketMessage(
        ws as unknown as WebSocket,
        JSON.stringify({ type: 'ping', t: i }),
      );
    }
    expect(ws.closed).toBe(false);

    // 11th message exceeds rate limit — socket closed
    await game.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ type: 'ping', t: 10 }),
    );
    expect(ws.closed).toBe(true);
    expect(ws.closeCode).toBe(1008);
  });

  it('persists inactivity deadlines on every touch', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const touch = (
      game as unknown as {
        touchInactivity: () => Promise<void>;
      }
    ).touchInactivity.bind(game);

    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    await touch();
    const first = await ctx.storage.get<number>('inactivityAt');
    expect(first).toBeDefined();
    expect(first).toBe(100_000 + 300_000);

    vi.spyOn(Date, 'now').mockReturnValue(110_000);
    await touch();
    const updated = await ctx.storage.get<number>('inactivityAt');
    expect(updated).toBe(110_000 + 300_000);
    expect(updated).not.toBe(first);
    expect(ctx.storage.alarmAt).toBe(updated);
  });

  it('reads inactivity deadlines from storage for alarm scheduling', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const getDeadlines = (
      game as unknown as {
        getAlarmDeadlines: () => Promise<{
          inactivityAt?: number;
        }>;
      }
    ).getAlarmDeadlines.bind(game);

    await ctx.storage.put('inactivityAt', 123_456);

    const deadlines = await getDeadlines();
    expect(deadlines.inactivityAt).toBe(123_456);
  });

  it('chat rate limiting uses in-memory state', async () => {
    const ctx = createCtx();
    const ws = {
      sent: [] as string[],
      send(payload: string) {
        this.sent.push(payload);
      },
    };
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);

    // Send a chat message
    await game.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ type: 'chat', text: 'hi' }),
    );

    // Chat rate limit should NOT have written to storage
    const chatKey = await ctx.storage.get('lastChat:0');
    expect(chatKey).toBeUndefined();
  });
  it('runs a full multiplayer happy path: init, game start, astrogation, movement', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);

    // 1. Initialize room via /init
    const initResponse = await game.fetch(
      new Request('https://room.internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'HAPPY',
          scenario: 'biplanetary',
          playerToken: 'A'.repeat(32),
        }),
      }),
    );
    expect(initResponse.status).toBe(201);

    // 2. Both players connect (simulated via acceptWebSocket)
    const p0ws = createSocket();
    const p1ws = createSocket();
    ctx.acceptWebSocket(p0ws, ['player:0']);
    ctx.acceptWebSocket(p1ws, ['player:1']);

    const p0msgs = () => p0ws.sent.map((s) => JSON.parse(s) as S2C);
    const p1msgs = () => p1ws.sent.map((s) => JSON.parse(s) as S2C);

    // 3. Start the game (normally triggered by both seats filling)
    await (game as unknown as { initGame: () => Promise<void> }).initGame();

    // Both players should receive gameStart
    expect(p0msgs().some((m) => m.type === 'gameStart')).toBe(true);
    expect(p1msgs().some((m) => m.type === 'gameStart')).toBe(true);

    // Game state should be persisted in astrogation
    const gameState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'HAPPY-m1',
    );
    expect(gameState).toBeDefined();
    expect(must(gameState).phase).toBe('astrogation');

    // 4. Active player submits drift orders for all ships
    const active = must(gameState).activePlayer;
    const activeWs = active === 0 ? p0ws : p1ws;
    const orders = must(gameState)
      .ships.filter((s) => s.owner === active)
      .map((s) => ({ shipId: s.id, burn: null }));

    // Clear sent buffers to isolate the response
    p0ws.sent.length = 0;
    p1ws.sent.length = 0;

    await game.webSocketMessage(
      activeWs as unknown as WebSocket,
      JSON.stringify({ type: 'astrogation', orders }),
    );

    // 5. Both players should receive a state-bearing broadcast
    const hasBroadcast = (msgs: S2C[]) =>
      msgs.some((m) => m.type === 'movementResult' || m.type === 'stateUpdate');

    expect(hasBroadcast(p0msgs())).toBe(true);
    expect(hasBroadcast(p1msgs())).toBe(true);

    // 6. Game state should have advanced past the first player
    const nextState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      'HAPPY-m1',
    );
    expect(nextState).toBeDefined();
    expect(must(nextState).turnNumber).toBeGreaterThanOrEqual(
      must(gameState).turnNumber,
    );

    // 7. Event stream should have been appended
    const stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      must(gameState).gameId,
    );
    expect(stream.length).toBeGreaterThan(1);
  });

  it('returns filtered replay timelines for authenticated players', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    await (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame();

    const response = await game.fetch(
      new Request(
        `https://room.internal/replay?playerToken=${'A'.repeat(32)}&gameId=ABCDE-m1`,
        {
          method: 'GET',
        },
      ),
    );

    expect(response.status).toBe(200);
    const timeline = (await response.json()) as ReplayTimeline;
    expect(timeline.gameId).toBe('ABCDE-m1');
    expect(timeline.entries.length).toBeGreaterThanOrEqual(1);
    expect(timeline.entries[0]?.message.type).toBe('gameStart');
  });

  it('returns filtered replay timelines for spectator viewers', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    await (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame();

    const response = await game.fetch(
      new Request(
        'https://room.internal/replay?viewer=spectator&gameId=ABCDE-m1',
        {
          method: 'GET',
        },
      ),
    );

    expect(response.status).toBe(200);
    const timeline = (await response.json()) as ReplayTimeline;
    expect(timeline.gameId).toBe('ABCDE-m1');
    expect(timeline.entries.length).toBeGreaterThanOrEqual(1);

    const firstState = timeline.entries[0]?.message.state;
    const concealedShip = firstState?.ships.find(
      (ship) => ship.owner === 1 && ship.identity?.revealed !== true,
    );
    expect(concealedShip?.identity).toBeUndefined();
  });

  it('broadcasts state updates to spectator sockets with spectator filtering', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const spectator = createSocket();
    ctx.acceptWebSocket(spectator, ['spectator']);

    const state = createGame(
      SCENARIOS.escape,
      buildSolarSystemMap(),
      'SPEC1-m1',
      findBaseHex,
    );
    state.scenarioRules = {
      ...state.scenarioRules,
      hiddenIdentityInspection: true,
    };
    const hiddenShip = state.ships.find((ship) => ship.owner === 1);

    if (hiddenShip) {
      hiddenShip.identity = {
        hasFugitives: true,
        revealed: false,
      };
    }

    await (
      game as unknown as {
        broadcastFiltered: (msg: Extract<S2C, { state: GameState }>) => void;
      }
    ).broadcastFiltered({
      type: 'stateUpdate',
      state,
    });

    expect(spectator.sent).toHaveLength(1);
    const message = JSON.parse(spectator.sent[0] ?? '') as Extract<
      S2C,
      { state: GameState }
    >;
    const spectatorShip = message.state.ships.find((ship) => ship.owner === 1);
    expect(spectatorShip?.identity).toBeUndefined();
  });

  it('stores replayable events for game start and later state changes', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    await (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame();

    let stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(stream).toHaveLength(1);
    expect(stream[0]?.event.type).toBe('gameCreated');

    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'ABCDE-m1',
      findBaseHex,
    );
    state.turnNumber = 2;

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: {
            actor?: number | null;
            restartTurnTimer?: boolean;
            events?: unknown[];
          },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toStateUpdateMessage(state), {
      actor: 0,
      restartTurnTimer: false,
      events: [
        {
          type: 'turnAdvanced',
          turn: state.turnNumber,
          activePlayer: state.activePlayer,
        },
      ],
    });

    stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(stream).toHaveLength(2);
    expect(stream[1]?.event.type).toBe('turnAdvanced');
  });

  it('reports projection parity mismatches without throwing', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'PARCHK-m1',
      findBaseHex,
    );
    const projected = structuredClone(state);
    projected.turnNumber = state.turnNumber + 1;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await appendEnvelopedEvents(
      ctx.storage as unknown as DurableObjectStorage,
      'PARCHK-m1',
      null,
      {
        type: 'gameCreated',
        scenario: state.scenario,
        turn: state.turnNumber,
        phase: state.phase,
        matchSeed: 0,
      },
      {
        type: 'turnAdvanced',
        turn: projected.turnNumber,
        activePlayer: projected.activePlayer,
      },
    );

    await (
      game as unknown as {
        verifyProjectionParity: (state: GameState) => Promise<void>;
      }
    ).verifyProjectionParity(state);

    expect(errorSpy).toHaveBeenCalledWith(
      '[projection parity mismatch]',
      expect.objectContaining({
        gameId: 'PARCHK-m1',
        liveTurn: state.turnNumber,
        projectedTurn: projected.turnNumber,
      }),
    );
  });

  it('falls back to checkpoint-backed replay when archive is unavailable', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    await ctx.storage.put('matchNumber', 1);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'ABCDE-m1',
      findBaseHex,
    );
    state.turnNumber = 3;
    state.phase = 'combat';
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
      state,
      9,
    );
    const game = createGameDO(ctx);

    const response = await game.fetch(
      new Request(
        `https://room.internal/replay?playerToken=${'A'.repeat(32)}&gameId=ABCDE-m1`,
        { method: 'GET' },
      ),
    );

    expect(response.status).toBe(200);
    const timeline = (await response.json()) as ReplayTimeline;
    expect(timeline.gameId).toBe('ABCDE-m1');
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]?.message.type).toBe('stateUpdate');
    expect(timeline.entries[0]?.turn).toBe(3);
    expect(timeline.entries[0]?.phase).toBe('combat');
  });

  it('keeps replay access available after inactivity cleanup', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('gameCode', 'ABCDE');
    const game = createGameDO(ctx);

    await (
      game as unknown as {
        initGame: () => Promise<void>;
      }
    ).initGame();

    await ctx.storage.put('inactivityAt', 99_000);
    await game.alarm();

    expect(await ctx.storage.get('roomArchived')).toBe(true);
    expect(await ctx.storage.get('roomConfig')).toBeDefined();

    const response = await game.fetch(
      new Request(
        `https://room.internal/replay?playerToken=${'A'.repeat(32)}`,
        {
          method: 'GET',
        },
      ),
    );

    expect(response.status).toBe(200);
    const timeline = (await response.json()) as ReplayTimeline;
    expect(timeline.gameId).toBe('ABCDE-m1');
  });

  it('rejects new joins for archived rooms', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    await ctx.storage.put('roomArchived', true);
    const game = createGameDO(ctx);

    const response = await game.fetch(
      new Request('https://room.internal/join', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.text()).toContain('Game archived');
  });

  it('stores the acting player on enveloped events even after the turn advances', async () => {
    const ctx = createCtx();
    await ctx.storage.put('gameCode', 'ABCDE');
    await ctx.storage.put('matchNumber', 1);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'ABCDE-m1',
      findBaseHex,
    );
    state.activePlayer = 1;

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: {
            actor?: number | null;
            restartTurnTimer?: boolean;
            events?: unknown[];
          },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toStateUpdateMessage(state), {
      actor: 0,
      restartTurnTimer: false,
      events: [
        {
          type: 'turnAdvanced',
          turn: state.turnNumber,
          activePlayer: state.activePlayer,
        },
      ],
    });

    const stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'ABCDE-m1',
    );
    expect(stream[0]?.actor).toBe(0);
  });

  it('stores null actor for system-driven event envelopes', async () => {
    const ctx = createCtx();
    await ctx.storage.put('gameCode', 'SYS01');
    await ctx.storage.put('matchNumber', 1);
    const game = createGameDO(ctx);
    const state = createGame(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      'SYS01-m1',
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.winner = 0;
    state.winReason = 'Timeout';

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: {
            actor?: number | null;
            restartTurnTimer?: boolean;
            events?: unknown[];
          },
        ) => Promise<void>;
      }
    ).publishStateChange(state, toStateUpdateMessage(state), {
      actor: null,
      restartTurnTimer: false,
      events: [
        {
          type: 'gameOver',
          winner: 0,
          reason: 'Timeout',
        },
      ],
    });

    const stream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      'SYS01-m1',
    );
    expect(stream[0]?.actor).toBeNull();
  });
});
