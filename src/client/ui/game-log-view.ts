import type {
  CombatResult,
  MovementEvent,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import { byId, clearHTML, el, listen, text, visible } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
} from './formatters';
import { buildScreenVisibility, type UIScreenMode } from './screens';

export interface GameLogViewDeps {
  onChat: (text: string) => void;
}

export interface GameLogView {
  setPlayerId: (id: PlayerId | -1) => void;
  setLocalGame: (isLocal: boolean) => void;
  setMobile: (
    isMobile: boolean,
    hudVisible: boolean,
    viewportWidth?: number,
  ) => void;
  setScreenMode: (mode: UIScreenMode) => void;
  toggle: () => void;
  clear: () => void;
  setChatEnabled: (enabled: boolean) => void;
  logTurn: (turn: number, player: string) => void;
  logText: (text: string, cssClass?: string) => void;
  logMovementEvents: (events: MovementEvent[], ships: Ship[]) => void;
  logCombatResults: (results: CombatResult[], ships: Ship[]) => void;
  logLanding: (shipName: string, bodyName: string) => void;
  setStatusText: (text: string | null) => void;
  dispose: () => void;
}

export const createGameLogView = (deps: GameLogViewDeps): GameLogView => {
  const scope = createDisposalScope();
  const gameLogEl = byId('gameLog');
  const logEntriesEl = byId('logEntries');
  const chatInputRow = byId('chatInputRow');
  const chatInput = byId<HTMLInputElement>('chatInput');
  const chatSendBtn = byId('chatSendBtn');
  const logLatestBar = byId('logLatestBar');
  const logLatestText = byId('logLatestText');
  const logStatusText = el('span', {
    class: 'log-status-text',
  });
  const logStatusBar = el('div', {
    class: 'log-status-bar',
  });

  let lastTurnHeader: HTMLElement | null = null;
  let playerId: PlayerId | -1 = -1;
  let localGame = false;

  const screenModeSignal = signal<UIScreenMode>('hidden');
  const expandedSignal = signal(false);
  const chatEnabledSignal = signal(false);
  const lastLogTextSignal = signal('');
  const lastLogClassSignal = signal('');
  const statusTextSignal = signal<string | null>(null);
  const mobileSignal = signal(false);
  const viewportWidthSignal = signal(window.innerWidth);

  logStatusBar.style.display = 'none';
  logStatusBar.setAttribute('role', 'status');
  logStatusBar.setAttribute('aria-live', 'polite');
  logStatusBar.setAttribute('aria-atomic', 'true');
  logStatusBar.appendChild(logStatusText);
  gameLogEl.insertBefore(logStatusBar, gameLogEl.firstChild);

  const scrollToBottom = (): void => {
    logEntriesEl.scrollTop = logEntriesEl.scrollHeight;
  };

  const updateLatestBar = (text: string, cssClass: string): void => {
    lastLogTextSignal.value = text;
    lastLogClassSignal.value = cssClass;
  };

  const collapse = (): void => {
    expandedSignal.value = false;
  };

  const expand = (): void => {
    if (screenModeSignal.peek() !== 'hud') {
      return;
    }

    expandedSignal.value = true;
    scrollToBottom();
  };

  const setPlayerId = (id: PlayerId | -1): void => {
    playerId = id;
  };

  const shouldAutoExpand = (
    viewportWidth = viewportWidthSignal.peek(),
  ): boolean => !localGame && viewportWidth >= 640;

  const setMobile = (
    isMobile: boolean,
    hudVisible: boolean,
    viewportWidth = window.innerWidth,
  ): void => {
    mobileSignal.value = isMobile;
    viewportWidthSignal.value = viewportWidth;

    if (hudVisible) {
      expandedSignal.value = shouldAutoExpand(viewportWidth);
    }
  };

  const setScreenMode = (mode: UIScreenMode): void => {
    const previousMode = screenModeSignal.peek();

    screenModeSignal.value = mode;

    if (mode !== 'hud') {
      expandedSignal.value = false;
      return;
    }

    if (previousMode !== 'hud') {
      expandedSignal.value = shouldAutoExpand();
    }
  };

  const setLocalGame = (isLocal: boolean): void => {
    localGame = isLocal;
  };

  const toggle = (): void => {
    if (screenModeSignal.peek() !== 'hud') {
      return;
    }

    if (expandedSignal.peek()) {
      collapse();
    } else {
      expand();
    }
  };

  const clear = (): void => {
    clearHTML(logEntriesEl);
    lastTurnHeader = null;
  };

  const setChatEnabled = (enabled: boolean): void => {
    chatEnabledSignal.value = enabled;
    chatInput.value = '';
  };

  const logTurn = (turn: number, player: string): void => {
    if (lastTurnHeader && lastTurnHeader === logEntriesEl.lastElementChild) {
      logEntriesEl.removeChild(lastTurnHeader);
    }

    const text = `\u2014 Turn ${turn}: ${player} \u2014`;
    const header = el('div', {
      class: 'log-entry log-turn',
      text,
    });

    logEntriesEl.appendChild(header);
    lastTurnHeader = header;

    scrollToBottom();
    updateLatestBar(text, 'log-turn');
  };

  const logText = (text: string, cssClass = ''): void => {
    logEntriesEl.appendChild(
      el('div', {
        class: `log-entry ${cssClass}`,
        text,
      }),
    );

    scrollToBottom();
    updateLatestBar(text, cssClass);
  };

  const logMovementEvents = (events: MovementEvent[], ships: Ship[]): void => {
    for (const event of events) {
      const entry = formatMovementEventEntry(event, ships);

      if (entry) {
        logText(entry.text, entry.className);
      }
    }
  };

  const logCombatResults = (results: CombatResult[], ships: Ship[]): void => {
    for (const result of results) {
      for (const entry of formatCombatResultEntries(
        result,
        ships,
        playerId as PlayerId,
      )) {
        logText(entry.text, entry.className);
      }
    }
  };

  const logLanding = (shipName: string, bodyName: string): void => {
    logText(`${shipName} landed at ${bodyName}`, 'log-landed');
  };

  const setStatusText = (text: string | null): void => {
    statusTextSignal.value = text;
  };

  const dispose = (): void => {
    scope.dispose();
  };

  withScope(scope, () => {
    const submitChat = () => {
      const text = chatInput.value.trim();

      if (!text) return;

      deps.onChat(text);
      chatInput.value = '';
    };

    listen(chatInput, 'keydown', (event) => {
      event.stopPropagation();
      const ke = event as KeyboardEvent;

      if (ke.key !== 'Enter') return;

      submitChat();
    });

    listen(chatSendBtn, 'click', (event) => {
      event.stopPropagation();
      submitChat();
      chatInput.focus();
    });

    logLatestBar.setAttribute('role', 'button');
    logLatestBar.tabIndex = 0;
    logLatestBar.setAttribute('aria-label', 'Expand game log');

    listen(logLatestBar, 'click', () => {
      expand();
    });
    listen(logLatestBar, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        expand();
      }
    });

    listen(gameLogEl, 'click', (event) => {
      if ((event.target as HTMLElement).closest('.chat-input')) {
        return;
      }
      collapse();
    });

    const latestBarCopySignal = computed(() => {
      const statusText = statusTextSignal.value;
      const lastLogText = lastLogTextSignal.value;
      const lastLogClass = lastLogClassSignal.value;

      return {
        text: statusText ?? lastLogText,
        cssClass: statusText ? 'log-status' : lastLogClass,
      };
    });

    const visibilitySignal = computed(() => {
      const mode = screenModeSignal.value;

      if (mode === 'hud') {
        const expanded = expandedSignal.value;

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
    });

    effect(() => {
      const copy = latestBarCopySignal.value;
      text(logLatestText, copy.text);
      logLatestText.className = `log-latest-text ${copy.cssClass}`;
    });

    effect(() => {
      const v = visibilitySignal.value;
      visible(gameLogEl, v.gameLog !== 'none', v.gameLog);
      visible(logLatestBar, v.latestBar !== 'none', v.latestBar);
    });

    effect(() => {
      const isMobileExpanded =
        screenModeSignal.value === 'hud' &&
        expandedSignal.value &&
        mobileSignal.value &&
        viewportWidthSignal.value < 640;

      gameLogEl.classList.toggle('mobile-expanded', isMobileExpanded);
    });

    effect(() => {
      const status = statusTextSignal.value;
      visible(logStatusBar, !!status);
      text(logStatusText, status ?? '');
    });

    visible(chatInputRow, chatEnabledSignal);
  });

  return {
    setPlayerId,
    setLocalGame,
    setMobile,
    setScreenMode,
    toggle,
    clear,
    setChatEnabled,
    logTurn,
    logText,
    logMovementEvents,
    logCombatResults,
    logLanding,
    setStatusText,
    dispose,
  };
};
