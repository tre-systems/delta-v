import { byId, clearHTML, el, listen, text, visible } from '../dom';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import { getPhaseAlertCopy } from './formatters';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  type GameOverStatsLike,
} from './screens';

export interface OverlayView {
  showGameOver: (
    won: boolean,
    reason: string,
    stats?: GameOverStatsLike,
  ) => void;
  showRematchPending: () => void;
  showReconnecting: (
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ) => void;
  hideReconnecting: () => void;
  showOpponentDisconnected: (graceDeadlineMs: number) => void;
  hideOpponentDisconnected: () => void;
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
  setReplayControls: (view: {
    available: boolean;
    active: boolean;
    loading: boolean;
    statusText: string;
    selectedGameId: string;
    canSelectPrevMatch: boolean;
    canSelectNextMatch: boolean;
    canStart: boolean;
    canPrev: boolean;
    canNext: boolean;
    canEnd: boolean;
  }) => void;
  dispose: () => void;
}

export const createOverlayView = (): OverlayView => {
  const scope = createDisposalScope();
  const gameOverEl = byId('gameOver');
  const gameOverTextEl = byId('gameOverText');
  const gameOverReasonEl = byId('gameOverReason');
  const rematchBtn = byId<HTMLButtonElement>('rematchBtn');
  const replayStatusEl = byId('replayStatus');
  const replayControlsEl = byId('replayControls');
  const replayMatchLabelEl = byId('replayMatchLabel');
  const replayMatchPrevBtn = byId<HTMLButtonElement>('replayMatchPrevBtn');
  const replayMatchNextBtn = byId<HTMLButtonElement>('replayMatchNextBtn');
  const replayToggleBtn = byId<HTMLButtonElement>('replayToggleBtn');
  const replayNavEl = byId('replayNav');
  const replayStartBtn = byId<HTMLButtonElement>('replayStartBtn');
  const replayPrevBtn = byId<HTMLButtonElement>('replayPrevBtn');
  const replayNextBtn = byId<HTMLButtonElement>('replayNextBtn');
  const replayEndBtn = byId<HTMLButtonElement>('replayEndBtn');
  const reconnectOverlayEl = byId('reconnectOverlay');
  const reconnectTextEl = byId('reconnectText');
  const reconnectAttemptEl = byId('reconnectAttempt');
  const reconnectCancelBtn = byId('reconnectCancelBtn');
  const opponentDisconnectEl = byId('opponentDisconnectOverlay');
  const opponentDisconnectTextEl = byId('opponentDisconnectText');
  const toastContainerEl = byId('toastContainer');
  const phaseAlertEl = byId('phaseAlert');
  const phaseAlertTitleEl = phaseAlertEl.querySelector(
    '.phase-alert-title',
  ) as HTMLElement;
  const phaseAlertSubtitleEl = phaseAlertEl.querySelector(
    '.phase-alert-subtitle',
  ) as HTMLElement;

  let reconnectCancelHandler: (() => void) | null = null;
  let phaseAlertTimer: ReturnType<typeof setTimeout> | null = null;
  let opponentDisconnectTimer: ReturnType<typeof setInterval> | null = null;
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();
  let nextToastId = 0;

  const gameOverViewSignal = signal({
    visible: false,
    titleText: '',
    titleClass: '',
    reasonText: '',
    statLines: [] as GameOverStatsLike extends infer _
      ? Array<{
          label: string;
          value: string;
        }>
      : never,
    rematchText: 'Rematch',
    rematchDisabled: false,
  });
  const replayControlsSignal = signal({
    available: false,
    active: false,
    loading: false,
    statusText: '',
    selectedGameId: '',
    canSelectPrevMatch: false,
    canSelectNextMatch: false,
    canStart: false,
    canPrev: false,
    canNext: false,
    canEnd: false,
  });
  const reconnectViewSignal = signal({
    visible: false,
    reconnectText: '',
    attemptText: '',
  });
  const opponentDisconnectSignal = signal({
    visible: false,
    countdownText: '',
  });
  const phaseAlertViewSignal = signal({
    active: false,
    title: '',
    subtitle: '',
    subtitleColor: '',
  });
  const toastsSignal = signal(
    [] as Array<{
      id: number;
      message: string;
      type: 'error' | 'info' | 'success';
    }>,
  );

  const clearPhaseAlertTimer = () => {
    if (phaseAlertTimer === null) {
      return;
    }

    clearTimeout(phaseAlertTimer);
    phaseAlertTimer = null;
  };

  const gameOverStatsEl = byId('gameOverStats');

  const setReplayControls = (view: {
    available: boolean;
    active: boolean;
    loading: boolean;
    statusText: string;
    selectedGameId: string;
    canSelectPrevMatch: boolean;
    canSelectNextMatch: boolean;
    canStart: boolean;
    canPrev: boolean;
    canNext: boolean;
    canEnd: boolean;
  }): void => {
    replayControlsSignal.value = view;
  };

  const showGameOver = (
    won: boolean,
    reason: string,
    stats?: GameOverStatsLike,
  ): void => {
    const view = buildGameOverView(won, reason, stats);

    gameOverViewSignal.value = {
      visible: true,
      titleText: view.titleText,
      titleClass: won ? 'game-over-victory' : 'game-over-defeat',
      reasonText: view.reasonText,
      statLines: view.statLines,
      rematchText: view.rematchText,
      rematchDisabled: false,
    };

    gameOverEl.classList.remove('game-over-enter');
    gameOverEl.style.display = 'flex';
    void gameOverEl.offsetWidth;
    gameOverEl.classList.add('game-over-enter');
    setReplayControls({
      available: false,
      active: false,
      loading: false,
      statusText: '',
      selectedGameId: '',
      canSelectPrevMatch: false,
      canSelectNextMatch: false,
      canStart: false,
      canPrev: false,
      canNext: false,
      canEnd: false,
    });
  };

  const showRematchPending = (): void => {
    const view = buildRematchPendingView();
    gameOverViewSignal.update((current) => ({
      ...current,
      rematchText: view.rematchText,
      rematchDisabled: view.rematchDisabled,
    }));
  };

  const hideReconnecting = (): void => {
    reconnectCancelHandler = null;
    reconnectViewSignal.value = {
      visible: false,
      reconnectText: '',
      attemptText: '',
    };
  };

  const hideOpponentDisconnected = (): void => {
    if (opponentDisconnectTimer !== null) {
      clearInterval(opponentDisconnectTimer);
      opponentDisconnectTimer = null;
    }
    opponentDisconnectSignal.value = { visible: false, countdownText: '' };
  };

  const showOpponentDisconnected = (graceDeadlineMs: number): void => {
    hideOpponentDisconnected();
    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((graceDeadlineMs - Date.now()) / 1000),
      );
      opponentDisconnectSignal.value = {
        visible: true,
        countdownText: `Opponent disconnected. Game ends in ${remaining}s...`,
      };
      if (remaining <= 0) {
        hideOpponentDisconnected();
      }
    };
    updateCountdown();
    opponentDisconnectTimer = setInterval(updateCountdown, 1000);
  };

  const showReconnecting = (
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ): void => {
    const view = buildReconnectView(attempt, maxAttempts);

    reconnectCancelHandler = onCancel;
    reconnectViewSignal.value = {
      visible: true,
      reconnectText: view.reconnectText,
      attemptText: view.attemptText,
    };
  };

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'info',
  ): void => {
    const id = nextToastId++;
    toastsSignal.update((toasts) => [...toasts, { id, message, type }]);

    const timer = setTimeout(() => {
      toastTimers.delete(timer);
      toastsSignal.update((toasts) =>
        toasts.filter((toast) => toast.id !== id),
      );
    }, 3100);

    toastTimers.add(timer);
  };

  const showPhaseAlert = (phase: string, isMyTurn: boolean): void => {
    const copy = getPhaseAlertCopy(phase, isMyTurn);

    phaseAlertEl.classList.remove('active');
    void phaseAlertEl.offsetWidth;
    phaseAlertViewSignal.value = {
      active: true,
      title: copy.title,
      subtitle: copy.subtitle,
      subtitleColor: copy.subtitleColor,
    };
    phaseAlertEl.classList.add('active');

    clearPhaseAlertTimer();
    phaseAlertTimer = setTimeout(() => {
      phaseAlertViewSignal.update((current) => ({
        ...current,
        active: false,
      }));
      phaseAlertTimer = null;
    }, 1200);
  };

  const dispose = (): void => {
    hideReconnecting();
    hideOpponentDisconnected();
    clearPhaseAlertTimer();
    for (const timer of toastTimers) {
      clearTimeout(timer);
    }

    toastTimers.clear();
    scope.dispose();
  };

  withScope(scope, () => {
    visible(
      gameOverEl,
      {
        get value() {
          return gameOverViewSignal.value.visible;
        },
        peek: () => gameOverViewSignal.peek().visible,
      },
      'flex',
    );

    effect(() => {
      const gameOverView = gameOverViewSignal.value;

      text(gameOverTextEl, gameOverView.titleText);
      gameOverTextEl.className = gameOverView.titleClass;
      text(gameOverReasonEl, gameOverView.reasonText);
      text(rematchBtn, gameOverView.rematchText);
      rematchBtn.disabled = gameOverView.rematchDisabled;

      clearHTML(gameOverStatsEl);
      for (const line of gameOverView.statLines) {
        const row = el('div', { class: 'stat-row' });
        row.appendChild(
          el('span', {
            class: 'stat-label',
            text: line.label,
          }),
        );
        row.appendChild(
          el('span', {
            class: 'stat-value',
            text: line.value,
          }),
        );
        gameOverStatsEl.appendChild(row);
      }
    });

    effect(() => {
      const replayView = replayControlsSignal.value;

      visible(replayControlsEl, replayView.available);
      visible(replayStatusEl, replayView.available);

      if (!replayView.available) {
        return;
      }

      visible(replayNavEl, replayView.active);
      text(replayStatusEl, replayView.statusText);
      text(replayMatchLabelEl, replayView.selectedGameId);
      text(
        replayToggleBtn,
        replayView.loading
          ? 'Loading Replay...'
          : replayView.active
            ? 'Exit Replay'
            : 'View Replay',
      );
      replayMatchPrevBtn.disabled =
        replayView.loading ||
        replayView.active ||
        !replayView.canSelectPrevMatch;
      replayMatchNextBtn.disabled =
        replayView.loading ||
        replayView.active ||
        !replayView.canSelectNextMatch;
      replayToggleBtn.disabled = replayView.loading;
      replayStartBtn.disabled = !replayView.canStart;
      replayPrevBtn.disabled = !replayView.canPrev;
      replayNextBtn.disabled = !replayView.canNext;
      replayEndBtn.disabled = !replayView.canEnd;
    });

    effect(() => {
      const reconnectView = reconnectViewSignal.value;

      visible(reconnectOverlayEl, reconnectView.visible, 'flex');
      text(reconnectTextEl, reconnectView.reconnectText);
      text(reconnectAttemptEl, reconnectView.attemptText);
    });

    effect(() => {
      const view = opponentDisconnectSignal.value;

      visible(opponentDisconnectEl, view.visible, 'flex');
      text(opponentDisconnectTextEl, view.countdownText);
    });

    effect(() => {
      const phaseAlertView = phaseAlertViewSignal.value;

      text(phaseAlertTitleEl, phaseAlertView.title);
      text(phaseAlertSubtitleEl, phaseAlertView.subtitle);
      phaseAlertSubtitleEl.style.color = phaseAlertView.subtitleColor;
      phaseAlertEl.classList.toggle('active', phaseAlertView.active);
    });

    effect(() => {
      const toasts = toastsSignal.value;

      clearHTML(toastContainerEl);
      for (const toast of toasts) {
        toastContainerEl.appendChild(
          el('div', {
            class: `toast toast-${toast.type}`,
            text: toast.message,
          }),
        );
      }
    });

    listen(reconnectCancelBtn, 'click', () => {
      const onCancel = reconnectCancelHandler;
      hideReconnecting();
      onCancel?.();
    });
  });

  return {
    showGameOver,
    showRematchPending,
    showReconnecting,
    hideReconnecting,
    showOpponentDisconnected,
    hideOpponentDisconnected,
    showToast,
    showPhaseAlert,
    setReplayControls,
    dispose,
  };
};
