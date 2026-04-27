import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIO_DISPLAY_ORDER, SCENARIOS } from '../../shared/map-data';
import {
  buildDefaultUsername,
  type PublicPlayerProfile,
} from '../../shared/player';
import { byId, cls, hide, listen, setTrustedHTML, show, text } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import {
  type ClaimNameResult,
  fetchPlayerRank,
  type IssueRecoveryCodeResult,
  issueRecoveryCode,
  postClaimName,
  type RestoreRecoveryCodeResult,
  type RevokeRecoveryCodeResult,
  restoreRecoveryCode,
  revokeRecoveryCode,
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
  restorePlayerIdentity?: (profile: PublicPlayerProfile) => {
    username: string;
  };
  copyText?: (text: string) => Promise<void> | undefined;
  // Optional network boundary — tests pass a stub so the lobby doesn't
  // hit the real /api/claim-name route.
  postClaimName?: typeof postClaimName;
  fetchPlayerRank?: typeof fetchPlayerRank;
  issueRecoveryCode?: typeof issueRecoveryCode;
  restoreRecoveryCode?: typeof restoreRecoveryCode;
  revokeRecoveryCode?: typeof revokeRecoveryCode;
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
    officialBotPromptText: null,
    officialBotButtonLabel: null,
  });
  const copyButtonTextSignal = signal('Copy Link');
  const copySpectateTextSignal = signal('Copy Observer Link (view-only)');
  const recoveryBusySignal = signal(false);
  const forgetConfirmSignal = signal(false);
  const queueElapsedTick = signal(0);
  const defaultFetch = globalThis.fetch.bind(globalThis);
  const postClaimImpl = deps.postClaimName ?? postClaimName;
  const postClaim: (opts: {
    playerKey: string;
    username: string;
  }) => Promise<ClaimNameResult> = (opts) =>
    postClaimImpl({ ...opts, fetchImpl: defaultFetch });
  const issueRecoveryImpl = deps.issueRecoveryCode ?? issueRecoveryCode;
  const issueRecovery: (opts: {
    playerKey: string;
  }) => Promise<IssueRecoveryCodeResult> = (opts) =>
    issueRecoveryImpl({ ...opts, fetchImpl: defaultFetch });
  const restoreRecoveryImpl = deps.restoreRecoveryCode ?? restoreRecoveryCode;
  const restoreRecovery: (opts: {
    recoveryCode: string;
  }) => Promise<RestoreRecoveryCodeResult> = (opts) =>
    restoreRecoveryImpl({ ...opts, fetchImpl: defaultFetch });
  const revokeRecoveryImpl = deps.revokeRecoveryCode ?? revokeRecoveryCode;
  const revokeRecovery: (opts: {
    playerKey: string;
  }) => Promise<RevokeRecoveryCodeResult> = (opts) =>
    revokeRecoveryImpl({ ...opts, fetchImpl: defaultFetch });
  const restorePlayerIdentity =
    deps.restorePlayerIdentity ??
    ((profile: PublicPlayerProfile) => ({ username: profile.username }));

  const createBtn = byId<HTMLButtonElement>('createBtn');
  const quickMatchBtn = byId<HTMLButtonElement>('quickMatchBtn');
  const singlePlayerBtn = byId('singlePlayerBtn');
  const playerNameInput = byId<HTMLInputElement>('playerNameInput');
  const saveRecoveryCodeBtn = byId<HTMLButtonElement>('saveRecoveryCodeBtn');
  const restoreCallsignBtn = byId<HTMLButtonElement>('restoreCallsignBtn');
  const forgetCallsignBtn = byId<HTMLButtonElement>('forgetCallsignBtn');
  const recoveryPanel = byId<HTMLElement>('recoveryPanel');
  const recoveryCodeBlock = byId<HTMLElement>('recoveryCodeBlock');
  const recoveryCodeText = byId<HTMLElement>('recoveryCodeText');
  const copyRecoveryCodeBtn = byId<HTMLButtonElement>('copyRecoveryCodeBtn');
  const recoveryRestoreForm = byId<HTMLElement>('recoveryRestoreForm');
  const recoveryCodeInput = byId<HTMLInputElement>('recoveryCodeInput');
  const submitRecoveryCodeBtn = byId<HTMLButtonElement>(
    'submitRecoveryCodeBtn',
  );
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
  const officialBotOfferEl = document.getElementById(
    'officialBotOffer',
  ) as HTMLElement | null;
  const officialBotOfferTextEl = document.getElementById(
    'officialBotOfferText',
  ) as HTMLElement | null;
  const officialBotAcceptBtn = document.getElementById(
    'officialBotAcceptBtn',
  ) as HTMLButtonElement | null;
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
    for (const key of SCENARIO_DISPLAY_ORDER) {
      const def = SCENARIOS[key];
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

  const hasClaimedCallsign = (): boolean => {
    const playerKey = deps.getPlayerKey();
    return deps.getPlayerName() !== buildDefaultUsername(playerKey);
  };

  const recoverySavedStorageKey = (playerKey: string): string =>
    `delta-v:recovery-code-saved:${playerKey}`;

  const hasSavedRecoveryCode = (): boolean => {
    const storageKey = recoverySavedStorageKey(deps.getPlayerKey());
    return ls?.getItem(storageKey) === '1';
  };

  const markRecoveryCodeSaved = (playerKey = deps.getPlayerKey()): void => {
    ls?.setItem(recoverySavedStorageKey(playerKey), '1');
  };

  const clearRecoveryCodeSaved = (playerKey: string): void => {
    ls?.removeItem(recoverySavedStorageKey(playerKey));
  };

  const withRecoveryNudge = (status: string): string =>
    hasClaimedCallsign() && !hasSavedRecoveryCode()
      ? `${status} · Save a recovery code to keep it.`
      : status;

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
    officialBotPromptText: null,
    officialBotButtonLabel: null,
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
      if (!hasClaimedCallsign()) {
        return;
      }

      const playerKey = deps.getPlayerKey();
      void fetchRank({ playerKey }).then((result) => {
        if (!result.ok) return;
        setCallsignStatus(
          withRecoveryNudge(formatRankText(result.player)),
          'info',
        );
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
        setCallsignStatus(
          withRecoveryNudge(`Claimed as ${result.player.username}`),
          'success',
        );
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

    const hideRecoveryPanel = (): void => {
      hide(recoveryPanel);
      hide(recoveryCodeBlock);
      hide(recoveryRestoreForm);
    };

    const showRecoveryCode = (recoveryCode: string): void => {
      text(recoveryCodeText, recoveryCode);
      show(recoveryPanel);
      show(recoveryCodeBlock);
      hide(recoveryRestoreForm);
    };

    const showRestoreForm = (): void => {
      recoveryCodeInput.value = '';
      show(recoveryPanel);
      hide(recoveryCodeBlock);
      show(recoveryRestoreForm);
      recoveryCodeInput.focus();
    };

    const mapIssueRecoveryError = (
      result: Exclude<IssueRecoveryCodeResult, { ok: true }>,
    ): string => {
      if (result.error === 'not_claimed') {
        return 'Claim callsign before saving a recovery code.';
      }
      if (result.error === 'rate_limited') {
        return 'Too many recovery attempts — try again in a minute.';
      }
      if (result.error === 'network' || result.error === 'unavailable') {
        return 'Recovery service unavailable — try again online.';
      }
      return 'Could not create a recovery code.';
    };

    const mapRestoreRecoveryError = (
      result: Exclude<RestoreRecoveryCodeResult, { ok: true }>,
    ): string => {
      if (result.error === 'invalid_code') {
        return 'Invalid recovery code.';
      }
      if (result.error === 'not_found') {
        return 'Recovery code not found.';
      }
      if (result.error === 'rate_limited') {
        return 'Too many recovery attempts — try again in a minute.';
      }
      if (result.error === 'network' || result.error === 'unavailable') {
        return 'Recovery service unavailable — try again online.';
      }
      return 'Could not restore callsign.';
    };

    const claimCurrentNameForRecovery = async (): Promise<boolean> => {
      const normalised = deps.setPlayerName(playerNameInput.value);
      playerNameInput.value = normalised;
      const result = await requestClaim(postClaim);
      if (result.ok) {
        return true;
      }
      applyClaimResult(result);
      return false;
    };

    const createRecoveryCode = async (): Promise<void> => {
      forgetConfirmSignal.value = false;
      recoveryBusySignal.value = true;
      try {
        const claimed = await claimCurrentNameForRecovery();
        if (!claimed) {
          return;
        }

        setCallsignStatus('Creating recovery code…', 'info');
        const result = await issueRecovery({ playerKey: deps.getPlayerKey() });
        if (result.ok) {
          markRecoveryCodeSaved();
          showRecoveryCode(result.recoveryCode);
          setCallsignStatus('Recovery code ready. Save it now.', 'success');
        } else {
          setCallsignStatus(mapIssueRecoveryError(result), 'error');
        }
      } finally {
        recoveryBusySignal.value = false;
      }
    };

    const restoreCallsign = async (): Promise<void> => {
      forgetConfirmSignal.value = false;
      recoveryBusySignal.value = true;
      try {
        setCallsignStatus('Restoring callsign…', 'info');
        const result = await restoreRecovery({
          recoveryCode: recoveryCodeInput.value,
        });
        if (!result.ok) {
          setCallsignStatus(mapRestoreRecoveryError(result), 'error');
          return;
        }

        const profile = restorePlayerIdentity(result.profile);
        playerNameInput.value = profile.username;
        markRecoveryCodeSaved(result.profile.playerKey);
        recoveryCodeInput.value = '';
        hideRecoveryPanel();
        setCallsignStatus(`Restored as ${profile.username}`, 'success');
        refreshRank();
      } finally {
        recoveryBusySignal.value = false;
      }
    };

    const forgetCallsign = async (): Promise<void> => {
      forgetConfirmSignal.value = false;
      recoveryBusySignal.value = true;
      const playerKey = deps.getPlayerKey();
      let revokeFailed = false;
      try {
        setCallsignStatus('Forgetting callsign…', 'info');
        const result = await revokeRecovery({ playerKey });
        revokeFailed = !result.ok;
      } catch {
        revokeFailed = true;
      } finally {
        clearRecoveryCodeSaved(playerKey);
        const profile = deps.resetPlayerIdentity();
        playerNameInput.value = profile.username;
        hideRecoveryPanel();
        recoveryBusySignal.value = false;
        setCallsignStatus(
          revokeFailed
            ? 'Local callsign cleared. Recovery revoke could not be confirmed.'
            : 'Local callsign cleared on this device.',
          revokeFailed ? 'error' : 'info',
        );
      }
    };

    let forgetConfirmTimer: number | null = null;

    const clearForgetConfirmTimer = (): void => {
      if (forgetConfirmTimer === null) {
        return;
      }
      window.clearTimeout(forgetConfirmTimer);
      forgetConfirmTimer = null;
    };

    const resetForgetConfirmation = (): void => {
      clearForgetConfirmTimer();
      forgetConfirmSignal.value = false;
    };

    const requestForgetCallsign = (): void => {
      if (forgetConfirmSignal.value) {
        resetForgetConfirmation();
        void forgetCallsign();
        return;
      }

      forgetConfirmSignal.value = true;
      setCallsignStatus(
        'Tap Forget my callsign again to clear this device.',
        'error',
      );
      clearForgetConfirmTimer();
      forgetConfirmTimer = window.setTimeout(() => {
        forgetConfirmTimer = null;
        forgetConfirmSignal.value = false;
      }, 3000);
    };

    registerDisposer(clearForgetConfirmTimer);

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

    listen(saveRecoveryCodeBtn, 'click', () => {
      void createRecoveryCode();
    });

    listen(restoreCallsignBtn, 'click', () => {
      resetForgetConfirmation();
      showRestoreForm();
    });

    listen(submitRecoveryCodeBtn, 'click', () => {
      void restoreCallsign();
    });

    listen(recoveryCodeInput, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        void restoreCallsign();
      }
    });

    listen(copyRecoveryCodeBtn, 'click', () => {
      const code = recoveryCodeText.textContent ?? '';
      const copyText =
        deps.copyText ??
        ((text: string) => navigator.clipboard?.writeText(text));
      void copyText(code)
        ?.then(() => setCallsignStatus('Recovery code copied.', 'success'))
        .catch(() => {});
    });

    listen(forgetCallsignBtn, 'click', () => {
      requestForgetCallsign();
    });

    hideRecoveryPanel();

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
      const recoveryBusy = recoveryBusySignal.value;
      createBtn.disabled = loading || !online;
      quickMatchBtn.disabled = loading || !online;
      codeInputEl.disabled = loading || !online;
      joinBtn.disabled =
        loading || !online || !isJoinInputValid(codeInputEl.value);
      saveRecoveryCodeBtn.disabled = loading || !online || recoveryBusy;
      restoreCallsignBtn.disabled = loading || !online || recoveryBusy;
      forgetCallsignBtn.disabled = loading || !online || recoveryBusy;
      recoveryCodeInput.disabled = loading || !online || recoveryBusy;
      submitRecoveryCodeBtn.disabled = loading || !online || recoveryBusy;
      copyRecoveryCodeBtn.disabled = loading || !online || recoveryBusy;
      text(
        forgetCallsignBtn,
        forgetConfirmSignal.value ? 'Confirm forget' : 'Forget my callsign',
      );
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

      if (officialBotOfferEl) {
        if (copy.officialBotPromptText) {
          if (officialBotOfferTextEl) {
            text(officialBotOfferTextEl, copy.officialBotPromptText);
          }
          officialBotOfferEl.removeAttribute('hidden');
          officialBotOfferEl.style.display = '';
          if (officialBotAcceptBtn) {
            if (copy.officialBotButtonLabel) {
              text(officialBotAcceptBtn, copy.officialBotButtonLabel);
              officialBotAcceptBtn.removeAttribute('hidden');
              officialBotAcceptBtn.style.display = '';
            } else {
              officialBotAcceptBtn.setAttribute('hidden', '');
              officialBotAcceptBtn.style.display = 'none';
            }
          }
        } else {
          officialBotOfferEl.setAttribute('hidden', '');
          officialBotOfferEl.style.display = 'none';
          if (officialBotAcceptBtn) {
            officialBotAcceptBtn.setAttribute('hidden', '');
            officialBotAcceptBtn.style.display = 'none';
          }
        }
      }
    });

    listen(cancelWaitingBtn, 'click', () => {
      deps.emit({ type: 'cancelQuickMatch' });
      deps.showMenu();
    });

    if (officialBotAcceptBtn) {
      listen(officialBotAcceptBtn, 'click', () => {
        deps.emit({ type: 'acceptOfficialBotMatch' });
      });
    }

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
