// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionApi } from './session-api';
import { stubClientSession } from './session-model';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
    clear: vi.fn(() => {
      data.clear();
    }),
  };
};

const createDeps = () => {
  const track =
    vi.fn<(event: string, props?: Record<string, unknown>) => void>();

  return {
    deps: {
      ctx: stubClientSession({
        scenario: 'biplanetary',
        isLocalGame: false,
        playerId: -1,
        gameCode: null,
        gameState: null,
        transport: null,
        aiDifficulty: 'normal',
        reconnectAttempts: 0,
        latencyMs: -1,
      }),
      showToast:
        vi.fn<(msg: string, type: 'error' | 'info' | 'success') => void>(),
      setMenuLoading: vi.fn<(loading: boolean) => void>(),
      setState: vi.fn<(state: string) => void>(),
      setScenario: vi.fn<(scenario: string) => void>(),
      connect: vi.fn<(code: string) => void>(),
      track,
    },
    track,
  };
};

describe('session-api telemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tracks create-game attempts and server failures', async () => {
    const { deps, track } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    const api = createSessionApi(deps);

    await api.createGame('duel');

    expect(track).toHaveBeenNthCalledWith(1, 'create_game_attempted', {
      scenario: 'duel',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'create_game_failed', {
      scenario: 'duel',
      reason: 'server',
      status: 500,
    });
  });

  it('tracks join attempts and HTTP failures with reasons', async () => {
    const { deps, track } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Game is full', { status: 409 })),
    );

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', 'token');

    expect(result).toEqual(
      expect.objectContaining({ ok: false, message: 'Game is full' }),
    );
    expect(track).toHaveBeenNthCalledWith(1, 'join_game_attempted', {
      hasPlayerToken: true,
    });
    expect(track).toHaveBeenNthCalledWith(2, 'join_game_failed', {
      reason: 'Game is full',
      status: 409,
      hasPlayerToken: true,
    });
  });

  it('retries join without a stale token and prunes it from storage', async () => {
    const { deps, track } = createDeps();
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        ABCDE: { playerToken: 'stale-token', ts: Date.now() },
      }),
    });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('Invalid player token', { status: 403 }),
        )
        .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 })),
    );

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', 'stale-token');

    expect(result).toEqual({ ok: true, playerToken: null });
    expect(track).toHaveBeenNthCalledWith(
      2,
      'join_game_retried_without_token',
      {
        reason: 'invalid_stored_token',
      },
    );
    expect(storage.getItem('delta-v:tokens')).toBe('{}');
  });
});
