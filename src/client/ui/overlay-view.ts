import { byId, el, listen, text, visible } from '../dom';
import { createDisposalScope, withScope } from '../reactive';
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
    visible(replayControlsEl, view.available);
    visible(replayStatusEl, view.available);

    if (!view.available) {
      return;
    }

    visible(replayNavEl, view.active);
    text(replayStatusEl, view.statusText);
    text(replayMatchLabelEl, view.selectedGameId);

    text(
      replayToggleBtn,
      view.loading
        ? 'Loading Replay...'
        : view.active
          ? 'Exit Replay'
          : 'View Replay',
    );
    replayMatchPrevBtn.disabled =
      view.loading || view.active || !view.canSelectPrevMatch;
    replayMatchNextBtn.disabled =
      view.loading || view.active || !view.canSelectNextMatch;
    replayToggleBtn.disabled = view.loading;
    replayStartBtn.disabled = !view.canStart;
    replayPrevBtn.disabled = !view.canPrev;
    replayNextBtn.disabled = !view.canNext;
    replayEndBtn.disabled = !view.canEnd;
  };

  const showGameOver = (
    won: boolean,
    reason: string,
    stats?: GameOverStatsLike,
  ): void => {
    const view = buildGameOverView(won, reason, stats);

    text(gameOverTextEl, view.titleText);
    gameOverTextEl.className = won ? 'game-over-victory' : 'game-over-defeat';
    text(gameOverReasonEl, view.reasonText);

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
    visible(gameOverEl, true, 'flex');
    void gameOverEl.offsetWidth;
    gameOverEl.classList.add('game-over-enter');

    text(rematchBtn, view.rematchText);
    rematchBtn.removeAttribute('disabled');
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
    text(rematchBtn, view.rematchText);

    if (view.rematchDisabled) {
      rematchBtn.setAttribute('disabled', 'true');
    }
  };

  const hideReconnecting = (): void => {
    reconnectCancelHandler = null;
    visible(reconnectOverlayEl, false);
  };

  const showReconnecting = (
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ): void => {
    const view = buildReconnectView(attempt, maxAttempts);

    reconnectCancelHandler = onCancel;
    visible(reconnectOverlayEl, true, 'flex');
    text(reconnectTextEl, view.reconnectText);
    text(reconnectAttemptEl, view.attemptText);
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

    text(phaseAlertTitleEl, copy.title);
    text(phaseAlertSubtitleEl, copy.subtitle);
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

  withScope(scope, () => {
    listen(reconnectCancelBtn, 'click', () => {
      visible(reconnectOverlayEl, false);
      reconnectCancelHandler?.();
    });
  });

  return {
    showGameOver,
    showRematchPending,
    showReconnecting,
    hideReconnecting,
    showToast,
    showPhaseAlert,
    setReplayControls,
    dispose,
  };
};
