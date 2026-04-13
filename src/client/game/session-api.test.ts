// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asGameId } from '../../shared/ids';
import { createSessionApi, type SessionApiDeps } from './session-api';
import { stubClientSession } from './session-model';
import { createSessionTokenService } from './session-token-service';

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
  const deps: SessionApiDeps = {
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
    playerProfile: {
      getProfile: vi.fn(() => ({
        playerKey: 'playerkey1',
        username: 'Pilot 1',
      })),
    },
    tokens: {
      getStoredPlayerToken: vi.fn<(code: string) => string | null>(() => null),
      storePlayerToken: vi.fn<(code: string, token: string) => void>(),
      clearStoredPlayerToken: vi.fn<(code: string) => void>(),
    },
    showToast:
      vi.fn<(msg: string, type: 'error' | 'info' | 'success') => void>(),
    setMenuLoading:
      vi.fn<(loading: boolean, kind?: 'create' | 'quickMatch') => void>(),
    setWaitingScreenState: vi.fn<SessionApiDeps['setWaitingScreenState']>(),
    setState: vi.fn<SessionApiDeps['setState']>(),
    setScenario: vi.fn<(scenario: string) => void>(),
    connect: vi.fn<(code: string) => void>(),
    track,
  };

  return {
    deps,
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

  it('tracks create-game timeouts distinctly', async () => {
    const { deps, track } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Timed out', 'AbortError');
      }),
    );

    const api = createSessionApi(deps);

    await api.createGame('duel');

    expect(track).toHaveBeenNthCalledWith(1, 'create_game_attempted', {
      scenario: 'duel',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'create_game_failed', {
      scenario: 'duel',
      reason: 'timeout',
    });
    expect(deps.showToast).toHaveBeenLastCalledWith(
      'Game creation timed out. Try again.',
      'error',
    );
    expect(deps.setState).toHaveBeenCalledWith('menu');
    expect(deps.setMenuLoading).toHaveBeenNthCalledWith(1, true, 'create');
    expect(deps.setMenuLoading).toHaveBeenLastCalledWith(false);
  });

  it('tracks join attempts and HTTP failures with reasons', async () => {
    const { deps, track } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('That game is already full', { status: 409 }),
      ),
    );

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', 'token');

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'That game is already full',
      }),
    );
    expect(track).toHaveBeenNthCalledWith(1, 'join_game_attempted', {
      hasPlayerToken: true,
    });
    expect(track).toHaveBeenNthCalledWith(2, 'join_game_failed', {
      reason: 'That game is already full',
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
    deps.tokens = createSessionTokenService({
      storage,
      now: () => Date.now(),
    });
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

    expect(result).toEqual({ ok: true, value: null });
    expect(track).toHaveBeenNthCalledWith(
      2,
      'join_game_retried_without_token',
      {
        reason: 'invalid_stored_token',
      },
    );
    expect(storage.getItem('delta-v:tokens')).toBe('{}');
  });

  it('returns a timeout error when join validation aborts', async () => {
    const { deps, track } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Timed out', 'AbortError');
      }),
    );

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', null);

    expect(result).toEqual({
      ok: false,
      error: 'Join check timed out. Try again.',
    });
    expect(track).toHaveBeenNthCalledWith(1, 'join_game_attempted', {
      hasPlayerToken: false,
    });
    expect(track).toHaveBeenNthCalledWith(2, 'join_game_failed', {
      reason: 'Join check timed out. Try again.',
      status: undefined,
      hasPlayerToken: false,
    });
  });

  it('tracks replay fetch timeouts as timeout failures', async () => {
    const { deps, track } = createDeps();
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        ABCDE: { playerToken: 'player-token', ts: Date.now() },
      }),
    });
    deps.tokens = createSessionTokenService({
      storage,
      now: () => Date.now(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Timed out', 'AbortError');
      }),
    );

    const api = createSessionApi(deps);
    const replay = await api.fetchReplay('ABCDE', 'GAME1');

    expect(replay).toBeNull();
    expect(track).toHaveBeenCalledWith('replay_fetch_failed', {
      reason: 'timeout',
      gameId: asGameId('GAME1'),
    });
  });

  it('blocks quick match when another tab already holds the queue lock', async () => {
    const { deps, track } = createDeps();
    const fetchMock = vi.fn();
    deps.quickMatchLock = {
      claim: vi.fn(() => ({ ok: false })),
      heartbeat: vi.fn(),
      release: vi.fn(),
    };
    vi.stubGlobal('fetch', fetchMock);

    const api = createSessionApi(deps);

    await api.startQuickMatch();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(track).toHaveBeenNthCalledWith(1, 'quick_match_attempted', {
      scenario: 'duel',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'quick_match_failed', {
      scenario: 'duel',
      reason: 'active_in_other_tab',
    });
    expect(deps.showToast).toHaveBeenCalledWith(
      'Quick Match is already active in another tab. Use a private window to join as a second local player.',
      'error',
    );
    expect(deps.setState).toHaveBeenCalledWith('menu');
    expect(deps.setMenuLoading).toHaveBeenNthCalledWith(1, true, 'quickMatch');
    expect(deps.setMenuLoading).toHaveBeenLastCalledWith(false);
  });
});
