import type { CombatResult, MovementEvent, Ship } from '../../shared/types';
import { byId, el } from '../dom';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
} from './formatters';
import {
  buildScreenVisibility,
  toggleLogVisible,
  type UIScreenMode,
} from './screens';

export interface GameLogViewDeps {
  onChat: (text: string) => void;
}

export class GameLogView {
  private readonly gameLogEl = byId('gameLog');
  private readonly logEntriesEl = byId('logEntries');
  private readonly chatInputRow = byId('chatInputRow');
  private readonly chatInput = byId<HTMLInputElement>('chatInput');
  private readonly logShowBtn = byId('logShowBtn');
  private readonly logLatestBar = byId('logLatestBar');
  private readonly logLatestText = byId('logLatestText');
  private readonly logToggleBtn = byId('logToggleBtn');

  private lastTurnHeader: HTMLElement | null = null;
  private playerId = -1;
  private isMobile = false;
  private logVisible = true;
  private logExpandedOnMobile = false;

  constructor(private readonly deps: GameLogViewDeps) {
    this.bindChatInput();
    this.bindLogControls();
  }

  setPlayerId(id: number): void {
    this.playerId = id;
  }

  setMobile(isMobile: boolean, hudVisible: boolean): void {
    this.isMobile = isMobile;
    this.syncVisibility(hudVisible);
  }

  applyScreenVisibility(mode: UIScreenMode): void {
    const visibility = buildScreenVisibility(mode, this.logVisible);

    this.gameLogEl.style.display = visibility.gameLog;
    this.logShowBtn.style.display = visibility.logShowBtn;
  }

  resetVisibilityState(): void {
    this.logLatestBar.style.display = 'none';
    this.logExpandedOnMobile = false;
    this.gameLogEl.classList.remove('mobile-expanded');
  }

  showHUD(): void {
    this.applyScreenVisibility('hud');

    if (!this.isMobile) {
      return;
    }

    this.gameLogEl.classList.remove('mobile-expanded');
    this.gameLogEl.style.display = 'none';
    this.logShowBtn.style.display = 'none';
    this.logLatestBar.style.display = 'block';
    this.logExpandedOnMobile = false;
  }

  toggle(): void {
    if (this.isMobile) {
      if (this.logExpandedOnMobile) {
        this.collapseMobileLog();
      } else {
        this.expandMobileLog();
      }

      return;
    }

    this.logVisible = toggleLogVisible(this.logVisible);
    this.applyScreenVisibility('hud');
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
      this.expandMobileLog();
    });

    this.logToggleBtn.addEventListener('click', () => {
      if (this.isMobile) {
        this.collapseMobileLog();

        return;
      }

      this.logVisible = false;
      this.applyScreenVisibility('hud');
    });

    this.logShowBtn.addEventListener('click', () => {
      this.logVisible = true;
      this.applyScreenVisibility('hud');
    });
  }

  private scrollToBottom(): void {
    this.logEntriesEl.scrollTop = this.logEntriesEl.scrollHeight;
  }

  private updateLatestBar(text: string, cssClass: string): void {
    if (!this.isMobile) {
      return;
    }

    this.logLatestText.textContent = text;
    this.logLatestText.className = `log-latest-text ${cssClass}`;
  }

  private expandMobileLog(): void {
    this.logExpandedOnMobile = true;
    this.gameLogEl.classList.add('mobile-expanded');
    this.gameLogEl.style.display = 'flex';
    this.logLatestBar.style.display = 'none';
    this.scrollToBottom();
  }

  private collapseMobileLog(): void {
    this.logExpandedOnMobile = false;
    this.gameLogEl.classList.remove('mobile-expanded');
    this.gameLogEl.style.display = 'none';
    this.logLatestBar.style.display = 'block';
  }

  private syncVisibility(hudVisible: boolean): void {
    if (!hudVisible) {
      return;
    }

    if (this.isMobile) {
      this.gameLogEl.classList.remove('mobile-expanded');
      this.gameLogEl.style.display = 'none';
      this.logShowBtn.style.display = 'none';
      this.logLatestBar.style.display = 'block';
      this.logExpandedOnMobile = false;
      return;
    }

    this.gameLogEl.classList.remove('mobile-expanded');
    this.logLatestBar.style.display = 'none';
    this.logExpandedOnMobile = false;
    this.applyScreenVisibility('hud');
  }
}
