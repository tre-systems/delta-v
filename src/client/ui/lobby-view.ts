import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId, cls, hide, listen, setTrustedHTML, show, text } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import type { AIDifficulty, UIEvent } from './events';
import { parseJoinInput } from './formatters';
import { buildWaitingScreenCopy, type WaitingScreenState } from './screens';

export interface LobbyViewDeps {
  emit: (event: UIEvent) => void;
  showMenu: () => void;
  showScenarioSelect: () => void;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  getPlayerName: () => string;
  setPlayerName: (name: string) => string;
  copyText?: (text: string) => Promise<void> | undefined;
}

export interface LobbyView {
  onMenuShown: () => void;
  setMenuLoading: (loading: boolean, kind?: 'create' | 'quickMatch') => void;
  setWaitingState: (state: WaitingScreenState | null) => void;
  selectCodeInput: () => void;
  dispose: () => void;
}

/** Node 25 + jsdom (and some test globals) can expose a non-Storage `localStorage`; validate before use. */
const webLocalStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    const g = globalThis as typeof globalThis & {
      localStorage?: unknown;
      window?: { localStorage?: unknown };
    };
    const candidates = [g.localStorage, g.window?.localStorage];
    for (const ls of candidates) {
      if (
        ls !== null &&
        ls !== undefined &&
        typeof ls === 'object' &&
        typeof (ls as Storage).getItem === 'function' &&
        typeof (ls as Storage).setItem === 'function'
      ) {
        return ls as Storage;
      }
    }
  } catch {
    /* private mode / no storage */
  }
  return null;
};

export const createLobbyView = (deps: LobbyViewDeps): LobbyView => {
  const scope = createDisposalScope();
  const ls = webLocalStorage();
  const storedDifficulty =
    (ls?.getItem('aiDifficulty') as AIDifficulty | null) ?? 'normal';
  const aiDifficultySignal = signal<AIDifficulty>(storedDifficulty);
  const pendingAIGameSignal = signal(false);
  const loadingSignal = signal<'create' | 'quickMatch' | null>(null);
  const waitingCopySignal = signal(
    buildWaitingScreenCopy({
      kind: 'private',
      code: '',
      connecting: false,
    }),
  );
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
        deps.showToast('Enter a game code to join', 'error');
      } else {
        deps.showToast(
          `Invalid code \u2014 must be ${CODE_LENGTH} characters`,
          'error',
        );
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

  const setMenuLoading = (
    loading: boolean,
    kind: 'create' | 'quickMatch' = 'create',
  ): void => {
    loadingSignal.value = loading ? kind : null;
  };

  const setWaitingState = (state: WaitingScreenState | null): void => {
    waitingCopySignal.value = buildWaitingScreenCopy(
      state ?? {
        kind: 'private',
        code: '',
        connecting: false,
      },
    );
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
      deps.emit({ type: 'quickMatch' });
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

    const commitPlayerName = () => {
      playerNameInput.value = deps.setPlayerName(playerNameInput.value);
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
