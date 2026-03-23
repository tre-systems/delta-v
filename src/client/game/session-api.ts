import type { ClientState } from './phase';
import {
  buildGameRoute,
  buildJoinCheckUrl,
  getStoredPlayerToken,
  loadTokenStore,
  saveTokenStore,
  setStoredPlayerToken,
} from './session';
import {
  type CreatedGameSessionDeps,
  completeCreatedGameSession,
} from './session-controller';

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
  const getTokenStore = () => loadTokenStore(localStorage);

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

  const createGame = async (scenario: string) => {
    deps.setMenuLoading(true);
    try {
      deps.setScenario(scenario);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10000);
      const res = await fetch('/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
        signal: abort.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        deps.showToast('Game creation timed out. Try again.', 'error');
      } else if (err instanceof TypeError) {
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
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(
        buildJoinCheckUrl(window.location, code, playerToken),
        { signal: abort.signal },
      );
      clearTimeout(timer);

      if (response.ok) return { ok: true };
      const message = (await response.text()) || 'Could not join game';
      return { ok: false, message };
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          ok: false,
          message: 'Join check timed out. Try again.',
        };
      }

      if (err instanceof TypeError) {
        return {
          ok: false,
          message: 'Network error \u2014 check your connection.',
        };
      }
      return { ok: false, message: 'Could not join game' };
    }
  };

  return {
    createGame,
    validateJoin,
    getStoredPlayerToken: getPlayerToken,
    storePlayerToken,
  };
};

export type SessionApi = ReturnType<typeof createSessionApi>;
