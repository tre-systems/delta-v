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
  initGameIfReady: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

// Real GameState used by the action / observation happy-path tests. duel
// starts on turn 1, astrogation phase, with seat 1 active. We use seat 1
// (TOKEN_B) as the actor in those tests so isActionable returns true.
const buildDuelState = (): GameState =>
  createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('mcp-test'),
    findBaseHex,
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
});
