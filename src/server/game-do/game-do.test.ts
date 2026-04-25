import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
  OFFICIAL_QUICK_MATCH_BOT_USERNAME,
} from '../../shared/player';
import type { ReplayTimeline } from '../../shared/replay';
import {
  appendEnvelopedEvents,
  getEventStream,
  getProjectedCurrentStateRaw,
  saveCheckpoint,
} from './archive';
import { GameDO } from './game-do';
import { toStateUpdateMessage } from './message-builders';

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

type MockStorage = DurableObjectStorage & {
  alarmAt: number | null;
};

const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();
  const storage: {
    alarmAt: number | null;
    get: <T>(key: string | string[]) => Promise<T | undefined>;
    put: <T>(
      key: string | Record<string, T> | string[],
      value?: T,
    ) => Promise<boolean>;
    delete: (key: string) => Promise<void>;
    deleteAll: () => Promise<void>;
    setAlarm: (value: number) => Promise<void>;
  } = {
    alarmAt: null,
    async get<T>(key: string | string[]): Promise<T | undefined> {
      if (typeof key !== 'string') return undefined;
      return data.get(key) as T | undefined;
    },
    async put<T>(
      key: string | Record<string, T> | string[],
      value?: T,
    ): Promise<boolean> {
      if (Array.isArray(key)) return true;
      if (typeof key === 'string') {
        data.set(key, value);
        return true;
      }

      for (const [entryKey, entryValue] of Object.entries(key)) {
        data.set(entryKey, entryValue);
      }
      return true;
    },
    async delete(key: string): Promise<void> {
      data.delete(key);
    },
    async deleteAll(): Promise<void> {
      data.clear();
    },
    async setAlarm(value: number): Promise<void> {
      storage.alarmAt = value;
    },
  };

  return storage as unknown as MockStorage;
};

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
  const storage = createMockStorage();
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

