import type { Result } from '../../shared/types/domain';
import type { ClientState } from './phase';
import {
  type CreatedGameSessionDeps,
  completeCreatedGameSession,
} from './session-controller';
import { buildGameRoute, buildJoinCheckUrl } from './session-links';
import {
  deleteStoredPlayerToken,
  getStoredPlayerToken,
  loadTokenStore,
  pruneExpiredTokens,
  saveTokenStore,
  setStoredPlayerToken,
} from './session-token-store';

const SESSION_REQUEST_TIMEOUT_MS = 10_000;

type SessionRequestFailureKind = 'timeout' | 'network' | 'unknown';

const classifySessionRequestFailure = (
  error: unknown,
): SessionRequestFailureKind => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }

  if (error instanceof TypeError) {
    return 'network';
  }

  return 'unknown';
};

const fetchWithTimeout = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SESSION_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...(init ?? {}),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

export interface SessionApiDeps {
  ctx: CreatedGameSessionDeps['ctx'];
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  setMenuLoading: (loading: boolean) => void;
  setState: (state: ClientState) => void;
  setScenario: (scenario: string) => void;
  connect: (code: string) => void;
  track: (event: string, props?: Record<string, unknown>) => void;
}

export const createSessionApi = (deps: SessionApiDeps) => {
  const getTokenStore = () => {
    const store = loadTokenStore(localStorage);
    const prunedStore = pruneExpiredTokens(store, Date.now());

    if (Object.keys(prunedStore).length !== Object.keys(store).length) {
      saveTokenStore(localStorage, prunedStore, Date.now());
    }

    return prunedStore;
  };

  const doSaveTokenStore = (
    store: Record<string, { playerToken?: string; ts: number }>,
  ) => {
    saveTokenStore(localStorage, store, Date.now());
  };

  const storePlayerToken = (code: string, token: string) => {
    const store = setStoredPlayerToken(
      getTokenStore(),
      code,
      token,
      Date.now(),
    );
    doSaveTokenStore(store);
  };

  const getPlayerToken = (code: string): string | null =>
    getStoredPlayerToken(getTokenStore(), code);

  const clearPlayerToken = (code: string) => {
    doSaveTokenStore(deleteStoredPlayerToken(getTokenStore(), code));
  };

  const createGame = async (scenario: string) => {
    deps.track('create_game_attempted', { scenario });
    deps.setMenuLoading(true);
    try {
      deps.setScenario(scenario);
      const res = await fetchWithTimeout('/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });

      if (!res.ok) {
        deps.track('create_game_failed', {
          scenario,
          reason: 'server',
          status: res.status,
        });
        deps.showToast('Server error \u2014 try again in a moment.', 'error');
        deps.setState('menu');
        return;
      }
      const data = (await res.json()) as {
        code: string;
        playerToken: string;
      };
      completeCreatedGameSession(
        {
          ctx: deps.ctx,
          storePlayerToken,
          replaceRoute: (route) => history.replaceState(null, '', route),
          buildGameRoute,
          connect: (code) => deps.connect(code),
          setState: (state) => deps.setState(state),
          trackGameCreated: (details) => deps.track('game_created', details),
        },
        scenario,
        data.code,
        data.playerToken,
      );
    } catch (err) {
      const failureKind = classifySessionRequestFailure(err);
      deps.track('create_game_failed', {
        scenario,
        reason: failureKind,
      });

      if (failureKind === 'timeout') {
        deps.showToast('Game creation timed out. Try again.', 'error');
      } else if (failureKind === 'network') {
        deps.showToast('Network error \u2014 check your connection.', 'error');
      } else {
        deps.showToast('Failed to create game. Try again.', 'error');
      }
      console.error('Failed to create game:', err);
      deps.setState('menu');
    } finally {
      deps.setMenuLoading(false);
    }
  };

  const validateJoin = async (
    code: string,
    playerToken: string | null,
  ): Promise<Result<string | null>> => {
    const attemptJoin = async (
      token: string | null,
    ): Promise<
      | { ok: true; playerToken: string | null }
      | { ok: false; message: string; status?: number }
    > => {
      try {
        const response = await fetchWithTimeout(
          buildJoinCheckUrl(window.location, code, token),
        );

        if (response.ok) {
          return { ok: true, playerToken: token };
        }

        const message = (await response.text()) || 'Could not join game';
        return { ok: false, message, status: response.status };
      } catch (err) {
        const failureKind = classifySessionRequestFailure(err);

        if (failureKind === 'timeout') {
          return {
            ok: false,
            message: 'Join check timed out. Try again.',
          };
        }

        if (failureKind === 'network') {
          return {
            ok: false,
            message: 'Network error \u2014 check your connection.',
          };
        }

        return { ok: false, message: 'Could not join game' };
      }
    };

    deps.track('join_game_attempted', {
      hasPlayerToken: playerToken !== null,
    });

    const initialAttempt = await attemptJoin(playerToken);

    if (initialAttempt.ok) {
      return { ok: true, value: initialAttempt.playerToken };
    }

    if (
      playerToken &&
      initialAttempt.status === 403 &&
      initialAttempt.message === 'Invalid player token'
    ) {
      clearPlayerToken(code);
      const retryAttempt = await attemptJoin(null);

      if (retryAttempt.ok) {
        deps.track('join_game_retried_without_token', {
          reason: 'invalid_stored_token',
        });
        return { ok: true, value: retryAttempt.playerToken };
      }

      deps.track('join_game_failed', {
        reason: retryAttempt.message,
        status: 'status' in retryAttempt ? retryAttempt.status : undefined,
        hasPlayerToken: false,
      });
      return { ok: false, error: retryAttempt.message };
    }

    deps.track('join_game_failed', {
      reason: initialAttempt.message,
      status: initialAttempt.status,
      hasPlayerToken: playerToken !== null,
    });
    return { ok: false, error: initialAttempt.message };
  };

  const fetchReplay = async (
    code: string,
    gameId: string,
  ): Promise<import('../../shared/replay').ReplayTimeline | null> => {
    const playerToken = getPlayerToken(code);

    if (!playerToken) {
      deps.track('replay_fetch_failed', {
        reason: 'missing_token',
        gameId,
      });
      return null;
    }

    try {
      const url = new URL(`/replay/${code}`, window.location.origin);
      url.searchParams.set('playerToken', playerToken);
      url.searchParams.set('gameId', gameId);
      const response = await fetchWithTimeout(url.toString());

      if (!response.ok) {
        if (response.status === 403) {
          clearPlayerToken(code);
        }
        deps.track('replay_fetch_failed', {
          reason: 'server',
          status: response.status,
          gameId,
        });
        return null;
      }

      deps.track('replay_fetch_succeeded', {
        gameId,
      });
      return (await response.json()) as import('../../shared/replay').ReplayTimeline;
    } catch (err) {
      const failureKind = classifySessionRequestFailure(err);
      deps.track('replay_fetch_failed', {
        reason: failureKind === 'timeout' ? 'timeout' : 'network',
        gameId,
      });
      return null;
    }
  };

  return {
    createGame,
    validateJoin,
    fetchReplay,
    getStoredPlayerToken: getPlayerToken,
    storePlayerToken,
  };
};

export type SessionApi = ReturnType<typeof createSessionApi>;
