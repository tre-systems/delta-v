import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId, cls, hide, listen, setTrustedHTML, show, text } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import {
  type ClaimNameResult,
  fetchPlayerRank,
  postClaimName,
} from '../leaderboard/api';
import { TOAST, toastJoinInvalidCode } from '../messages/toasts';
import {
  createDisposalScope,
  effect,
  registerDisposer,
  signal,
  withScope,
} from '../reactive';
import { getWebLocalStorage } from '../web-local-storage';
import type { AIDifficulty, UIEvent } from './events';
import { parseJoinInput } from './formatters';
import {
  buildWaitingScreenCopy,
  type WaitingScreenCopy,
  type WaitingScreenState,
} from './screens';

export interface LobbyViewDeps {
  emit: (event: UIEvent) => void;
  showMenu: () => void;
  showScenarioSelect: () => void;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  /** Same HUD help toggle as in-game (single listener on `#helpCloseBtn` / `?`). */
  toggleHelpOverlay: () => void;
  getPlayerName: () => string;
  setPlayerName: (name: string) => string;
  getPlayerKey: () => string;
  resetPlayerIdentity: () => { username: string };
  copyText?: (text: string) => Promise<void> | undefined;
  // Optional network boundary — tests pass a stub so the lobby doesn't
  // hit the real /api/claim-name route.
  postClaimName?: typeof postClaimName;
  fetchPlayerRank?: typeof fetchPlayerRank;
  /**
   * Reactive online/offline state. When `false`, network-dependent CTAs
   * (Quick Match, Create Private, Join, Leaderboard, Recent Matches,
   * Build a Bot) are disabled and an offline banner is shown. When the
   * signal flips back to `true`, the CTAs re-enable without a refresh.
   * Omit (tests) to treat the lobby as always online.
   */
  onlineSignal?: { readonly value: boolean };
}

export interface LobbyView {
  onMenuShown: () => void;
  setMenuLoading: (loading: boolean, kind?: 'create' | 'quickMatch') => void;
  setWaitingState: (state: WaitingScreenState | null) => void;
  selectCodeInput: () => void;
  dispose: () => void;
}