const createEventsDb = () => {
  const events: Array<{ event: string; props: Record<string, unknown> }> = [];
  const db = {
    prepare(_sql: string) {
      return {
        bind(
          _ts: number,
          _anonId: unknown,
          event: string,
          props: string,
          _ipHash: string,
          _ua: unknown,
        ) {
          return {
            run: async () => {
              events.push({
                event,
                props: JSON.parse(props) as Record<string, unknown>,
              });
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, events };
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

describe('GameDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('WebSocketPair', function WebSocketPairStub() {
      const client = createSocket();
      const server = createSocket();
      return { 0: client, 1: server };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      players: [
        {
          playerKey: 'seat0',
          username: 'Player 1',
          kind: 'human',
        },
        {
          playerKey: 'seat1',
          username: 'Player 2',
          kind: 'human',
        },
      ],
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
    expect(await response.text()).toContain('ROOM_NOT_FOUND');
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
  it('returns 404 for spectator websocket upgrades when the room is missing', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/ws/ABCDE?viewer=spectator', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(404);
  });
  it('accepts spectator websocket upgrades without a player token', async () => {
    const OriginalResponse = globalThis.Response;
    globalThis.Response = class SwitchingProtocolsResponse {
      readonly status: number;
      readonly webSocket: WebSocket;
      constructor(_body: null, init: { status: number; webSocket: WebSocket }) {
        this.status = init.status;
        this.webSocket = init.webSocket;
      }
    } as unknown as typeof Response;

    try {
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

      expect(response.status).toBe(101);
      expect(ctx.getWebSockets('spectator')).toHaveLength(1);
    } finally {
      globalThis.Response = OriginalResponse;
    }
  });
  it('rejects spectator websocket upgrades when the room spectator cap is reached', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
    });
    for (let index = 0; index < 8; index++) {
      ctx.acceptWebSocket(createSocket(), ['spectator']);
    }
    const game = createGameDO(ctx);
    const response = await game.fetch(
      new Request('https://room.internal/ws/ABCDE?viewer=spectator', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.text()).toBe('Spectator capacity reached');
    expect(ctx.getWebSockets('spectator')).toHaveLength(8);
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
    expect(await response.json()).toEqual({
      ok: true,
      scenario: 'biplanetary',
      seatStatus: 'host-only',
    });
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
        resolveJoinAttempt: (
          playerToken: string | null,
        ) => Promise<
          | { ok: false; error: Response }
          | { ok: true; value: Record<string, unknown> }
        >;
      }
    ).resolveJoinAttempt('A'.repeat(32));

    expect(joinAttempt).toMatchObject({
      ok: true,
      value: {
        playerId: 0,
        issueNewToken: false,
        disconnectedPlayer: null,
        seatOpen: [false, true],
      },
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
        ) => Promise<{ ok: false; error: Response } | { ok: true }>;
      }
    ).resolveJoinAttempt('B'.repeat(32));

    expect(joinAttempt.ok).toBe(false);
    if (!joinAttempt.ok) {
      expect(joinAttempt.error.status).toBe(403);
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
        resolveJoinAttempt: (
          playerToken: string | null,
        ) => Promise<
          | { ok: false; error: Response }
          | { ok: true; value: Record<string, unknown> }
        >;
      }
    ).resolveJoinAttempt('B'.repeat(32));

    expect(joinAttempt).toMatchObject({
      ok: true,
      value: {
        playerId: 1,
        disconnectedPlayer: 1,
        seatOpen: [true, true],
      },
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
      asGameId('ABCDE-m1'),
    );
    expect(must(state).gameId).toBe('ABCDE-m1');

    const eventStream = await getEventStream(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('ABCDE-m1'),
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
      asGameId('ABCDE-m1'),
    );

    await initGame();
    const secondState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('ABCDE-m2'),
    );

    expect(must(firstState).gameId).toBe('ABCDE-m1');
    expect(must(secondState).gameId).toBe('ABCDE-m2');
    expect(
      await getEventStream(
        ctx.storage as unknown as DurableObjectStorage,
        asGameId('ABCDE-m1'),
      ),
    ).toHaveLength(1);
    expect(
      await getEventStream(
        ctx.storage as unknown as DurableObjectStorage,
        asGameId('ABCDE-m2'),
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
      code: 'INVALID_INPUT',
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
      'combatSingle',
      'emplaceBase',
      'endCombat',
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      asGameId('DISC1-m1'),
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'DISC1');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('DISC1-m1'),
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      asGameId('DISC2-m1'),
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'DISC2');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('DISC2-m1'),
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      asGameId('DC01-m1'),
      findBaseHex,
    );
    state.phase = 'astrogation';
    await ctx.storage.put('gameCode', 'DC01');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('DC01-m1'),
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
      asGameId('DC01-m1'),
    );
    expect(saved?.phase).toBe('gameOver');
    expect(saved?.outcome?.winner).toBe(1);
    expect(saved?.outcome?.reason).toBe('Opponent disconnected');
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      buildSolarSystemMap(),
      asGameId('TIME1-m1'),
      findBaseHex,
    );
    await ctx.storage.put('gameCode', 'TIME1');
    await ctx.storage.put('matchNumber', 1);
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('TIME1-m1'),
      state,
      0,
    );
    await ctx.storage.put('turnTimeoutAt', 9500);
    await ctx.storage.put('inactivityAt', 30000);
    const game = createGameDO(ctx);
    await game.alarm();
    const nextState = await getProjectedCurrentStateRaw(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('TIME1-m1'),
    );
    expect(must(nextState).activePlayer).toBe(1);
    expect(await ctx.storage.get('turnTimeoutAt')).toBeGreaterThan(10000);
    expect(ctx.storage.alarmAt).toBe(30000);
  });

  it('swallows Durable Object code-update errors on websocket close and logs context', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const ws = { send() {} };
    ctx.acceptWebSocket(ws, ['player:1']);

    (
      game as unknown as {
        currentStateCache: {
          gameId: ReturnType<typeof asGameId>;
          state: GameState;
        };
        gameCodeCache: string;
      }
    ).currentStateCache = {
      gameId: asGameId('EVICT1-m1'),
      state: {
        ...createGameOrThrow(
          SCENARIOS.biplanetary,
          buildSolarSystemMap(),
          asGameId('EVICT1-m1'),
          findBaseHex,
        ),
        phase: 'astrogation',
        turnNumber: 3,
      },
    };
    (
      game as unknown as {
        gameCodeCache: string;
      }
    ).gameCodeCache = 'EVICT1';

    vi.spyOn(
      game as unknown as {
        getCurrentGameState: () => Promise<GameState | null>;
      },
      'getCurrentGameState',
    ).mockRejectedValue(
      new TypeError(
        "The Durable Object's code has been updated, this version can no longer access storage.",
      ),
    );

    await expect(
      game.webSocketClose(ws as unknown as WebSocket),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[game_do_code_update_evicted]',
      expect.objectContaining({
        entrypoint: 'webSocketClose',
        code: 'EVICT1',
        gameId: 'EVICT1-m1',
        phase: 'astrogation',
        turn: 3,
        playerId: 1,
      }),
    );
  });

  it('swallows Durable Object code-update errors on alarm and logs context', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const ctx = createCtx();
    const game = createGameDO(ctx);
    (
      game as unknown as {
        currentStateCache: {
          gameId: ReturnType<typeof asGameId>;
          state: GameState;
        };
        gameCodeCache: string;
      }
    ).currentStateCache = {
      gameId: asGameId('EVICT2-m1'),
      state: {
        ...createGameOrThrow(
          SCENARIOS.biplanetary,
          buildSolarSystemMap(),
          asGameId('EVICT2-m1'),
          findBaseHex,
        ),
        phase: 'astrogation',
        turnNumber: 4,
      },
    };
    (
      game as unknown as {
        gameCodeCache: string;
      }
    ).gameCodeCache = 'EVICT2';

    vi.spyOn(
      game as unknown as {
        getCurrentGameState: () => Promise<GameState | null>;
      },
      'getCurrentGameState',
    ).mockRejectedValue(
      new TypeError(
        "The Durable Object's code has been updated, this version can no longer access storage.",
      ),
    );
    await ctx.storage.put('disconnectedPlayer', 0);
    await ctx.storage.put('disconnectAt', 9000);

    await expect(game.alarm()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[game_do_code_update_evicted]',
      expect.objectContaining({
        entrypoint: 'alarm',
        code: 'EVICT2',
        gameId: 'EVICT2-m1',
        phase: 'astrogation',
        turn: 4,
      }),
    );
  });

  it('persists state before broadcasting it to clients', async () => {
    const ctx = createCtx();
    const trace: string[] = [];
    const originalPut = ctx.storage.put.bind(ctx.storage);
    vi.spyOn(ctx.storage, 'put').mockImplementation(async (key, value) => {
      const putKey = key as unknown;
      if (
        (typeof putKey === 'string' && putKey.startsWith('events:SAVE1')) ||
        (typeof putKey === 'object' &&
          putKey !== null &&
          !Array.isArray(putKey) &&
          Object.keys(putKey).some((entryKey) =>
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SAVE1'),
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
        asGameId('SAVE1'),
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('ABCDE-m1'),
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
      asGameId('ABCDE-m1'),
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('STAT1'),
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
  });

  it('keeps movement results as the only state-bearing message', async () => {
    const ctx = createCtx();
    const ws = createSocket();
    ctx.acceptWebSocket(ws, ['player:0']);
    const game = createGameDO(ctx);
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('MOVE1'),
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
    ).publishStateChange(
      state,
      {
        type: 'movementResult',
        movements: movementResult.movements,
        ordnanceMovements: movementResult.ordnanceMovements,
        events: movementResult.events,
        state: movementResult.state,
      },
      {
        restartTurnTimer: false,
      },
    );

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
    const base = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('OVER1'),
      findBaseHex,
    );
    const state: GameState = {
      ...base,
      phase: 'gameOver',
      outcome: { winner: 0, reason: 'Fleet eliminated!' },
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

    // Both seats connected → full 5-minute window. Without sockets the room
    // is treated as solo-waiting and gets the shorter timeout (covered
    // separately below).
    ctx.acceptWebSocket({}, ['player:0']);
    ctx.acceptWebSocket({}, ['player:1']);

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

  it('uses the shorter solo timeout when waiting for a second human', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const touch = (
      game as unknown as { touchInactivity: () => Promise<void> }
    ).touchInactivity.bind(game);

    ctx.acceptWebSocket({}, ['player:0']);

    vi.spyOn(Date, 'now').mockReturnValue(200_000);
    await touch();
    expect(await ctx.storage.get<number>('inactivityAt')).toBe(
      200_000 + 60_000,
    );
  });

  it('keeps the full timeout when the empty seat is reserved for an agent', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const touch = (
      game as unknown as { touchInactivity: () => Promise<void> }
    ).touchInactivity.bind(game);

    ctx.acceptWebSocket({}, ['player:0']);
    await ctx.storage.put('roomConfig', {
      players: [{ kind: 'human' }, { kind: 'agent' }],
    });

    vi.spyOn(Date, 'now').mockReturnValue(300_000);
    await touch();
    expect(await ctx.storage.get<number>('inactivityAt')).toBe(
      300_000 + 300_000,
    );
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
      asGameId('HAPPY-m1'),
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
      asGameId('HAPPY-m1'),
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

  it('tags game_started telemetry for official bot matches', async () => {
    const ctx = createCtx();
    const { db, events } = createEventsDb();
    const game = createGameDO(ctx, { DB: db });

    const initResponse = await game.fetch(
      new Request('https://room.internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'BOTGM',
          scenario: 'duel',
          playerToken: 'A'.repeat(32),
          guestPlayerToken: 'B'.repeat(32),
          players: [
            { playerKey: 'humanplayer1', username: 'Pilot One', kind: 'human' },
            {
              playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
              username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
              kind: 'agent',
            },
          ],
        }),
      }),
    );
    expect(initResponse.status).toBe(201);

    await (game as unknown as { initGame: () => Promise<void> }).initGame();

    const started = events.find((entry) => entry.event === 'game_started');
    expect(started?.props.officialBotMatch).toBe(true);
    expect(started?.props.scenario).toBe('duel');
  });

  it('tags game_ended telemetry for official bot matches', async () => {
    const ctx = createCtx();
    const { db, events } = createEventsDb();
    const game = createGameDO(ctx, { DB: db });

    const initResponse = await game.fetch(
      new Request('https://room.internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'BOTGE',
          scenario: 'duel',
          playerToken: 'A'.repeat(32),
          guestPlayerToken: 'B'.repeat(32),
          players: [
            { playerKey: 'humanplayer1', username: 'Pilot One', kind: 'human' },
            {
              playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
              username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
              kind: 'agent',
            },
          ],
        }),
      }),
    );
    expect(initResponse.status).toBe(201);

    await (game as unknown as { initGame: () => Promise<void> }).initGame();
    const state = must(
      await getProjectedCurrentStateRaw(
        ctx.storage as unknown as DurableObjectStorage,
        asGameId('BOTGE-m1'),
      ),
    );
    const gameOverState: GameState = {
      ...state,
      phase: 'gameOver',
      outcome: { winner: 0, reason: 'Test outcome' },
    };

    await (
      game as unknown as {
        publishStateChange: (
          state: GameState,
          primaryMessage?: unknown,
          options?: { restartTurnTimer?: boolean; events?: unknown[] },
        ) => Promise<void>;
      }
    ).publishStateChange(gameOverState, toStateUpdateMessage(gameOverState), {
      restartTurnTimer: false,
    });

    const ended = events.find((entry) => entry.event === 'game_ended');
    expect(ended?.props.officialBotMatch).toBe(true);
    expect(ended?.props.reason).toBe('Test outcome');
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

    const state = createGameOrThrow(
      SCENARIOS.escape,
      buildSolarSystemMap(),
      asGameId('SPEC1-m1'),
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

    (
      game as unknown as {
        broadcastStateChange: (state: GameState) => void;
      }
    ).broadcastStateChange(state);

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
      asGameId('ABCDE-m1'),
    );
    expect(stream).toHaveLength(1);
    expect(stream[0]?.event.type).toBe('gameCreated');

    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('ABCDE-m1'),
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
      asGameId('ABCDE-m1'),
    );
    expect(stream).toHaveLength(2);
    expect(stream[1]?.event.type).toBe('turnAdvanced');
  });

  it('reports projection parity mismatches without throwing', async () => {
    const ctx = createCtx();
    const game = createGameDO(ctx);
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('PARCHK-m1'),
      findBaseHex,
    );
    const projected = structuredClone(state);
    projected.turnNumber = state.turnNumber + 1;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await appendEnvelopedEvents(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('PARCHK-m1'),
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
        gameId: asGameId('PARCHK-m1'),
        liveTurn: state.turnNumber,
        projectedTurn: projected.turnNumber,
        diffs: expect.any(Array),
      }),
    );
  });

  it('reuses the in-memory projected state cache between reads', async () => {
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

    const storageGetSpy = vi.spyOn(ctx.storage, 'get');

    const first = await (
      game as unknown as {
        getCurrentGameState: () => Promise<GameState | null>;
      }
    ).getCurrentGameState();
    const callsAfterFirstRead = storageGetSpy.mock.calls.length;
    const second = await (
      game as unknown as {
        getCurrentGameState: () => Promise<GameState | null>;
      }
    ).getCurrentGameState();

    expect(first).toEqual(second);
    expect(storageGetSpy.mock.calls).toHaveLength(callsAfterFirstRead + 2);
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('ABCDE-m1'),
      findBaseHex,
    );
    state.turnNumber = 3;
    state.phase = 'combat';
    await saveCheckpoint(
      ctx.storage as unknown as DurableObjectStorage,
      asGameId('ABCDE-m1'),
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

  it('purges per-match storage residue on inactivity cleanup', async () => {
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

    // Pre-purge: the initialised match wrote its per-match keys.
    expect(await ctx.storage.get('matchSeed:ABCDE-m1')).toBeDefined();
    expect(await ctx.storage.get('eventChunkCount:ABCDE-m1')).toBeDefined();

    await ctx.storage.put('inactivityAt', 99_000);
    await game.alarm();

    expect(await ctx.storage.get('roomArchived')).toBe(true);
    // roomConfig stays so subsequent join probes see a 410-archived
    // response (not a misleading 404).
    expect(await ctx.storage.get('roomConfig')).toBeDefined();
    // Per-match residue is gone — abandoned DO no longer keeps ~1–2 KB
    // of event chunks / checkpoints / match identity forever.
    expect(await ctx.storage.get('matchSeed:ABCDE-m1')).toBeUndefined();
    expect(await ctx.storage.get('matchCreatedAt:ABCDE-m1')).toBeUndefined();
    expect(await ctx.storage.get('eventChunkCount:ABCDE-m1')).toBeUndefined();
    expect(await ctx.storage.get('eventSeq:ABCDE-m1')).toBeUndefined();
    expect(await ctx.storage.get('checkpoint:ABCDE-m1')).toBeUndefined();

    // Replay access is intentionally gone — completed matches have
    // already mirrored to R2 via scheduleArchiveCompletedMatch, and
    // inactivity cleanup is a terminal state for this DO.
    const response = await game.fetch(
      new Request(
        `https://room.internal/replay?playerToken=${'A'.repeat(32)}`,
        {
          method: 'GET',
        },
      ),
    );
    expect(response.status).toBe(404);
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
    expect(await response.text()).toContain('GAME_COMPLETED');
  });

  it('stores the acting player on enveloped events even after the turn advances', async () => {
    const ctx = createCtx();
    await ctx.storage.put('gameCode', 'ABCDE');
    await ctx.storage.put('matchNumber', 1);
    const game = createGameDO(ctx);
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('ABCDE-m1'),
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
      asGameId('ABCDE-m1'),
    );
    expect(stream[0]?.actor).toBe(0);
  });

  it('stores null actor for system-driven event envelopes', async () => {
    const ctx = createCtx();
    await ctx.storage.put('gameCode', 'SYS01');
    await ctx.storage.put('matchNumber', 1);
    const game = createGameDO(ctx);
    const state = createGameOrThrow(
      SCENARIOS.duel,
      buildSolarSystemMap(),
      asGameId('SYS01-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Timeout' };

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
      asGameId('SYS01-m1'),
    );
    expect(stream[0]?.actor).toBeNull();
  });
});
