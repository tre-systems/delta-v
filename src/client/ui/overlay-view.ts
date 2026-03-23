import { byId, el, hide, listen, show } from '../dom';
import { createDisposalScope } from '../reactive';
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
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
  dispose: () => void;
}

export const createOverlayView = (): OverlayView => {
  const scope = createDisposalScope();
  const gameOverEl = byId('gameOver');
  const gameOverTextEl = byId('gameOverText');
  const gameOverReasonEl = byId('gameOverReason');
  const rematchBtn = byId<HTMLButtonElement>('rematchBtn');
  const reconnectOverlayEl = byId('reconnectOverlay');
  const reconnectTextEl = byId('reconnectText');
  const reconnectAttemptEl = byId('reconnectAttempt');
  const reconnectCancelBtn = byId('reconnectCancelBtn');
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
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();

  const clearPhaseAlertTimer = () => {
    if (phaseAlertTimer === null) {
      return;
    }

    clearTimeout(phaseAlertTimer);
    phaseAlertTimer = null;
  };

  scope.add(
    listen(reconnectCancelBtn, 'click', () => {
      hide(reconnectOverlayEl);
      reconnectCancelHandler?.();
    }),
  );

  const gameOverStatsEl = byId('gameOverStats');

  const showGameOver = (
    won: boolean,
    reason: string,
    stats?: GameOverStatsLike,
  ): void => {
    const view = buildGameOverView(won, reason, stats);

    gameOverTextEl.textContent = view.titleText;
    gameOverTextEl.className = won ? 'game-over-victory' : 'game-over-defeat';
    gameOverReasonEl.textContent = view.reasonText;

    // Render stat lines
    gameOverStatsEl.innerHTML = '';
    for (const line of view.statLines) {
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

    // Entrance animation
    gameOverEl.classList.remove('game-over-enter');
    show(gameOverEl, 'flex');
    void gameOverEl.offsetWidth;
    gameOverEl.classList.add('game-over-enter');

    rematchBtn.textContent = view.rematchText;
    rematchBtn.removeAttribute('disabled');
  };

  const showRematchPending = (): void => {
    const view = buildRematchPendingView();
    rematchBtn.textContent = view.rematchText;

    if (view.rematchDisabled) {
      rematchBtn.setAttribute('disabled', 'true');
    }
  };

  const hideReconnecting = (): void => {
    reconnectCancelHandler = null;
    hide(reconnectOverlayEl);
  };

  const showReconnecting = (
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ): void => {
    const view = buildReconnectView(attempt, maxAttempts);

    reconnectCancelHandler = onCancel;
    show(reconnectOverlayEl, 'flex');
    reconnectTextEl.textContent = view.reconnectText;
    reconnectAttemptEl.textContent = view.attemptText;
  };

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'info',
  ): void => {
    const toast = el('div', {
      class: `toast toast-${type}`,
      text: message,
    });

    toastContainerEl.appendChild(toast);

    const timer = setTimeout(() => {
      toastTimers.delete(timer);
      toast.remove();
    }, 3100);

    toastTimers.add(timer);
  };

  const showPhaseAlert = (phase: string, isMyTurn: boolean): void => {
    const copy = getPhaseAlertCopy(phase, isMyTurn);

    phaseAlertTitleEl.textContent = copy.title;
    phaseAlertSubtitleEl.textContent = copy.subtitle;
    phaseAlertSubtitleEl.style.color = copy.subtitleColor;

    phaseAlertEl.classList.remove('active');
    void phaseAlertEl.offsetWidth;
    phaseAlertEl.classList.add('active');

    clearPhaseAlertTimer();
    phaseAlertTimer = setTimeout(() => {
      phaseAlertEl.classList.remove('active');
      phaseAlertTimer = null;
    }, 1200);
  };

  const dispose = (): void => {
    hideReconnecting();
    clearPhaseAlertTimer();
    for (const timer of toastTimers) {
      clearTimeout(timer);
    }

    toastTimers.clear();
    scope.dispose();
  };

  return {
    showGameOver,
    showRematchPending,
    showReconnecting,
    hideReconnecting,
    showToast,
    showPhaseAlert,
    dispose,
  };
};
