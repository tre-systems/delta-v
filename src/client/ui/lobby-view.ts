import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import { byId } from '../dom';
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
  private aiDifficulty: AIDifficulty = 'normal';
  private pendingAIGame = false;

  constructor(private readonly deps: LobbyViewDeps) {
    this.bindMenuControls();
    this.bindDifficultyButtons();
    this.buildScenarioList();
    this.bindJoinControls();
    this.bindCopyButton();
  }

  onMenuShown(): void {
    this.pendingAIGame = false;
  }

  setMenuLoading(loading: boolean): void {
    const btn = byId<HTMLButtonElement>('createBtn');

    btn.disabled = loading;
    btn.textContent = loading ? 'CREATING...' : 'Create Game';
  }

  showWaiting(code: string): void {
    const copy = buildWaitingScreenCopy(code, false);
    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  showConnecting(): void {
    const copy = buildWaitingScreenCopy('', true);
    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  private bindMenuControls(): void {
    byId('createBtn').addEventListener('click', () => {
      this.deps.showScenarioSelect();
    });

    byId('singlePlayerBtn').addEventListener('click', () => {
      this.pendingAIGame = true;
      this.deps.showScenarioSelect();
    });

    byId('backBtn').addEventListener('click', () => {
      this.deps.emit({ type: 'backToMenu' });
      this.deps.showMenu();
    });
  }

  private bindDifficultyButtons(): void {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>('.btn-difficulty'),
    );

    for (const btn of buttons) {
      btn.addEventListener('click', (event: Event) => {
        event.stopPropagation();

        this.aiDifficulty = btn.dataset.difficulty as AIDifficulty;

        for (const button of buttons) {
          button.classList.remove('active');
        }

        btn.classList.add('active');
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
    byId('joinBtn').addEventListener('click', () => {
      this.submitJoin(byId<HTMLInputElement>('codeInput').value);
    });

    byId('codeInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.submitJoin((event.target as HTMLInputElement).value);
      }
    });
  }

  private bindCopyButton(): void {
    byId('copyBtn').addEventListener('click', () => {
      const code = byId('gameCode').textContent ?? '';
      const url = `${window.location.origin}/?code=${code}`;
      const copyText =
        this.deps.copyText ??
        ((text: string) => navigator.clipboard?.writeText(text));
      const copyPromise = copyText(url);

      copyPromise
        ?.then(() => {
          byId('copyBtn').textContent = 'Copied!';

          setTimeout(() => {
            byId('copyBtn').textContent = 'Copy Link';
          }, 2000);
        })
        .catch(() => {});
    });
  }

  private buildScenarioList(): void {
    const container = byId('scenarioList');

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

      btn.addEventListener('click', () => {
        if (this.pendingAIGame) {
          this.pendingAIGame = false;
          this.deps.emit({
            type: 'startSinglePlayer',
            scenario: key,
            difficulty: this.aiDifficulty,
          });
          return;
        }

        this.deps.emit({
          type: 'selectScenario',
          scenario: key,
        });
      });

      container.appendChild(btn);
    }
  }
}
