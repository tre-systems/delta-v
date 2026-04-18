import {
  QUICK_MATCH_SCENARIO,
  type QuickMatchResponse,
} from '../../shared/matchmaking';
import { ErrorCode, type Result } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import type { WaitingScreenState } from '../ui/screens';
import type { ClientState } from './phase';
import type { PlayerProfileService } from './player-profile-service';
import {
  createQuickMatchLock,
  type QuickMatchLock,
  type QuickMatchLockStorageLike,
} from './quick-match-lock';
import {
  type CreatedGameSessionDeps,
  completeCreatedGameSession,
} from './session-controller';
import { buildGameRoute, buildJoinCheckUrl } from './session-links';
import type { SessionTokenService } from './session-token-service';

const SESSION_REQUEST_TIMEOUT_MS = 10_000;
const QUICK_MATCH_POLL_INTERVAL_MS = 2_000;

const JOIN_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.ROOM_NOT_FOUND]: 'No game found with that code',
  [ErrorCode.ROOM_FULL]: 'That game is already full',
  [ErrorCode.GAME_IN_PROGRESS]: 'That game has already started',
};

const parseJoinErrorResponse = async (
  response: Response,
): Promise<{ message: string; code: ErrorCode | undefined }> => {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    const code = parsed.code as ErrorCode | undefined;
    const friendly = code && JOIN_ERROR_MESSAGES[code];
    return {
      message: friendly ?? parsed.message ?? 'Could not join game',
      code,
    };
  } catch {
    return { message: raw || 'Could not join game', code: undefined };
  }
};

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
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  externalSignal?: AbortSignal,
): Promise<Response> => {
  const timeoutAbort = new AbortController();
  const timer = setTimeout(
    () => timeoutAbort.abort(),
    SESSION_REQUEST_TIMEOUT_MS,
  );

  const onExternalAbort = (): void => {
    timeoutAbort.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetchImpl(input, {
      ...(init ?? {}),
      signal: timeoutAbort.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
};

export interface ValidateJoinError {
  message: string;
  code?: ErrorCode;
}

export interface SessionApiDeps {
  ctx: CreatedGameSessionDeps['ctx'];
  playerProfile: Pick<PlayerProfileService, 'getProfile'>;
  quickMatchLock?: Pick<QuickMatchLock, 'claim' | 'heartbeat' | 'release'>;
  tokens: Pick<
    SessionTokenService,
    'clearStoredPlayerToken' | 'getStoredPlayerToken' | 'storePlayerToken'
  >;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  setMenuLoading: (loading: boolean, kind?: 'create' | 'quickMatch') => void;
  setWaitingScreenState: (state: WaitingScreenState | null) => void;
  setState: (state: ClientState) => void;
  setScenario: (scenario: string) => void;
  connect: (code: string) => void;
  track: (event: string, props?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
  location?: Location;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const webStorage = (
  key: 'localStorage' | 'sessionStorage',
): QuickMatchLockStorageLike | null => {
  try {
    const g = globalThis as typeof globalThis & {
      localStorage?: unknown;
      sessionStorage?: unknown;
      window?: {
        localStorage?: unknown;
        sessionStorage?: unknown;
      };
    };
    const candidates = [g[key], g.window?.[key]];

    for (const storage of candidates) {
      if (
        storage !== null &&
        storage !== undefined &&
        typeof storage === 'object' &&
        typeof (storage as QuickMatchLockStorageLike).getItem === 'function' &&
        typeof (storage as QuickMatchLockStorageLike).setItem === 'function' &&
        typeof (storage as QuickMatchLockStorageLike).removeItem === 'function'
      ) {
        return storage as QuickMatchLockStorageLike;
      }
    }
  } catch {
    /* private mode / no storage */
  }

  return null;
};

export const createSessionApi = (deps: SessionApiDeps) => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const location = deps.location ?? window.location;
  let quickMatchTicket: string | null = null;
  let quickMatchPlayerKey: string | null = null;
  let quickMatchQueuedAtMs: number | null = null;
  const quickMatchLock =
    deps.quickMatchLock ??
    (() => {
      const localStorage = webStorage('localStorage');
      const sessionStorage = webStorage('sessionStorage');

      if (!localStorage || !sessionStorage) {
        return null;
      }

      return createQuickMatchLock({
        localStorage,
        sessionStorage,
      });
    })();

  const releaseQuickMatch = (): void => {
    quickMatchTicket = null;
    quickMatchPlayerKey = null;
    quickMatchQueuedAtMs = null;
    quickMatchLock?.release();
  };

  const connectQuickMatch = (
    match: Extract<QuickMatchResponse, { status: 'matched' }>,
  ): void => {
    releaseQuickMatch();
    deps.setScenario(match.scenario);
    deps.setWaitingScreenState({
      kind: 'quickMatch',
      statusText: 'Match found. Connecting...',
    });
    deps.tokens.storePlayerToken(match.code, match.playerToken);
    history.replaceState(null, '', buildGameRoute(match.code));
    deps.track('quick_match_found', {
      scenario: match.scenario,
    });
    deps.setState('connecting');
    deps.connect(match.code);
  };

  const pollQuickMatch = async (ticket: string): Promise<void> => {
    while (quickMatchTicket === ticket) {
      await delay(QUICK_MATCH_POLL_INTERVAL_MS);

      if (
        quickMatchTicket !== ticket ||
        deps.ctx.state !== 'waitingForOpponent'
      ) {
        if (quickMatchTicket === ticket) {
          releaseQuickMatch();
        }
        return;
      }

      try {
        if (quickMatchPlayerKey) {
          quickMatchLock?.heartbeat(quickMatchPlayerKey, ticket);
        }
        const response = await fetchWithTimeout(
          fetchImpl,
          `/quick-match/${ticket}`,
          {
            method: 'GET',
          },
        );
        const payload = (await response.json()) as QuickMatchResponse;

        if (payload.status === 'matched') {
          connectQuickMatch(payload);
          return;
        }

        if (payload.status === 'expired') {
          releaseQuickMatch();
          deps.track('quick_match_expired', {
            scenario: payload.scenario,
            reason: payload.reason,
          });
          deps.showToast(TOAST.session.quickMatchExpired, 'error');
          deps.setState('menu');
          return;
        }

        deps.setWaitingScreenState({
          kind: 'quickMatch',
          statusText: 'Searching for an opponent...',
          queuedAtMs: quickMatchQueuedAtMs ?? undefined,
        });
      } catch (err) {
        releaseQuickMatch();
        const failureKind = classifySessionRequestFailure(err);
        deps.track('quick_match_failed', {
          scenario: QUICK_MATCH_SCENARIO,
          reason: failureKind,
        });
        deps.showToast(TOAST.session.quickMatchLostConnection, 'error');
        deps.setState('menu');
        return;
      }
    }
  };

  const createGame = async (scenario: string) => {
    releaseQuickMatch();
    deps.track('create_game_attempted', { scenario });
    deps.setMenuLoading(true, 'create');
    try {
      deps.setScenario(scenario);
      const res = await fetchWithTimeout(fetchImpl, '/create', {
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
        deps.showToast(TOAST.connection.serverErrorRetryShortly, 'error');
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
          storePlayerToken: deps.tokens.storePlayerToken,
          replaceRoute: (route) => history.replaceState(null, '', route),
          buildGameRoute,
          connect: (code) => deps.connect(code),
          setWaitingScreenState: (state) => deps.setWaitingScreenState(state),
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
        deps.showToast(TOAST.session.gameCreateTimeout, 'error');
      } else if (failureKind === 'network') {
        deps.showToast(TOAST.session.gameCreateNetwork, 'error');
      } else {
        deps.showToast(TOAST.session.gameCreateFailed, 'error');
      }
      console.error('Failed to create game:', err);
      deps.setState('menu');
    } finally {
      deps.setMenuLoading(false);
    }
  };

  const startQuickMatch = async (): Promise<void> => {
    releaseQuickMatch();
    deps.track('quick_match_attempted', {
      scenario: QUICK_MATCH_SCENARIO,
    });
    deps.setMenuLoading(true, 'quickMatch');

    try {
      const player = deps.playerProfile.getProfile();
      const lockClaim = quickMatchLock?.claim(player.playerKey);

      if (lockClaim && !lockClaim.ok) {
        deps.track('quick_match_failed', {
          scenario: QUICK_MATCH_SCENARIO,
          reason: 'active_in_other_tab',
        });
        deps.showToast(TOAST.session.quickMatchOtherTab, 'error');
        deps.setState('menu');
        return;
      }

      quickMatchPlayerKey = player.playerKey;
      deps.setScenario(QUICK_MATCH_SCENARIO);
      const response = await fetchWithTimeout(fetchImpl, '/quick-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: QUICK_MATCH_SCENARIO,
          player,
        }),
      });

      if (!response.ok) {
        releaseQuickMatch();
        deps.track('quick_match_failed', {
          scenario: QUICK_MATCH_SCENARIO,
          reason: 'server',
          status: response.status,
        });
        deps.showToast(TOAST.session.quickMatchUnavailable, 'error');
        deps.setState('menu');
        return;
      }

      const payload = (await response.json()) as QuickMatchResponse;

      if (payload.status === 'matched') {
        connectQuickMatch(payload);
        return;
      }

      if (payload.status === 'expired') {
        releaseQuickMatch();
        deps.track('quick_match_failed', {
          scenario: payload.scenario,
          reason: payload.reason,
        });
        deps.showToast(TOAST.session.quickMatchExpired, 'error');
        deps.setState('menu');
        return;
      }

      quickMatchTicket = payload.ticket;
      quickMatchLock?.heartbeat(player.playerKey, payload.ticket);
      quickMatchQueuedAtMs = Date.now();
      deps.setWaitingScreenState({
        kind: 'quickMatch',
        statusText: 'Searching for an opponent...',
        queuedAtMs: quickMatchQueuedAtMs,
      });
      deps.track('quick_match_queued', {
        scenario: payload.scenario,
      });
      deps.setState('waitingForOpponent');
      void pollQuickMatch(payload.ticket);
    } catch (err) {
      releaseQuickMatch();
      const failureKind = classifySessionRequestFailure(err);
      deps.track('quick_match_failed', {
        scenario: QUICK_MATCH_SCENARIO,
        reason: failureKind,
      });
      deps.showToast(TOAST.session.quickMatchEnterFailed, 'error');
      deps.setState('menu');
    } finally {
      deps.setMenuLoading(false);
    }
  };

  const validateJoin = async (
    code: string,
    playerToken: string | null,
  ): Promise<Result<string | null, ValidateJoinError>> => {
    const attemptJoin = async (
      token: string | null,
    ): Promise<
      | { ok: true; playerToken: string | null }
      | {
          ok: false;
          message: string;
          status?: number;
          code?: ErrorCode;
        }
    > => {
      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          buildJoinCheckUrl(location, code, token),
        );

        if (response.ok) {
          return { ok: true, playerToken: token };
        }

        const { message, code: errorCode } =
          await parseJoinErrorResponse(response);
        return { ok: false, message, status: response.status, code: errorCode };
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

    if (playerToken && initialAttempt.status === 403) {
      deps.tokens.clearStoredPlayerToken(code);
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
      return {
        ok: false,
        error: { message: retryAttempt.message, code: retryAttempt.code },
      };
    }

    deps.track('join_game_failed', {
      reason: initialAttempt.message,
      status: initialAttempt.status,
      hasPlayerToken: playerToken !== null,
    });
    return {
      ok: false,
      error: { message: initialAttempt.message, code: initialAttempt.code },
    };
  };

  const fetchReplay = async (
    code: string,
    gameId: string,
  ): Promise<import('../../shared/replay').ReplayTimeline | null> => {
    const playerToken = deps.tokens.getStoredPlayerToken(code);

    if (!playerToken) {
      deps.track('replay_fetch_failed', {
        reason: 'missing_token',
        gameId,
      });
      return null;
    }

    try {
      const url = new URL(`/replay/${code}`, location.origin);
      url.searchParams.set('playerToken', playerToken);
      url.searchParams.set('gameId', gameId);
      const response = await fetchWithTimeout(fetchImpl, url.toString());

      if (!response.ok) {
        if (response.status === 403) {
          deps.tokens.clearStoredPlayerToken(code);
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

  // Fetches an archived match for public spectator viewing. Unlike
  // fetchReplay, no playerToken is required — the /replay route accepts
  // `viewer=spectator` for any caller. Used by the /matches history page's
  // "Replay" link, which boots the client into archived-replay mode for a
  // game the caller did not play.
  const fetchArchivedReplay = async (
    code: string,
    gameId: string,
    signal?: AbortSignal,
  ): Promise<import('../../shared/replay').ReplayTimeline | null> => {
    try {
      const url = new URL(`/replay/${code}`, location.origin);
      url.searchParams.set('viewer', 'spectator');
      url.searchParams.set('gameId', gameId);
      const response = await fetchWithTimeout(
        fetchImpl,
        url.toString(),
        undefined,
        signal,
      );

      if (!response.ok) {
        deps.track('archived_replay_fetch_failed', {
          reason: 'server',
          status: response.status,
          gameId,
        });
        return null;
      }

      deps.track('archived_replay_fetch_succeeded', { gameId });
      return (await response.json()) as import('../../shared/replay').ReplayTimeline;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      const failureKind = classifySessionRequestFailure(err);
      deps.track('archived_replay_fetch_failed', {
        reason: failureKind === 'timeout' ? 'timeout' : 'network',
        gameId,
      });
      return null;
    }
  };

  // Cancel an in-flight quick-match search. Drops the ticket, releases
  // the cross-tab lock, and leaves telemetry breadcrumbs. The active
  // poller exits on its next tick because quickMatchTicket no longer
  // matches — safe to call from anywhere, including when no search is
  // active (it becomes a no-op).
  const cancelQuickMatch = (): void => {
    if (quickMatchTicket === null) return;
    const scenario = QUICK_MATCH_SCENARIO;
    releaseQuickMatch();
    deps.track('quick_match_cancelled', { scenario });
    deps.setState('menu');
  };

  return {
    createGame,
    startQuickMatch,
    cancelQuickMatch,
    validateJoin,
    fetchReplay,
    fetchArchivedReplay,
  };
};

export type SessionApi = ReturnType<typeof createSessionApi>;
