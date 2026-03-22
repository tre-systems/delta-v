import type {
  CombatResult,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import { byId, el } from '../dom';
import { computed, createDisposalScope, effect, signal } from '../reactive';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
} from './formatters';
import { buildScreenVisibility, type UIScreenMode } from './screens';

export interface GameLogViewDeps {
  onChat: (text: string) => void;
}

export class GameLogView {
  private readonly scope = createDisposalScope();
  private readonly gameLogEl = byId('gameLog');
  private readonly logEntriesEl = byId('logEntries');
  private readonly chatInputRow = byId('chatInputRow');
  private readonly chatInput = byId<HTMLInputElement>('chatInput');
  private readonly logLatestBar = byId('logLatestBar');
  private readonly logLatestText = byId('logLatestText');
  private readonly logStatusBar: HTMLElement;
  private readonly logStatusText: HTMLElement;

  private lastTurnHeader: HTMLElement | null = null;
  private playerId = -1;

  private readonly screenModeSignal = signal<UIScreenMode>('hidden');
  private readonly expandedSignal = signal(false);
  private readonly chatEnabledSignal = signal(false);
  private readonly lastLogTextSignal = signal('');
  private readonly lastLogClassSignal = signal('');
  private readonly statusTextSignal = signal<string | null>(null);

  constructor(private readonly deps: GameLogViewDeps) {
    this.logStatusText = el('span', {
      class: 'log-status-text',
    });
    this.logStatusBar = el('div', {
      class: 'log-status-bar',
    });
    this.logStatusBar.style.display = 'none';
    this.logStatusBar.appendChild(this.logStatusText);
    this.gameLogEl.insertBefore(this.logStatusBar, this.gameLogEl.firstChild);

    this.bindChatInput();
    this.bindLogControls();

    const latestBarCopySignal = this.scope.add(
      computed(() => {
        const statusText = this.statusTextSignal.value;
        const lastLogText = this.lastLogTextSignal.value;
        const lastLogClass = this.lastLogClassSignal.value;

        return {
          text: statusText ?? lastLogText,
          cssClass: statusText ? 'log-status' : lastLogClass,
        };
      }),
    );

    const visibilitySignal = this.scope.add(
      computed(() => {
        const mode = this.screenModeSignal.value;

        if (mode === 'hud') {
          const expanded = this.expandedSignal.value;

          return {
            gameLog: expanded ? 'flex' : 'none',
            latestBar: expanded ? 'none' : 'block',
          };
        }

        const visibility = buildScreenVisibility(mode);

        return {
          gameLog: visibility.gameLog,
          latestBar: 'none',
        };
      }),
    );

    this.scope.add(
      effect(() => {
        const copy = latestBarCopySignal.value;
        this.logLatestText.textContent = copy.text;
        this.logLatestText.className = `log-latest-text ${copy.cssClass}`;
      }),
    );

    this.scope.add(
      effect(() => {
        const visibility = visibilitySignal.value;

        this.gameLogEl.style.display = visibility.gameLog;
        this.logLatestBar.style.display = visibility.latestBar;
      }),
    );

    this.scope.add(
      effect(() => {
        const status = this.statusTextSignal.value;
        this.logStatusBar.style.display = status ? '' : 'none';
        this.logStatusText.textContent = status ?? '';
      }),
    );

    this.scope.add(
      effect(() => {
        this.chatInputRow.style.display = this.chatEnabledSignal.value
          ? ''
          : 'none';
      }),
    );
  }

  setPlayerId(id: number): void {
    this.playerId = id;
  }

  setMobile(_isMobile: boolean, hudVisible: boolean): void {
    if (hudVisible) {
      this.expandedSignal.value = false;
    }
  }

  applyScreenVisibility(mode: UIScreenMode): void {
    this.screenModeSignal.value = mode;
  }

  resetVisibilityState(): void {
    this.expandedSignal.value = false;
  }

  showHUD(): void {
    this.screenModeSignal.value = 'hud';
    this.expandedSignal.value = false;
  }

  toggle(): void {
    if (this.screenModeSignal.peek() !== 'hud') {
      return;
    }

    if (this.expandedSignal.peek()) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  clear(): void {
    this.logEntriesEl.innerHTML = '';
    this.lastTurnHeader = null;
  }

  setChatEnabled(enabled: boolean): void {
    this.chatEnabledSignal.value = enabled;
    this.chatInput.value = '';
  }

  logTurn(turn: number, player: string): void {
    if (
      this.lastTurnHeader &&
      this.lastTurnHeader === this.logEntriesEl.lastElementChild
    ) {
      this.logEntriesEl.removeChild(this.lastTurnHeader);
    }

    const text = `\u2014 Turn ${turn}: ${player} \u2014`;
    const header = el('div', {
      class: 'log-entry log-turn',
      text,
    });

    this.logEntriesEl.appendChild(header);
    this.lastTurnHeader = header;

    this.scrollToBottom();
    this.updateLatestBar(text, 'log-turn');
  }

  logText(text: string, cssClass = ''): void {
    this.logEntriesEl.appendChild(
      el('div', {
        class: `log-entry ${cssClass}`,
        text,
      }),
    );

    this.scrollToBottom();
    this.updateLatestBar(text, cssClass);
  }

  logMovementEvents(events: MovementEvent[], ships: Ship[]): void {
    for (const event of events) {
      const entry = formatMovementEventEntry(event, ships);
      if (entry) {
        this.logText(entry.text, entry.className);
      }
    }
  }

  logCombatResults(results: CombatResult[], ships: Ship[]): void {
    for (const result of results) {
      for (const entry of formatCombatResultEntries(
        result,
        ships,
        this.playerId,
      )) {
        this.logText(entry.text, entry.className);
      }
    }
  }

  logLanding(shipName: string, bodyName: string): void {
    this.logText(`${shipName} landed at ${bodyName}`, 'log-landed');
  }

  setStatusText(text: string | null): void {
    this.statusTextSignal.value = text;
  }

  private bindChatInput(): void {
    const handleChatInput = (event: KeyboardEvent) => {
      event.stopPropagation();

      if (event.key !== 'Enter') {
        return;
      }

      const text = this.chatInput.value.trim();
      if (!text) {
        return;
      }

      this.deps.onChat(text);
      this.chatInput.value = '';
    };

    this.chatInput.addEventListener('keydown', handleChatInput);
    this.scope.add(() => {
      this.chatInput.removeEventListener('keydown', handleChatInput);
    });
  }

  private bindLogControls(): void {
    const handleLatestBarClick = () => {
      this.expand();
    };
    this.logLatestBar.addEventListener('click', handleLatestBarClick);
    this.scope.add(() => {
      this.logLatestBar.removeEventListener('click', handleLatestBarClick);
    });

    const handleLogClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.chat-input')) {
        return;
      }

      this.collapse();
    };
    this.gameLogEl.addEventListener('click', handleLogClick);
    this.scope.add(() => {
      this.gameLogEl.removeEventListener('click', handleLogClick);
    });
  }

  private scrollToBottom(): void {
    this.logEntriesEl.scrollTop = this.logEntriesEl.scrollHeight;
  }

  private updateLatestBar(text: string, cssClass: string): void {
    this.lastLogTextSignal.value = text;
    this.lastLogClassSignal.value = cssClass;
  }

  private expand(): void {
    if (this.screenModeSignal.peek() !== 'hud') {
      return;
    }

    this.expandedSignal.value = true;
    this.scrollToBottom();
  }

  private collapse(): void {
    this.expandedSignal.value = false;
  }

  dispose(): void {
    this.scope.dispose();
  }
}
