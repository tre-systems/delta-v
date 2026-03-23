import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId, listen, setTrustedHTML } from '../dom';
import { createDisposalScope, effect, signal } from '../reactive';
import type { AIDifficulty, UIEvent } from './events';
import { parseJoinInput } from './formatters';
import { buildWaitingScreenCopy } from './screens';

export interface LobbyViewDeps {
  emit: (event: UIEvent) => void;
  showMenu: () => void;
  showScenarioSelect: () => void;
  copyText?: (text: string) => Promise<void> | undefined;
}

export interface LobbyView {
  onMenuShown: () => void;
  setMenuLoading: (loading: boolean) => void;
  showWaiting: (code: string) => void;
  showConnecting: () => void;
  dispose: () => void;
}

export const createLobbyView = (deps: LobbyViewDeps): LobbyView => {
  const scope = createDisposalScope();
  const aiDifficultySignal = signal<AIDifficulty>('normal');
  const pendingAIGameSignal = signal(false);
  const loadingSignal = signal(false);
  const waitingCopySignal = signal(buildWaitingScreenCopy('', false));
  const copyButtonTextSignal = signal('Copy Link');

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
  const gameCodeEl = byId('gameCode');
  const waitingStatusEl = byId('waitingStatus');

  let copyResetTimer: number | null = null;

  const clearCopyResetTimer = () => {
    if (copyResetTimer === null) {
      return;
    }

    window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
  };

  const submitJoin = (rawValue: string): void => {
    const parsed = parseJoinInput(rawValue, CODE_LENGTH);

    if (!parsed) {
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

    scope.add(
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
      }),
    );
  };

  scope.add(
    listen(createBtn, 'click', () => {
      deps.showScenarioSelect();
    }),
  );

  scope.add(
    listen(singlePlayerBtn, 'click', () => {
      pendingAIGameSignal.value = true;
      deps.showScenarioSelect();
    }),
  );

  scope.add(
    listen(backBtn, 'click', () => {
      deps.emit({ type: 'backToMenu' });
      deps.showMenu();
    }),
  );

  for (const btn of difficultyButtons) {
    scope.add(
      listen(btn, 'click', (event) => {
        event.stopPropagation();
        aiDifficultySignal.value = btn.dataset.difficulty as AIDifficulty;
      }),
    );
  }

  scope.add(
    listen(joinBtn, 'click', () => {
      submitJoin(codeInputEl.value);
    }),
  );

  scope.add(
    listen(codeInputEl, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        submitJoin((event.target as HTMLInputElement).value);
      }
    }),
  );

  scope.add(
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
    }),
  );

  scope.add(
    effect(() => {
      const loading = loadingSignal.value;
      createBtn.disabled = loading;
      createBtn.textContent = loading ? 'CREATING...' : 'Create Game';
    }),
  );

  scope.add(
    effect(() => {
      const diff = aiDifficultySignal.value;

      for (const btn of difficultyButtons) {
        btn.classList.toggle('active', btn.dataset.difficulty === diff);
      }
    }),
  );

  scope.add(
    effect(() => {
      const copy = waitingCopySignal.value;

      gameCodeEl.textContent = copy.codeText;
      waitingStatusEl.textContent = copy.statusText;
    }),
  );

  scope.add(
    effect(() => {
      copyBtn.textContent = copyButtonTextSignal.value;
    }),
  );

  bindScenarioList();

  const onMenuShown = (): void => {
    pendingAIGameSignal.value = false;
  };

  const setMenuLoading = (loading: boolean): void => {
    loadingSignal.value = loading;
  };

  const showWaiting = (code: string): void => {
    waitingCopySignal.value = buildWaitingScreenCopy(code, false);
  };

  const showConnecting = (): void => {
    waitingCopySignal.value = buildWaitingScreenCopy('', true);
  };

  const dispose = (): void => {
    clearCopyResetTimer();
    scope.dispose();
  };

  return {
    onMenuShown,
    setMenuLoading,
    showWaiting,
    showConnecting,
    dispose,
  };
};
