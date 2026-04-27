// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asGameId } from '../../shared/ids';
import { TOAST } from '../messages/toasts';
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
  const fetchImpl = vi.fn<typeof fetch>();
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
    fetchImpl,
    location: new URL('https://delta-v.test/') as unknown as Location,
  };

  return {
    deps,
    fetchImpl,
    track,
  };
};

describe('session-api telemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tracks create-game attempts and server failures', async () => {
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockResolvedValue(new Response('nope', { status: 500 }));

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
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockImplementation(async () => {
      throw new DOMException('Timed out', 'AbortError');
    });

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
      TOAST.session.gameCreateTimeout,
      'error',
    );
    expect(deps.setState).toHaveBeenCalledWith('menu');
    expect(deps.setMenuLoading).toHaveBeenNthCalledWith(1, true, 'create');
    expect(deps.setMenuLoading).toHaveBeenLastCalledWith(false);
  });

  it('tracks join attempts and HTTP failures with reasons', async () => {
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockResolvedValue(
      new Response('That game is already full', { status: 409 }),
    );

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', 'token');

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          message: 'That game is already full',
        }),
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
    const { deps, fetchImpl, track } = createDeps();
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        ABCDE: { playerToken: 'stale-token', ts: Date.now() },
      }),
    });
    deps.tokens = createSessionTokenService({
      storage,
      now: () => Date.now(),
    });
    fetchImpl
      .mockResolvedValueOnce(
        new Response('Invalid player token', { status: 403 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }));

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
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockImplementation(async () => {
      throw new DOMException('Timed out', 'AbortError');
    });

    const api = createSessionApi(deps);
    const result = await api.validateJoin('ABCDE', null);

    expect(result).toEqual({
      ok: false,
      error: { message: 'Join check timed out. Try again.', code: undefined },
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
    const { deps, fetchImpl, track } = createDeps();
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        ABCDE: { playerToken: 'player-token', ts: Date.now() },
      }),
    });
    deps.tokens = createSessionTokenService({
      storage,
      now: () => Date.now(),
    });
    fetchImpl.mockImplementation(async () => {
      throw new DOMException('Timed out', 'AbortError');
    });

    const api = createSessionApi(deps);
    const replay = await api.fetchReplay('ABCDE', 'GAME1');

    expect(replay).toBeNull();
    expect(track).toHaveBeenCalledWith('replay_fetch_failed', {
      reason: 'timeout',
      gameId: asGameId('GAME1'),
    });
  });

  it('fetches an archived replay over the public spectator route without a token', async () => {
    const { deps, fetchImpl, track } = createDeps();
    let lastUrl = '';
    fetchImpl.mockImplementation(async (input) => {
      lastUrl = String(input);
      return {
        ok: true,
        json: async () => ({ gameId: 'ZNMC6-m1', entries: [] }),
      } as Response;
    });

    const api = createSessionApi(deps);
    const replay = await api.fetchArchivedReplay('ZNMC6', 'ZNMC6-m1');

    expect(replay).toEqual({ gameId: 'ZNMC6-m1', entries: [] });
    expect(lastUrl).toContain('/replay/ZNMC6');
    expect(lastUrl).toContain('viewer=spectator');
    expect(lastUrl).toContain('gameId=ZNMC6-m1');
    // Crucially: no playerToken param leaks into the URL.
    expect(lastUrl).not.toContain('playerToken');
    expect(track).toHaveBeenCalledWith('archived_replay_fetch_succeeded', {
      gameId: 'ZNMC6-m1',
    });
  });

  it('returns null and tracks a server failure when archived replay 404s', async () => {
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    const api = createSessionApi(deps);
    const replay = await api.fetchArchivedReplay('MISSG', 'MISSG-m1');

    expect(replay).toBeNull();
    expect(track).toHaveBeenCalledWith('archived_replay_fetch_failed', {
      reason: 'server',
      status: 404,
      gameId: 'MISSG-m1',
    });
  });

  it('blocks quick match when another tab already holds the queue lock', async () => {
    const { deps, fetchImpl, track } = createDeps();
    deps.quickMatchLock = {
      claim: vi.fn(() => ({ ok: false })),
      heartbeat: vi.fn(),
      release: vi.fn(),
    };

    const api = createSessionApi(deps);

    await api.startQuickMatch();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(track).toHaveBeenNthCalledWith(1, 'quick_match_attempted', {
      scenario: 'duel',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'quick_match_failed', {
      scenario: 'duel',
      reason: 'active_in_other_tab',
    });
    expect(deps.showToast).toHaveBeenCalledWith(
      TOAST.session.quickMatchOtherTab,
      'error',
    );
    expect(deps.setState).toHaveBeenCalledWith('menu');
    expect(deps.setMenuLoading).toHaveBeenNthCalledWith(1, true, 'quickMatch');
    expect(deps.setMenuLoading).toHaveBeenLastCalledWith(false);
  });

  it('tracks when the Official Bot offer first becomes visible for a quick-match ticket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { deps, fetchImpl, track } = createDeps();
    fetchImpl.mockResolvedValue(
      Response.json({
        status: 'queued',
        ticket: 'ticket-1',
        scenario: 'duel',
        officialBotOfferAvailable: true,
        officialBotWaitMsRemaining: 0,
      }),
    );

    const api = createSessionApi(deps);

    await api.startQuickMatch();
    api.cancelQuickMatch();

    expect(track).toHaveBeenCalledWith('quick_match_official_bot_offered', {
      scenario: 'duel',
      waitedMs: 0,
    });
    expect(
      track.mock.calls.filter(
        ([event]) => event === 'quick_match_official_bot_offered',
      ),
    ).toHaveLength(1);
  });
});
