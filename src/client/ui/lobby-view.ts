import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId } from '../dom';
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

export class LobbyView {
  private readonly scope = createDisposalScope();
  private readonly aiDifficultySignal = signal<AIDifficulty>('normal');
  private readonly pendingAIGameSignal = signal(false);
  private readonly loadingSignal = signal(false);
  private readonly waitingCopySignal = signal(
    buildWaitingScreenCopy('', false),
  );
  private readonly copyButtonTextSignal = signal('Copy Link');

  private readonly createBtn = byId<HTMLButtonElement>('createBtn');
  private readonly singlePlayerBtn = byId('singlePlayerBtn');
  private readonly backBtn = byId('backBtn');
  private readonly scenarioListEl = byId('scenarioList');
  private readonly difficultyButtons = Array.from(
    document.querySelectorAll<HTMLElement>('.btn-difficulty'),
  );
  private readonly joinBtn = byId('joinBtn');
  private readonly codeInputEl = byId<HTMLInputElement>('codeInput');
  private readonly copyBtn = byId('copyBtn');
  private readonly gameCodeEl = byId('gameCode');
  private readonly waitingStatusEl = byId('waitingStatus');

  private copyResetTimer: number | null = null;

  constructor(private readonly deps: LobbyViewDeps) {
    this.bindMenuControls();
    this.bindDifficultyButtons();
    this.buildScenarioList();
    this.bindJoinControls();
    this.bindCopyButton();

    this.scope.add(
      effect(() => {
        const loading = this.loadingSignal.value;
        this.createBtn.disabled = loading;
        this.createBtn.textContent = loading ? 'CREATING...' : 'Create Game';
      }),
    );

    this.scope.add(
      effect(() => {
        const diff = this.aiDifficultySignal.value;

        for (const btn of this.difficultyButtons) {
          btn.classList.toggle('active', btn.dataset.difficulty === diff);
        }
      }),
    );

    this.scope.add(
      effect(() => {
        const copy = this.waitingCopySignal.value;

        this.gameCodeEl.textContent = copy.codeText;
        this.waitingStatusEl.textContent = copy.statusText;
      }),
    );

    this.scope.add(
      effect(() => {
        this.copyBtn.textContent = this.copyButtonTextSignal.value;
      }),
    );
  }

  onMenuShown(): void {
    this.pendingAIGameSignal.value = false;
  }

  setMenuLoading(loading: boolean): void {
    this.loadingSignal.value = loading;
  }

  showWaiting(code: string): void {
    this.waitingCopySignal.value = buildWaitingScreenCopy(code, false);
  }

  showConnecting(): void {
    this.waitingCopySignal.value = buildWaitingScreenCopy('', true);
  }

  private bindMenuControls(): void {
    const handleCreateClick = () => {
      this.deps.showScenarioSelect();
    };
    this.createBtn.addEventListener('click', handleCreateClick);
    this.scope.add(() => {
      this.createBtn.removeEventListener('click', handleCreateClick);
    });

    const handleSinglePlayerClick = () => {
      this.pendingAIGameSignal.value = true;
      this.deps.showScenarioSelect();
    };
    this.singlePlayerBtn.addEventListener('click', handleSinglePlayerClick);
    this.scope.add(() => {
      this.singlePlayerBtn.removeEventListener(
        'click',
        handleSinglePlayerClick,
      );
    });

    const handleBackClick = () => {
      this.deps.emit({ type: 'backToMenu' });
      this.deps.showMenu();
    };
    this.backBtn.addEventListener('click', handleBackClick);
    this.scope.add(() => {
      this.backBtn.removeEventListener('click', handleBackClick);
    });
  }

  private bindDifficultyButtons(): void {
    for (const btn of this.difficultyButtons) {
      const handleDifficultyClick = (event: Event) => {
        event.stopPropagation();
        this.aiDifficultySignal.value = btn.dataset.difficulty as AIDifficulty;
      };

      btn.addEventListener('click', handleDifficultyClick);
      this.scope.add(() => {
        btn.removeEventListener('click', handleDifficultyClick);
      });
    }
  }

  private submitJoin(rawValue: string): void {
    const parsed = parseJoinInput(rawValue, CODE_LENGTH);
    if (!parsed) {
      return;
    }

    this.deps.emit({
      type: 'join',
      code: parsed.code,
      playerToken: parsed.playerToken,
    });
  }

  private bindJoinControls(): void {
    const handleJoinClick = () => {
      this.submitJoin(this.codeInputEl.value);
    };
    this.joinBtn.addEventListener('click', handleJoinClick);
    this.scope.add(() => {
      this.joinBtn.removeEventListener('click', handleJoinClick);
    });

    const handleCodeInputKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        this.submitJoin((event.target as HTMLInputElement).value);
      }
    };
    this.codeInputEl.addEventListener('keydown', handleCodeInputKeydown);
    this.scope.add(() => {
      this.codeInputEl.removeEventListener('keydown', handleCodeInputKeydown);
    });
  }

  private bindCopyButton(): void {
    const handleCopyClick = () => {
      const code = this.gameCodeEl.textContent ?? '';
      const url = `${window.location.origin}/?code=${code}`;
      const copyText =
        this.deps.copyText ??
        ((text: string) => navigator.clipboard?.writeText(text));
      const copyPromise = copyText(url);

      void copyPromise
        ?.then(() => {
          this.copyButtonTextSignal.value = 'Copied!';

          if (this.copyResetTimer !== null) {
            window.clearTimeout(this.copyResetTimer);
          }

          this.copyResetTimer = window.setTimeout(() => {
            this.copyButtonTextSignal.value = 'Copy Link';
            this.copyResetTimer = null;
          }, 2000);
        })
        .catch(() => {});
    };

    this.copyBtn.addEventListener('click', handleCopyClick);
    this.scope.add(() => {
      this.copyBtn.removeEventListener('click', handleCopyClick);
    });
  }

  private buildScenarioList(): void {
    for (const [key, def] of Object.entries(SCENARIOS)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-scenario';
      btn.dataset.scenario = key;

      const tags = (def.tags ?? [])
        .map((tag) => `<span class="scenario-tag">${tag}</span>`)
        .join('');

      btn.innerHTML =
        `<div class="scenario-name">${def.name}${tags}</div>` +
        `<div class="scenario-desc">${def.description}</div>`;

      this.scenarioListEl.appendChild(btn);
    }

    const handleScenarioClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        '.btn-scenario',
      );
      const scenario = button?.dataset.scenario;

      if (!scenario) {
        return;
      }

      if (this.pendingAIGameSignal.peek()) {
        this.pendingAIGameSignal.value = false;
        this.deps.emit({
          type: 'startSinglePlayer',
          scenario,
          difficulty: this.aiDifficultySignal.peek(),
        });
        return;
      }

      this.deps.emit({
        type: 'selectScenario',
        scenario,
      });
    };

    this.scenarioListEl.addEventListener('click', handleScenarioClick);
    this.scope.add(() => {
      this.scenarioListEl.removeEventListener('click', handleScenarioClick);
    });
  }

  dispose(): void {
    if (this.copyResetTimer !== null) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }

    this.scope.dispose();
  }
}
