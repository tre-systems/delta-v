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
    this.scope.add(
      listen(this.createBtn, 'click', () => {
        this.deps.showScenarioSelect();
      }),
    );

    this.scope.add(
      listen(this.singlePlayerBtn, 'click', () => {
        this.pendingAIGameSignal.value = true;
        this.deps.showScenarioSelect();
      }),
    );

    this.scope.add(
      listen(this.backBtn, 'click', () => {
        this.deps.emit({ type: 'backToMenu' });
        this.deps.showMenu();
      }),
    );
  }

  private bindDifficultyButtons(): void {
    for (const btn of this.difficultyButtons) {
      this.scope.add(
        listen(btn, 'click', (event) => {
          event.stopPropagation();
          this.aiDifficultySignal.value = btn.dataset
            .difficulty as AIDifficulty;
        }),
      );
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
    this.scope.add(
      listen(this.joinBtn, 'click', () => {
        this.submitJoin(this.codeInputEl.value);
      }),
    );

    this.scope.add(
      listen(this.codeInputEl, 'keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.submitJoin((e.target as HTMLInputElement).value);
        }
      }),
    );
  }

  private bindCopyButton(): void {
    this.scope.add(
      listen(this.copyBtn, 'click', () => {
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
      }),
    );
  }

  private buildScenarioList(): void {
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

      this.scenarioListEl.appendChild(btn);
    }

    this.scope.add(
      listen(this.scenarioListEl, 'click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          '.btn-scenario',
        );
        const scenario = button?.dataset.scenario;

        if (!scenario) return;

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
      }),
    );
  }

  dispose(): void {
    if (this.copyResetTimer !== null) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }

    this.scope.dispose();
  }
}