export const createLobbyView = (deps: LobbyViewDeps): LobbyView => {
  const scope = createDisposalScope();
  const ls = getWebLocalStorage();
  const storedDifficulty =
    (ls?.getItem('aiDifficulty') as AIDifficulty | null) ?? 'normal';
  const aiDifficultySignal = signal<AIDifficulty>(storedDifficulty);
  const pendingAIGameSignal = signal(false);
  const loadingSignal = signal<'create' | 'quickMatch' | null>(null);
  // Start with a blank waiting card — the "Game Created" / "Waiting for
  // opponent..." copy only appears after setWaitingState explicitly
  // activates a private-room or quick-match flow. Keeps the
  // accessibility tree free of pregame text during initial menu boot.
  const waitingCopySignal = signal<WaitingScreenCopy>({
    titleText: '',
    codeText: '',
    codeVariant: 'roomCode',
    statusText: '',
    scenarioText: null,
    showCopyActions: false,
    cancelActionLabel: null,
    quickMatchQueuedAtMs: null,
  });
  const copyButtonTextSignal = signal('Copy Link');
  const copySpectateTextSignal = signal('Copy Observer Link (view-only)');
  const queueElapsedTick = signal(0);
  const defaultFetch = globalThis.fetch.bind(globalThis);
  const postClaimImpl = deps.postClaimName ?? postClaimName;
  const postClaim: (opts: {
    playerKey: string;
    username: string;
  }) => Promise<ClaimNameResult> = (opts) =>
    postClaimImpl({ ...opts, fetchImpl: defaultFetch });

  const createBtn = byId<HTMLButtonElement>('createBtn');
  const quickMatchBtn = byId<HTMLButtonElement>('quickMatchBtn');
  const singlePlayerBtn = byId('singlePlayerBtn');
  const playerNameInput = byId<HTMLInputElement>('playerNameInput');
  const forgetCallsignBtn = byId<HTMLButtonElement>('forgetCallsignBtn');
  const backBtn = byId('backBtn');
  const scenarioListEl = byId('scenarioList');
  const difficultyButtons = Array.from(
    document.querySelectorAll<HTMLElement>('.btn-difficulty'),
  );
  const joinBtn = byId<HTMLButtonElement>('joinBtn');
  const codeInputEl = byId<HTMLInputElement>('codeInput');
  const menuHowToPlayBtn = byId('menuHowToPlayBtn');
  const copyBtn = byId('copyBtn');
  const copySpectateBtn = byId('copySpectateBtn');
  const cancelWaitingBtn = byId<HTMLButtonElement>('cancelWaitingBtn');
  const waitingTitleEl = byId('waitingTitle');
  const gameCodeEl = byId('gameCode');
  const waitingStatusEl = byId('waitingStatus');
  const waitingScenarioEl = byId('waitingScenario');
  const waitingShareHintEl = document.getElementById(
    'waitingShareHint',
  ) as HTMLElement | null;
  const difficultyHintEl = document.getElementById(
    'difficultyHint',
  ) as HTMLElement | null;

  let copyResetTimer: number | null = null;
  const spectatorModeEnabled = isClientFeatureEnabled('spectatorMode');

  const clearCopyResetTimer = () => {
    if (copyResetTimer === null) {
      return;
    }

    window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
  };

  const isJoinInputValid = (rawValue: string): boolean => {
    return parseJoinInput(rawValue, CODE_LENGTH) !== null;
  };

  const updateJoinButtonState = (): void => {
    const valid = isJoinInputValid(codeInputEl.value);
    (joinBtn as HTMLButtonElement).disabled = !valid;
    if (valid) {
      joinBtn.removeAttribute('title');
    } else {
      joinBtn.title = 'Enter a game code to join';
    }
  };

  const submitJoin = (rawValue: string): void => {
    const parsed = parseJoinInput(rawValue, CODE_LENGTH);

    if (!parsed) {
      const trimmed = rawValue.trim();
      if (trimmed.length === 0) {
        deps.showToast(TOAST.lobby.joinNeedCode, 'error');
      } else {
        deps.showToast(toastJoinInvalidCode(CODE_LENGTH), 'error');
      }
      return;
    }

    deps.emit({
      type: 'join',
      code: parsed.code,
      playerToken: parsed.playerToken,
    });
  };

  const bindScenarioList = () => {
    for (const [key, def] of Object.entries(SCENARIOS)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-scenario';
      btn.dataset.scenario = key;

      const tags = (def.tags ?? [])
        .map((tag) => `<span class="scenario-tag">${tag}</span>`)
        .join('');

      const lobbyMeta = def.lobbyMeta;
      const metaBits: string[] = [];
      if (lobbyMeta?.beginnerFriendly) {
        metaBits.push('Beginner-friendly');
      }
      if (lobbyMeta?.length) {
        metaBits.push(
          lobbyMeta.length === 'short'
            ? 'Short match'
            : lobbyMeta.length === 'medium'
              ? 'Medium length'
              : 'Long match',
        );
      }
      if (lobbyMeta?.complexity) {
        metaBits.push(
          lobbyMeta.complexity === 'low'
            ? 'Low complexity'
            : lobbyMeta.complexity === 'high'
              ? 'High complexity'
              : 'Moderate complexity',
        );
      }
      if (lobbyMeta?.mechanics?.length) {
        metaBits.push(lobbyMeta.mechanics.join(', '));
      }
      const metaHtml =
        metaBits.length > 0
          ? `<div class="scenario-meta">${metaBits.join(' · ')}</div>`
          : '';

      setTrustedHTML(
        btn,
        `<div class="scenario-name">${def.name}${tags}</div>` +
          `<div class="scenario-desc">${def.description}</div>${metaHtml}`,
      );

      scenarioListEl.appendChild(btn);
    }
  };

  const onMenuShown = (): void => {
    pendingAIGameSignal.value = false;
  };

  // True when the current URL will boot the client into a non-menu view
  // (spectator, live join, archived replay). In that case the menu is
  // never shown on initial load, so the best-effort rank lookup below
  // is a wasted request that surfaces as a /leaderboard/me 404 in the
  // Network tab for anonymous viewers.
  const isInitialMenuBoot = (): boolean => {
    try {
      const params = new URLSearchParams(window.location.search);
      return !params.has('code') && !params.has('archivedReplay');
    } catch {
      return true;
    }
  };

  const setMenuLoading = (
    loading: boolean,
    kind: 'create' | 'quickMatch' = 'create',
  ): void => {
    loadingSignal.value = loading ? kind : null;
  };

  // When the waiting screen clears (match starts, game ends, exit to
  // menu), drop every label to empty strings so stale pregame copy
  // ("Game Created", "Waiting for opponent...") never leaks into the
  // accessibility tree while the HUD is active.
  const blankWaitingCopy = (): WaitingScreenCopy => ({
    titleText: '',
    codeText: '',
    codeVariant: 'roomCode',
    statusText: '',
    scenarioText: null,
    showCopyActions: false,
    cancelActionLabel: null,
    quickMatchQueuedAtMs: null,
  });

  const setWaitingState = (state: WaitingScreenState | null): void => {
    waitingCopySignal.value = state
      ? buildWaitingScreenCopy(state)
      : blankWaitingCopy();
  };

  const dispose = (): void => {
    clearCopyResetTimer();
    scope.dispose();
  };

  bindScenarioList();
  playerNameInput.value = deps.getPlayerName();

  withScope(scope, () => {
    listen(scenarioListEl, 'click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        '.btn-scenario',
      );
      const scenario = button?.dataset.scenario;

      if (!scenario) {
        return;
      }

      if (pendingAIGameSignal.peek()) {
        pendingAIGameSignal.value = false;
        deps.emit({
          type: 'startSinglePlayer',
          scenario,
          difficulty: aiDifficultySignal.peek(),
        });
        return;
      }

      deps.emit({
        type: 'selectScenario',
        scenario,
      });
    });

    listen(menuHowToPlayBtn, 'click', () => {
      deps.toggleHelpOverlay();
    });

    listen(forgetCallsignBtn, 'click', () => {
      const profile = deps.resetPlayerIdentity();
      playerNameInput.value = profile.username;
      setCallsignStatus('Local callsign cleared on this device.', 'info');
    });

    listen(createBtn, 'click', () => {
      deps.showScenarioSelect();
    });

    listen(quickMatchBtn, 'click', () => {
      // Ensure quick-match players are claimed for leaderboard/match history
      // even if they never blur the callsign input first. Wait for the claim
      // before queueing so status and toasts reflect the response.
      const normalised = deps.setPlayerName(playerNameInput.value);
      playerNameInput.value = normalised;
      void (async () => {
        const result = await requestClaim(postClaim);
        applyClaimResult(result);
        if (shouldProceedToQuickMatchAfterClaim(result)) {
          deps.emit({ type: 'quickMatch' });
        }
      })();
    });

    listen(singlePlayerBtn, 'click', () => {
      pendingAIGameSignal.value = true;
      deps.showScenarioSelect();
    });

    listen(backBtn, 'click', () => {
      deps.emit({ type: 'backToMenu' });
      deps.showMenu();
    });

    for (const btn of difficultyButtons) {
      listen(btn, 'click', (event) => {
        event.stopPropagation();
        const diff = btn.dataset.difficulty as AIDifficulty;
        aiDifficultySignal.value = diff;
        ls?.setItem('aiDifficulty', diff);
      });
    }

    listen(joinBtn, 'click', () => {
      submitJoin(codeInputEl.value);
    });

    listen(codeInputEl, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        submitJoin((event.target as HTMLInputElement).value);
      }
    });

    listen(codeInputEl, 'input', () => {
      updateJoinButtonState();
    });

    const callsignStatusEl = document.getElementById('callsignStatus');
    const setCallsignStatus = (
      text: string,
      tone: 'info' | 'success' | 'error',
    ) => {
      if (!callsignStatusEl) return;
      callsignStatusEl.textContent = text;
      callsignStatusEl.className = `menu-profile-status status-${tone}`;
    };

    const fetchRankImpl = deps.fetchPlayerRank ?? fetchPlayerRank;
    const fetchRank: (opts: {
      playerKey: string;
    }) => ReturnType<typeof fetchPlayerRank> = (opts) =>
      fetchRankImpl({ ...opts, fetchImpl: defaultFetch });

    const formatRankText = (r: {
      rating: number;
      provisional: boolean;
      rank: number | null;
    }): string => {
      if (r.provisional) return `Rating ${r.rating} · provisional`;
      return r.rank === null
        ? `Rating ${r.rating}`
        : `Rating ${r.rating} · rank #${r.rank}`;
    };

    const refreshRank = () => {
      const playerKey = deps.getPlayerKey();
      void fetchRank({ playerKey }).then((result) => {
        if (!result.ok) return;
        setCallsignStatus(formatRankText(result.player), 'info');
      });
    };

    const requestClaim = async (
      postClaim: (opts: {
        playerKey: string;
        username: string;
      }) => Promise<ClaimNameResult>,
    ): Promise<ClaimNameResult> => {
      const username = deps.getPlayerName();
      const playerKey = deps.getPlayerKey();
      setCallsignStatus('Claiming…', 'info');
      return postClaim({ playerKey, username });
    };

    const applyClaimResult = (result: ClaimNameResult): void => {
      if (result.ok) {
        setCallsignStatus(`Claimed as ${result.player.username}`, 'success');
        // Follow up with the player's rank once the claim lands so
        // the status switches from "Claimed as X" to
        // "Rating N · rank #K" (or · provisional).
        refreshRank();
        return;
      }
      if (result.error === 'name_taken') {
        setCallsignStatus('Callsign is taken — try another.', 'error');
        return;
      }
      if (result.error === 'invalid_name') {
        setCallsignStatus(
          'Invalid callsign — use letters, numbers, spaces, _ or -.',
          'error',
        );
        return;
      }
      if (result.error === 'rate_limited') {
        setCallsignStatus('Too many changes — try again in a minute.', 'error');
        return;
      }
      if (
        result.error === 'network' ||
        result.error === 'unavailable' ||
        result.error === 'unknown'
      ) {
        setCallsignStatus('', 'info');
        deps.showToast(TOAST.lobby.claimCouldNotSaveOnline, 'info');
        return;
      }
    };

    const runClaim = (
      postClaim: (opts: {
        playerKey: string;
        username: string;
      }) => Promise<ClaimNameResult>,
    ): void => {
      void requestClaim(postClaim).then(applyClaimResult);
    };

    const shouldProceedToQuickMatchAfterClaim = (
      result: ClaimNameResult,
    ): boolean =>
      result.ok ||
      result.error === 'network' ||
      result.error === 'unavailable' ||
      result.error === 'unknown';

    // Returning visitors see their "Rating · rank" hint without having
    // to re-claim first. Skipped on URL boots that go straight into a
    // game view (spectator/join/archived replay) so the /leaderboard/me
    // 404 for anonymous viewers stops polluting the Network tab in a
    // clean session. Failure is silent either way.
    if (isInitialMenuBoot()) {
      refreshRank();
    }

    const commitPlayerName = () => {
      const prior = deps.getPlayerName();
      const normalised = deps.setPlayerName(playerNameInput.value);
      playerNameInput.value = normalised;
      // Only POST when the value actually changed or the status is
      // empty (first interaction).
      if (normalised === prior && callsignStatusEl?.textContent) {
        return;
      }
      runClaim(postClaim);
    };

    listen(playerNameInput, 'blur', () => {
      commitPlayerName();
    });

    listen(playerNameInput, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        playerNameInput.blur();
      }
    });

    updateJoinButtonState();

    listen(copyBtn, 'click', () => {
      const code = gameCodeEl.textContent ?? '';
      const url = `${window.location.origin}/?code=${code}`;
      const copyText =
        deps.copyText ??
        ((text: string) => navigator.clipboard?.writeText(text));
      const copyPromise = copyText(url);

      void copyPromise
        ?.then(() => {
          copyButtonTextSignal.value = 'Copied!';
          clearCopyResetTimer();
          copyResetTimer = window.setTimeout(() => {
            copyButtonTextSignal.value = 'Copy Link';
            copyResetTimer = null;
          }, 2000);
        })
        .catch(() => {});
    });

    if (spectatorModeEnabled) {
      listen(copySpectateBtn, 'click', () => {
        const code = gameCodeEl.textContent ?? '';
        const url = `${window.location.origin}/?code=${code}&viewer=spectator`;
        const copyText =
          deps.copyText ?? ((t: string) => navigator.clipboard?.writeText(t));
        const copyPromise = copyText(url);

        void copyPromise
          ?.then(() => {
            copySpectateTextSignal.value = 'Copied!';
            clearCopyResetTimer();
            copyResetTimer = window.setTimeout(() => {
              copySpectateTextSignal.value = 'Copy Observer Link (view-only)';
              copyResetTimer = null;
            }, 2000);
          })
          .catch(() => {});
      });
    } else {
      hide(copySpectateBtn);
    }

    effect(() => {
      const loadingKind = loadingSignal.value;
      const loading = loadingKind !== null;
      const online = deps.onlineSignal?.value ?? true;
      createBtn.disabled = loading || !online;
      quickMatchBtn.disabled = loading || !online;
      codeInputEl.disabled = loading || !online;
      joinBtn.disabled =
        loading || !online || !isJoinInputValid(codeInputEl.value);
      text(
        createBtn,
        loadingKind === 'create' ? 'CREATING...' : 'Create Private Match',
      );
      text(
        quickMatchBtn,
        loadingKind === 'quickMatch' ? 'SEARCHING...' : 'Quick Match',
      );

      const onlineOnlyLinks = Array.from(
        document.querySelectorAll<HTMLElement>('.menu-online-only'),
      );
      for (const link of onlineOnlyLinks) {
        if (online) {
          link.removeAttribute('aria-disabled');
          link.removeAttribute('tabindex');
          link.style.pointerEvents = '';
          link.style.opacity = '';
          link.removeAttribute('title');
        } else {
          link.setAttribute('aria-disabled', 'true');
          link.setAttribute('tabindex', '-1');
          link.style.pointerEvents = 'none';
          link.style.opacity = '0.4';
          link.setAttribute('title', 'Unavailable while offline');
        }
      }

      const offlineBanner = document.getElementById('menuOfflineBanner');
      if (offlineBanner) {
        if (online) {
          offlineBanner.setAttribute('hidden', '');
        } else {
          offlineBanner.removeAttribute('hidden');
        }
      }
    });

    effect(() => {
      const diff = aiDifficultySignal.value;

      for (const btn of difficultyButtons) {
        const on = btn.dataset.difficulty === diff;
        cls(btn, 'active', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      }

      if (difficultyHintEl) {
        const lines: Record<AIDifficulty, string> = {
          easy: 'AI uses a lighter search — good for learning openings.',
          normal: 'Balanced AI search depth for most players.',
          hard: 'Deeper search and sharper heuristics — expect punishing punts.',
        };
        text(difficultyHintEl, lines[diff]);
      }
    });

    effect(() => {
      const q = waitingCopySignal.value.quickMatchQueuedAtMs;
      if (q == null) {
        return;
      }
      const id = window.setInterval(() => {
        queueElapsedTick.update((n) => n + 1);
      }, 1000);
      registerDisposer(() => window.clearInterval(id));
    });

    effect(() => {
      const copy = waitingCopySignal.value;

      text(waitingTitleEl, copy.titleText);
      text(gameCodeEl, copy.codeText);
      gameCodeEl.dataset.variant = copy.codeVariant;
      const rawCode = copy.codeText.trim();
      if (copy.codeVariant === 'statusWord') {
        gameCodeEl.setAttribute(
          'aria-label',
          rawCode === 'SEARCHING'
            ? 'Searching for an opponent'
            : `Status: ${copy.codeText}`,
        );
      } else if (rawCode === '' || rawCode === '...') {
        gameCodeEl.removeAttribute('aria-label');
      } else if (/^[A-Za-z0-9]{5}$/.test(rawCode)) {
        const spelled = rawCode.toUpperCase().split('').join(' ');
        gameCodeEl.setAttribute('aria-label', `Game code: ${spelled}`);
      } else {
        gameCodeEl.setAttribute('aria-label', `Game code: ${copy.codeText}`);
      }
      const queuedAt = copy.quickMatchQueuedAtMs;
      queueElapsedTick.value;
      if (queuedAt != null) {
        const elapsed = Math.max(0, Math.floor((Date.now() - queuedAt) / 1000));
        text(waitingStatusEl, `${copy.statusText} · ${elapsed}s`);
      } else {
        text(waitingStatusEl, copy.statusText);
      }

      if (copy.scenarioText) {
        text(waitingScenarioEl, copy.scenarioText);
        show(waitingScenarioEl);
      } else {
        hide(waitingScenarioEl);
      }

      if (copy.showCopyActions) {
        show(copyBtn, 'inline-flex');
        if (spectatorModeEnabled) {
          show(copySpectateBtn, 'inline-flex');
        }
        if (waitingShareHintEl) {
          waitingShareHintEl.removeAttribute('hidden');
          waitingShareHintEl.style.display =
            waitingShareHintEl.tagName === 'P' ? 'block' : '';
        }
      } else {
        hide(copyBtn);
        hide(copySpectateBtn);
        if (waitingShareHintEl) {
          waitingShareHintEl.setAttribute('hidden', '');
          waitingShareHintEl.style.display = 'none';
        }
      }

      if (copy.cancelActionLabel) {
        text(cancelWaitingBtn, copy.cancelActionLabel);
        show(cancelWaitingBtn, 'inline-flex');
      } else {
        hide(cancelWaitingBtn);
      }
    });

    const hudDefaultBtn = document.getElementById(
      'hudScaleDefaultBtn',
    ) as HTMLButtonElement | null;
    const hudLargeBtn = document.getElementById(
      'hudScaleLargeBtn',
    ) as HTMLButtonElement | null;

    const applyHudScale = (mode: 'default' | 'large'): void => {
      document.documentElement.dataset.hudScale = mode;
      ls?.setItem('deltav_hud_scale', mode);
      hudDefaultBtn?.classList.toggle(
        'hud-scale-btn--active',
        mode === 'default',
      );
      hudLargeBtn?.classList.toggle('hud-scale-btn--active', mode === 'large');
    };

    const initialHud =
      ls?.getItem('deltav_hud_scale') === 'large' ? 'large' : 'default';
    applyHudScale(initialHud);

    if (hudDefaultBtn) {
      listen(hudDefaultBtn, 'click', () => applyHudScale('default'));
    }
    if (hudLargeBtn) {
      listen(hudLargeBtn, 'click', () => applyHudScale('large'));
    }

    listen(cancelWaitingBtn, 'click', () => {
      deps.emit({ type: 'cancelQuickMatch' });
      deps.showMenu();
    });

    text(copyBtn, copyButtonTextSignal);
    if (spectatorModeEnabled) {
      text(copySpectateBtn, copySpectateTextSignal);
    }
  });

  const selectCodeInput = (): void => {
    codeInputEl.select();
  };

  return {
    onMenuShown,
    setMenuLoading,
    setWaitingState,
    selectCodeInput,
    dispose,
  };
};
