import { byId, clearHTML, el, listen, text, visible } from '../dom';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import { getPhaseAlertCopy } from './formatters';
import type { OverlayStateStore } from './overlay-state';

export interface OverlayView {
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
  dispose: () => void;
}

export const createOverlayView = (
  state: Pick<
    OverlayStateStore,
    | 'gameOverViewSignal'
    | 'replayControlsSignal'
    | 'reconnectViewSignal'
    | 'opponentDisconnectDeadlineSignal'
    | 'cancelReconnect'
    | 'hideOpponentDisconnected'
  >,
): OverlayView => {
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
  const replayBarEl = byId('replayBar');
  const replayBarStatusEl = byId('replayBarStatus');
  const replayBarStartBtn = byId<HTMLButtonElement>('replayBarStartBtn');
  const replayBarPrevBtn = byId<HTMLButtonElement>('replayBarPrevBtn');
  const replayBarNextBtn = byId<HTMLButtonElement>('replayBarNextBtn');
  const replayBarEndBtn = byId<HTMLButtonElement>('replayBarEndBtn');
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

  let phaseAlertTimer: ReturnType<typeof setTimeout> | null = null;
  let opponentDisconnectTimer: ReturnType<typeof setInterval> | null = null;
  let gameOverWasVisible = false;
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();
  let nextToastId = 0;

  const phaseAlertViewSignal = signal({
    active: false,
    title: '',
    subtitle: '',
    subtitleColor: '',
  });
  const opponentDisconnectViewSignal = signal({
    visible: false,
    countdownText: '',
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

  const clearOpponentDisconnectTimer = () => {
    if (opponentDisconnectTimer === null) {
      return;
    }

    clearInterval(opponentDisconnectTimer);
    opponentDisconnectTimer = null;
  };

  const gameOverStatsEl = byId('gameOverStats');

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
    clearOpponentDisconnectTimer();
    clearPhaseAlertTimer();
    for (const timer of toastTimers) {
      clearTimeout(timer);
    }

    toastTimers.clear();
    scope.dispose();
    reconnectOverlayEl.style.display = 'none';
    opponentDisconnectEl.style.display = 'none';
  };

  withScope(scope, () => {
    visible(
      gameOverEl,
      {
        get value() {
          return state.gameOverViewSignal.value.visible;
        },
        peek: () => state.gameOverViewSignal.peek().visible,
      },
      'flex',
    );

    effect(() => {
      const gameOverView = state.gameOverViewSignal.value;

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

      if (gameOverView.visible && !gameOverWasVisible) {
        gameOverEl.classList.remove('game-over-enter');
        gameOverEl.style.display = 'flex';
        void gameOverEl.offsetWidth;
        gameOverEl.classList.add('game-over-enter');
      } else if (!gameOverView.visible) {
        gameOverEl.classList.remove('game-over-enter');
      }

      gameOverWasVisible = gameOverView.visible;
    });

    effect(() => {
      const replayView = state.replayControlsSignal.value;

      visible(replayControlsEl, replayView.available);
      visible(replayStatusEl, replayView.available);

      // When replay is active, hide the game-over overlay and show the
      // compact bottom bar so the battlefield is fully visible.
      if (replayView.active) {
        gameOverEl.style.display = 'none';
        replayBarEl.style.display = 'flex';
        text(replayBarStatusEl, replayView.statusText);
        replayBarStartBtn.disabled = !replayView.canStart;
        replayBarPrevBtn.disabled = !replayView.canPrev;
        replayBarNextBtn.disabled = !replayView.canNext;
        replayBarEndBtn.disabled = !replayView.canEnd;
      } else {
        replayBarEl.style.display = 'none';
      }

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
      const reconnectView = state.reconnectViewSignal.value;

      visible(reconnectOverlayEl, reconnectView.visible, 'flex');
      text(reconnectTextEl, reconnectView.reconnectText);
      text(reconnectAttemptEl, reconnectView.attemptText);
    });

    effect(() => {
      const graceDeadlineMs = state.opponentDisconnectDeadlineSignal.value;

      clearOpponentDisconnectTimer();

      if (graceDeadlineMs === null) {
        opponentDisconnectViewSignal.value = {
          visible: false,
          countdownText: '',
        };
        return;
      }

      const updateCountdown = () => {
        const remaining = Math.max(
          0,
          Math.ceil((graceDeadlineMs - Date.now()) / 1000),
        );
        opponentDisconnectViewSignal.value = {
          visible: true,
          countdownText: `Opponent disconnected. Game ends in ${remaining}s...`,
        };

        if (remaining <= 0) {
          state.hideOpponentDisconnected();
        }
      };

      updateCountdown();
      opponentDisconnectTimer = setInterval(updateCountdown, 1000);
    });

    effect(() => {
      const view = opponentDisconnectViewSignal.value;

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
        const toastEl = el('div', {
          class: `toast toast-${toast.type}`,
          text: toast.message,
        });
        toastEl.setAttribute(
          'role',
          toast.type === 'error' ? 'alert' : 'status',
        );
        toastEl.setAttribute(
          'aria-live',
          toast.type === 'error' ? 'assertive' : 'polite',
        );
        toastEl.setAttribute('aria-atomic', 'true');
        toastContainerEl.appendChild(toastEl);
      }
    });

    listen(reconnectCancelBtn, 'click', () => {
      state.cancelReconnect();
    });
  });

  return {
    showToast,
    showPhaseAlert,
    dispose,
  };
};
