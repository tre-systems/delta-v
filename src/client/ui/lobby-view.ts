import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId, cls, hide, listen, setTrustedHTML, text } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import type { AIDifficulty, UIEvent } from './events';
import { parseJoinInput } from './formatters';
import { buildWaitingScreenCopy } from './screens';

export interface LobbyViewDeps {
  emit: (event: UIEvent) => void;
  showMenu: () => void;
  showScenarioSelect: () => void;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  copyText?: (text: string) => Promise<void> | undefined;
}

export interface LobbyView {
  onMenuShown: () => void;
  setMenuLoading: (loading: boolean) => void;
  setWaitingState: (code: string | null, connecting: boolean) => void;
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
  const loadingSignal = signal(false);
  const waitingCopySignal = signal(buildWaitingScreenCopy('', false));
  const copyButtonTextSignal = signal('Copy Link');
  const copySpectateTextSignal = signal('Copy Spectate Link');

  const createBtn = byId<HTMLButtonElement>('createBtn');
  const singlePlayerBtn = byId('singlePlayerBtn');
  const backBtn = byId('backBtn');
  const scenarioListEl = byId('scenarioList');
  const difficultyButtons = Array.from(
    document.querySelectorAll<HTMLElement>('.btn-difficulty'),
  );
  const joinBtn = byId('joinBtn');
  const codeInputEl = byId<HTMLInputElement>('codeInput');
  const copyBtn = byId('copyBtn');
  const copySpectateBtn = byId('copySpectateBtn');
  const gameCodeEl = byId('gameCode');
  const waitingStatusEl = byId('waitingStatus');

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

  const setMenuLoading = (loading: boolean): void => {
    loadingSignal.value = loading;
  };

  const setWaitingState = (code: string | null, connecting: boolean): void => {
    waitingCopySignal.value = buildWaitingScreenCopy(code ?? '', connecting);
  };

  const dispose = (): void => {
    clearCopyResetTimer();
    scope.dispose();
  };

  bindScenarioList();

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

    listen(createBtn, 'click', () => {
      deps.showScenarioSelect();
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
              copySpectateTextSignal.value = 'Copy Spectate Link';
              copyResetTimer = null;
            }, 2000);
          })
          .catch(() => {});
      });
    } else {
      hide(copySpectateBtn);
    }

    effect(() => {
      const loading = loadingSignal.value;
      createBtn.disabled = loading;
      text(createBtn, loading ? 'CREATING...' : 'Create Game');
    });

    effect(() => {
      const diff = aiDifficultySignal.value;

      for (const btn of difficultyButtons) {
        cls(btn, 'active', btn.dataset.difficulty === diff);
      }
    });

    effect(() => {
      const copy = waitingCopySignal.value;

      text(gameCodeEl, copy.codeText);
      text(waitingStatusEl, copy.statusText);
    });

    text(copyBtn, copyButtonTextSignal);
    if (spectatorModeEnabled) {
      text(copySpectateBtn, copySpectateTextSignal);
    }
  });

  return {
    onMenuShown,
    setMenuLoading,
    setWaitingState,
    dispose,
  };
};
