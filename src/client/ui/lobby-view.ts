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
import { createDisposalScope, effect, signal, withScope } from '../reactive';
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
  getPlayerName: () => string;
  setPlayerName: (name: string) => string;
  getPlayerKey: () => string;
  copyText?: (text: string) => Promise<void> | undefined;
  // Optional network boundary — tests pass a stub so the lobby doesn't
  // hit the real /api/claim-name route.
  postClaimName?: typeof postClaimName;
  fetchPlayerRank?: typeof fetchPlayerRank;
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
  });
  const copyButtonTextSignal = signal('Copy Link');
  const copySpectateTextSignal = signal('Copy Observer Link (view-only)');

  const createBtn = byId<HTMLButtonElement>('createBtn');
  const quickMatchBtn = byId<HTMLButtonElement>('quickMatchBtn');
  const singlePlayerBtn = byId('singlePlayerBtn');
  const playerNameInput = byId<HTMLInputElement>('playerNameInput');
  const backBtn = byId('backBtn');
  const scenarioListEl = byId('scenarioList');
  const difficultyButtons = Array.from(
    document.querySelectorAll<HTMLElement>('.btn-difficulty'),
  );
  const joinBtn = byId<HTMLButtonElement>('joinBtn');
  const codeInputEl = byId<HTMLInputElement>('codeInput');
  const menuHowToPlayBtn = byId('menuHowToPlayBtn');
  const helpOverlayEl = byId('helpOverlay');
  const helpCloseBtnEl = byId<HTMLButtonElement>('helpCloseBtn');
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

      setTrustedHTML(
        btn,
        `<div class="scenario-name">${def.name}${tags}</div>` +
          `<div class="scenario-desc">${def.description}</div>`,
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
      show(helpOverlayEl, 'flex');
      helpCloseBtnEl.focus();
    });

    listen(helpCloseBtnEl, 'click', () => {
      hide(helpOverlayEl);
      menuHowToPlayBtn.focus();
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
      const postClaim = deps.postClaimName ?? postClaimName;
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

    const fetchRank = deps.fetchPlayerRank ?? fetchPlayerRank;

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
      postClaim: typeof postClaimName,
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

    const runClaim = (postClaim: typeof postClaimName): void => {
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
      const postClaim = deps.postClaimName ?? postClaimName;
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
      createBtn.disabled = loading;
      quickMatchBtn.disabled = loading;
      joinBtn.disabled = loading || !isJoinInputValid(codeInputEl.value);
      text(
        createBtn,
        loadingKind === 'create' ? 'CREATING...' : 'Create Private Match',
      );
      text(
        quickMatchBtn,
        loadingKind === 'quickMatch' ? 'SEARCHING...' : 'Quick Match',
      );
    });

    effect(() => {
      const diff = aiDifficultySignal.value;

      for (const btn of difficultyButtons) {
        cls(btn, 'active', btn.dataset.difficulty === diff);
      }
    });

    effect(() => {
      const copy = waitingCopySignal.value;

      text(waitingTitleEl, copy.titleText);
      text(gameCodeEl, copy.codeText);
      gameCodeEl.dataset.variant = copy.codeVariant;
      text(waitingStatusEl, copy.statusText);

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
