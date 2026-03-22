import type {
  CombatResult,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import { byId, el } from '../dom';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
} from './formatters';
import { buildScreenVisibility, type UIScreenMode } from './screens';

export interface GameLogViewDeps {
  onChat: (text: string) => void;
}

export class GameLogView {
  private readonly gameLogEl = byId('gameLog');
  private readonly logEntriesEl = byId('logEntries');
  private readonly chatInputRow = byId('chatInputRow');
  private readonly chatInput = byId<HTMLInputElement>('chatInput');
  private readonly logLatestBar = byId('logLatestBar');
  private readonly logLatestText = byId('logLatestText');

  private lastTurnHeader: HTMLElement | null = null;
  private playerId = -1;
  private expanded = false;
  private lastLogText = '';
  private lastLogClass = '';
  private statusText: string | null = null;

  constructor(private readonly deps: GameLogViewDeps) {
    this.bindChatInput();
    this.bindLogControls();
  }

  setPlayerId(id: number): void {
    this.playerId = id;
  }

  setMobile(_isMobile: boolean, hudVisible: boolean): void {
    if (hudVisible) {
      this.collapse();
    }
  }

  applyScreenVisibility(mode: UIScreenMode): void {
    const visibility = buildScreenVisibility(mode);

    this.gameLogEl.style.display = visibility.gameLog;
  }

  resetVisibilityState(): void {
    this.logLatestBar.style.display = 'none';
    this.expanded = false;
  }

  showHUD(): void {
    this.collapse();
  }

  toggle(): void {
    if (this.expanded) {
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
    this.chatInputRow.style.display = enabled ? '' : 'none';
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
    this.statusText = text;
    this.syncLatestBar();
  }

  private bindChatInput(): void {
    this.chatInput.addEventListener('keydown', (event) => {
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
    });
  }

  private bindLogControls(): void {
    this.logLatestBar.addEventListener('click', () => {
      this.expand();
    });

    this.gameLogEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.chat-input')) {
        return;
      }

      this.collapse();
    });
  }

  private scrollToBottom(): void {
    this.logEntriesEl.scrollTop = this.logEntriesEl.scrollHeight;
  }

  private updateLatestBar(text: string, cssClass: string): void {
    this.lastLogText = text;
    this.lastLogClass = cssClass;
    this.syncLatestBar();
  }

  private syncLatestBar(): void {
    const text = this.statusText ?? this.lastLogText;
    const cssClass = this.statusText ? 'log-status' : this.lastLogClass;

    this.logLatestText.textContent = text;
    this.logLatestText.className = `log-latest-text ${cssClass}`;
  }

  private expand(): void {
    this.expanded = true;
    this.gameLogEl.style.display = 'flex';
    this.logLatestBar.style.display = 'none';
    this.scrollToBottom();
  }

  private collapse(): void {
    this.expanded = false;
    this.gameLogEl.style.display = 'none';
    this.logLatestBar.style.display = 'block';
  }
}
