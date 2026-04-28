import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId, asPlayerToken, asRoomCode } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import type { RoomConfig } from '../protocol';
import { IdempotencyKeyCache } from './action-guards';
import { createGameStateActionHandlers } from './actions';
import { handleMcpRequest, type McpRequestDeps } from './mcp-handlers';
import {
  appendHostedMcpSeatEvent,
  readHostedMcpSeatEvents,
} from './mcp-session-state';
import { StateWaiters } from './state-waiters';

const TOKEN_A = asPlayerToken('A'.repeat(32));
const TOKEN_B = asPlayerToken('B'.repeat(32));

const ROOM: RoomConfig = {
  code: asRoomCode('ABCDE'),
  scenario: 'duel',
  playerTokens: [TOKEN_A, TOKEN_B],
  players: [
    { playerKey: 'p0', username: 'Pilot 0', kind: 'human' },
    { playerKey: 'p1', username: 'Pilot 1', kind: 'human' },
  ],
};

const ROOM_HOST_ONLY: RoomConfig = {
  ...ROOM,
  playerTokens: [TOKEN_A, null] as RoomConfig['playerTokens'],
};

// Minimal in-memory DurableObjectStorage stub for tests. Only the handful
// of methods the coach module touches are implemented — list()/transaction()
// are intentionally absent; tests that need them can extend.
const buildStorageStub = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(
      async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') {
          data.set(key, value);
          return true;
        }
        for (const [entryKey, entryValue] of Object.entries(key)) {
          data.set(entryKey, entryValue);
        }
        return true;
      },
    ),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  } as unknown as DurableObjectStorage;
};

const buildDeps = (
  overrides: Partial<McpRequestDeps> = {},
): McpRequestDeps => ({
  getRoomConfig: async () => ROOM,
  getCurrentGameState: async () => null,
  getGameCode: async () => 'ABCDE',
  reportEngineError: vi.fn(),
  // Empty handler bag is fine for routes that never dispatch actions.
  handlers: {} as ReturnType<typeof createGameStateActionHandlers>,
  idempotencyCache: new IdempotencyKeyCache(),
  stateWaiters: new StateWaiters(),
  broadcast: vi.fn(),
  touchInactivity: vi.fn().mockResolvedValue(undefined),
  storage: buildStorageStub(),
  initGameIfReady: vi.fn().mockResolvedValue(undefined),
  consumeLastTurnAutoPlayNotice: vi.fn().mockReturnValue(null),
  ...overrides,
});

// Real GameState used by the action / observation happy-path tests. Pin the
// Duel randomized-start RNG so seat 1 is active; these tests use TOKEN_B as
// the actor and assert the actionable path.
const buildDuelState = (): GameState =>
  createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('mcp-test'),
    findBaseHex,
    () => 0.75,
  );

// Build the real action-handler bag against the same map. publishStateChange
// is the side-effect we capture so the test can advance the in-memory state
// after a successful dispatch — same plumbing the GAME DO uses, no socket.
const buildHandlersAgainst = (stateRef: {
  current: GameState;
}): {
  handlers: ReturnType<typeof createGameStateActionHandlers>;
  publishCalls: number;
} => {
  const map = buildSolarSystemMap();
  const counter = { count: 0 };
  const handlers = createGameStateActionHandlers({
    map,
    getScenario: async () => SCENARIOS.duel,
    getActionRng: async () => () => 0.5,
    publishStateChange: async (next) => {
      stateRef.current = next;
      counter.count += 1;
    },
  });
  return {
    handlers,
    get publishCalls() {
      return counter.count;
    },
  } as unknown as {
    handlers: ReturnType<typeof createGameStateActionHandlers>;
    publishCalls: number;
  };
};

const url = (path: string, params?: Record<string, string>): string => {
  const u = new URL(`https://do.test${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  }
  return u.toString();
};

describe('handleMcpRequest', () => {
  it('returns null for non-MCP paths', async () => {
    const deps = buildDeps();
    const result = await handleMcpRequest(
      deps,
      new Request('https://do.test/init', { method: 'POST' }),
    );
    expect(result).toBeNull();
  });

  it('rejects missing playerToken with 400', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state'), { method: 'GET' }),
    );
    expect(res?.status).toBe(400);
  });

  it('rejects malformed playerToken with 400', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: 'short' }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(400);
  });

  it('rejects unknown room with 404', async () => {
    const deps = buildDeps({ getRoomConfig: async () => null });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: TOKEN_A }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(404);
  });

  it('rejects unknown token with 403', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: 'C'.repeat(32) }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(403);
  });

  it('returns hasState=false when game has not started', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: TOKEN_A }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      code: 'ABCDE',
      playerId: 0,
      hasState: false,
      state: null,
    });
  });

  it('returns a session summary for a seated hosted MCP player', async () => {
    const storage = buildStorageStub();
    await storage.put({
      'mcpEvents:0': [
        {
          id: 1,
          receivedAt: 123,
          type: 'chat',
          message: { type: 'chat', playerId: 0, text: 'ready' },
        },
      ],
      'mcpEventSeq:0': 2,
    });
    const state = {
      phase: 'movement',
      turnNumber: 3,
    } as unknown as GameState;
    const deps = buildDeps({
      storage,
      getCurrentGameState: async () => state,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/session-summary', { playerKey: 'p0' }), {
        method: 'GET',
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      session: Record<string, unknown>;
    };
    expect(body.session).toMatchObject({
      code: ROOM.code,
      scenario: ROOM.scenario,
      playerId: 0,
      playerToken: TOKEN_A,
      currentPhase: 'movement',
      turnNumber: 3,
      eventsBuffered: 1,
      connectionStatus: 'open',
      closed: false,
      hasState: true,
    });
  });

  it('activates hosted MCP buffering once a seat uses session-summary', async () => {
    const storage = buildStorageStub();
    const deps = buildDeps({ storage });

    const before = await readHostedMcpSeatEvents(storage, 0, { limit: 50 });
    expect(before.events).toEqual([]);

    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/session-summary', { playerKey: 'p0' }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(200);

    await appendHostedMcpSeatEvent(storage, 0, {
      type: 'chat',
      playerId: 0,
      text: 'ready',
    });
    const after = await readHostedMcpSeatEvents(storage, 0, { limit: 50 });
    expect(after.events).toHaveLength(1);
    expect(after.events[0]?.type).toBe('chat');
  });

  it('rejects session summary requests without a playerKey', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/session-summary'), { method: 'GET' }),
    );
    expect(res?.status).toBe(400);
  });

  it('returns 404 when session summary playerKey is not seated', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/session-summary', { playerKey: 'missing' }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(404);
  });

  it('returns 409 when session summary seat has no player token', async () => {
    const deps = buildDeps({ getRoomConfig: async () => ROOM_HOST_ONLY });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/session-summary', { playerKey: 'p1' }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(409);
  });

  it('triggers initGameIfReady on every MCP request after auth', async () => {
    const initGameIfReady = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ initGameIfReady });
    await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: TOKEN_A }), {
        method: 'GET',
      }),
    );
    expect(initGameIfReady).toHaveBeenCalledTimes(1);
  });

  it('observation route requires state', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/observation', { playerToken: TOKEN_A }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(409);
  });

  it('wait route returns timedOut when no state arrives', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/wait', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeoutMs: 1_000 }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      actionable: false,
      gameOver: false,
      timedOut: true,
    });
  });

  it('events route returns buffered seat events and can clear them', async () => {
    const storage = buildStorageStub();
    await storage.put({
      'mcpEvents:0': [
        {
          id: 1,
          receivedAt: 100,
          type: 'chat',
          message: { type: 'chat', playerId: 0, text: 'one' },
        },
        {
          id: 2,
          receivedAt: 200,
          type: 'actionAccepted',
          message: {
            type: 'actionAccepted',
            actionType: 'endTurn',
            turnNumber: 2,
            phase: 'movement',
            activePlayer: 0,
            guardStatus: 'inSync',
          },
        },
      ],
      'mcpEventSeq:0': 3,
    });
    const touchInactivity = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ storage, touchInactivity });

    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/events', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afterEventId: 1, limit: 5, clear: true }),
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      events: Array<{ id: number; type: string }>;
      bufferedRemaining: number;
      latestEventId: number;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ id: 2, type: 'actionAccepted' });
    expect(body.bufferedRemaining).toBe(0);
    expect(body.latestEventId).toBe(2);
    expect(await storage.get('mcpEvents:0')).toEqual([]);
    expect(touchInactivity).toHaveBeenCalledTimes(1);
  });

  it('events route tolerates invalid JSON and falls back to defaults', async () => {
    const storage = buildStorageStub();
    await storage.put({
      'mcpEvents:0': [
        {
          id: 1,
          receivedAt: 100,
          type: 'chat',
          message: { type: 'chat', playerId: 0, text: 'one' },
        },
      ],
      'mcpEventSeq:0': 2,
    });
    const deps = buildDeps({ storage });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/events', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      events: Array<{ id: number }>;
      bufferedRemaining: number;
      latestEventId: number;
    };
    expect(body.events).toEqual([expect.objectContaining({ id: 1 })]);
    expect(body.bufferedRemaining).toBe(1);
    expect(body.latestEventId).toBe(1);
  });

  it('close route clears buffered seat events', async () => {
    const storage = buildStorageStub();
    await storage.put({
      'mcpEvents:0': [
        {
          id: 1,
          receivedAt: 100,
          type: 'chat',
          message: { type: 'chat', playerId: 0, text: 'bye' },
        },
      ],
      'mcpEventSeq:0': 2,
    });
    const touchInactivity = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ storage, touchInactivity });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/close', { playerToken: TOKEN_A }), {
        method: 'POST',
      }),
    );
    expect(res?.status).toBe(200);
    expect(await storage.get('mcpEvents:0')).toEqual([]);
    expect((await res?.json()) as Record<string, unknown>).toMatchObject({
      ok: true,
      closed: true,
      clearedEvents: true,
    });
    expect(touchInactivity).toHaveBeenCalledTimes(1);
  });

  it('wait route resolves immediately with gameOver state', async () => {
    // Minimal-but-real GameState — filterStateForPlayer reads scenarioRules
    // and ships, so a single-field stub crashes the projector.
    const gameOverState = {
      phase: 'gameOver',
      activePlayer: 0,
      turnNumber: 1,
      ships: [],
      pendingAsteroidHazards: [],
      scenarioRules: {},
      scenario: 'duel',
      outcome: { winner: 0, reason: 'test' },
    } as unknown as GameState;
    const deps = buildDeps({
      getCurrentGameState: async () => gameOverState,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/wait', { playerToken: TOKEN_A }), {
        method: 'POST',
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      actionable: false,
      gameOver: true,
    });
  });

  it('action route rejects bad JSON body with 400', async () => {
    const deps = buildDeps({
      getCurrentGameState: async () =>
        ({ phase: 'astrogation' }) as unknown as GameState,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res?.status).toBe(400);
  });

  it('action route rejects empty action', async () => {
    const deps = buildDeps({
      getCurrentGameState: async () =>
        ({
          phase: 'astrogation',
          turnNumber: 1,
        }) as unknown as GameState,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: null }),
      }),
    );
    expect(res?.status).toBe(400);
  });

  it('action route rejects aux message types', async () => {
    const deps = buildDeps({
      getCurrentGameState: async () =>
        ({
          phase: 'astrogation',
          turnNumber: 1,
        }) as unknown as GameState,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: { type: 'chat', text: 'hi' },
          autoGuards: false,
        }),
      }),
    );
    expect(res?.status).toBe(400);
  });

  it('chat route validates text length', async () => {
    const deps = buildDeps();
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/chat', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      }),
    );
    expect(res?.status).toBe(400);
  });

  it('chat route broadcasts when valid', async () => {
    const broadcast = vi.fn();
    const deps = buildDeps({ broadcast });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/chat', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hi everyone' }),
      }),
    );
    expect(res?.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'chat',
      playerId: 0,
      text: 'hi everyone',
    });
  });

  it('chat route intercepts /coach and stores directive on the opposite seat', async () => {
    const broadcast = vi.fn();
    const storage = buildStorageStub();
    const deps = buildDeps({
      broadcast,
      storage,
      // Fake a live state so turnReceived gets a real number.
      getCurrentGameState: async () =>
        ({
          turnNumber: 7,
        }) as unknown as import('../../shared/types/domain').GameState,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/chat', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '/coach redirect to Mars' }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      coached: true,
      targetSeat: 1,
      text: 'redirect to Mars',
    });
    // Directive landed on seat 1 (opposite of sender seat 0)
    const seat1 = await storage.get<{ text: string; turnReceived: number }>(
      'coachDirective:1',
    );
    expect(seat1).toEqual({
      text: 'redirect to Mars',
      turnReceived: 7,
      acknowledged: false,
    });
    // Sender's seat (0) has no directive — /coach is a whisper, not an echo.
    expect(await storage.get('coachDirective:0')).toBeUndefined();
    // /coach is NOT rebroadcast as normal chat.
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('observation route includes coachDirective when one is stored', async () => {
    const stateRef = { current: buildDuelState() };
    const storage = buildStorageStub();
    await storage.put('coachDirective:1', {
      text: 'flank left',
      turnReceived: 1,
      acknowledged: false,
    });
    const deps = buildDeps({
      storage,
      getCurrentGameState: async () => stateRef.current,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(
        url('/mcp/observation', {
          playerToken: TOKEN_B,
          summary: 'true',
        }),
        { method: 'GET' },
      ),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.coachDirective).toEqual({
      text: 'flank left',
      turnReceived: 1,
      acknowledged: false,
    });
    // Directive also surfaces in the prose summary so text-only agents see it.
    expect(String(body.summary)).toContain('COACH DIRECTIVE');
    expect(String(body.summary)).toContain('flank left');
  });

  it('does not initialize game on non-MCP route', async () => {
    const initGameIfReady = vi.fn();
    const deps = buildDeps({ initGameIfReady });
    const result = await handleMcpRequest(
      deps,
      new Request('https://do.test/something-else', { method: 'GET' }),
    );
    expect(result).toBeNull();
    expect(initGameIfReady).not.toHaveBeenCalled();
  });

  it('host-only room (guest token null) still serves seat 0 lookups', async () => {
    const deps = buildDeps({ getRoomConfig: async () => ROOM_HOST_ONLY });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/state', { playerToken: TOKEN_A }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(200);
  });

  it('observation route attaches lastTurnAutoPlayed when pending for seat', async () => {
    const stateRef = { current: buildDuelState() };
    const consume = vi
      .fn()
      .mockReturnValueOnce({ index: 2, reason: 'timeout' as const })
      .mockReturnValue(null);
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
      consumeLastTurnAutoPlayNotice: consume,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/observation', { playerToken: TOKEN_B }), {
        method: 'GET',
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.lastTurnAutoPlayed).toEqual({ index: 2, reason: 'timeout' });
    expect(consume).toHaveBeenCalledWith(1);
  });

  it('observation route returns full structured observation', async () => {
    const stateRef = { current: buildDuelState() };
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(
        url('/mcp/observation', {
          playerToken: TOKEN_B,
          summary: 'true',
        }),
        { method: 'GET' },
      ),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.candidates).toBeDefined();
    expect(body.recommendedIndex).toBeDefined();
    expect(typeof body.summary).toBe('string');
  });

  it('observation route respects compactState query param', async () => {
    const stateRef = { current: buildDuelState() };
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
    });
    const full = await handleMcpRequest(
      deps,
      new Request(url('/mcp/observation', { playerToken: TOKEN_B }), {
        method: 'GET',
      }),
    );
    const compact = await handleMcpRequest(
      deps,
      new Request(
        url('/mcp/observation', {
          playerToken: TOKEN_B,
          compactState: 'true',
        }),
        { method: 'GET' },
      ),
    );
    expect(full?.status).toBe(200);
    expect(compact?.status).toBe(200);
    const fullBody = (await full?.json()) as { state: Record<string, unknown> };
    const compactBody = (await compact?.json()) as {
      state: Record<string, unknown>;
    };
    expect(Object.keys(fullBody.state).length).toBeGreaterThan(5);
    expect(Object.keys(compactBody.state).sort()).toEqual(
      ['activePlayer', 'phase', 'turnNumber'].sort(),
    );
  });

  it('wait route returns observation immediately when actionable', async () => {
    const stateRef = { current: buildDuelState() };
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/wait', { playerToken: TOKEN_B }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeoutMs: 1_000 }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      actionable: true,
      gameOver: false,
    });
    expect(body.observation).toBeDefined();
  });

  it('action route round-trips an accepted action and returns ActionResult', async () => {
    const stateRef = { current: buildDuelState() };
    const built = buildHandlersAgainst(stateRef);
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
      handlers: built.handlers,
    });
    // Recommended candidate for seat 1 in duel turn 1 is "astrogation".
    const initialPhase = stateRef.current.phase;
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_B }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: 'astrogation',
            orders: stateRef.current.ships
              .filter((ship) => ship.owner === 1)
              .map((ship) => ({ shipId: ship.id, burn: null, overload: null })),
          },
          autoGuards: false,
          waitForResult: true,
          waitTimeoutMs: 500,
        }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.actionType).toBe('astrogation');
    // The buildHandlersAgainst fake captures publishStateChange, which is
    // only called on accepted dispatches. If the engine accepted the action,
    // stateRef.current was reassigned (we just don't pin a specific phase
    // here because turn-advance behavior depends on the opponent submitting).
    void initialPhase;
  });

  it('action route flags autoSkipLikely when control passes away after a phase change', async () => {
    const stateRef = { current: buildDuelState() };
    stateRef.current.phase = 'combat';
    stateRef.current.activePlayer = 0;
    const built = buildHandlersAgainst(stateRef);
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
      handlers: built.handlers,
    });

    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_A }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: { type: 'skipCombat' },
          autoGuards: false,
          waitForResult: true,
          waitTimeoutMs: 500,
        }),
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      accepted: true,
      actionType: 'skipCombat',
      autoSkipLikely: true,
      phaseChanged: true,
      nextActivePlayer: 1,
    });
  });

  it('action route reports rejection when guards do not match', async () => {
    const stateRef = { current: buildDuelState() };
    const built = buildHandlersAgainst(stateRef);
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
      handlers: built.handlers,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_B }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: 'astrogation',
            orders: [],
            // Force a turn mismatch — server reads turn=1 but we claim 999.
            guards: { expectedTurn: 999 },
          },
          autoGuards: false,
          waitForResult: false,
        }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(false);
    expect(body.rejection).toBeDefined();
  });

  it('action route accepts shorthand surrender payloads', async () => {
    const stateRef = { current: buildDuelState() };
    const built = buildHandlersAgainst(stateRef);
    const deps = buildDeps({
      getCurrentGameState: async () => stateRef.current,
      handlers: built.handlers,
    });
    const res = await handleMcpRequest(
      deps,
      new Request(url('/mcp/action', { playerToken: TOKEN_B }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: { type: 'surrender' },
          autoGuards: false,
          waitForResult: false,
        }),
      }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
  });
});
