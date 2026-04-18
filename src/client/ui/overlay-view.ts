import { byId, clearHTML, el, hide, listen, show, text, visible } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import {
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';
import { getPhaseAlertCopy } from './formatters';
import type { OverlayStateStore } from './overlay-state';

/**
 * Short-lived feedback routing (avoid stacking the same message twice):
 *
 * - Phase changes → `showPhaseAlert` only (brief banner).
 * - Outcomes, connection, session hints → `showToast`.
 * - Turn instructions → HUD / chrome; do not duplicate as a toast unless it
 *   is also an error the player must acknowledge.
 * - Narrative / history → game log, not toasts.
 */
export interface OverlayView {
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
  dispose: () => void;
}

const renderGameOverStats = (
  container: HTMLElement,
  summaryItems: ReadonlyArray<{
    label: string;
    value: string;
    tone: string;
  }>,
  shipGroups: ReadonlyArray<{
    title: string;
    items: ReadonlyArray<{
      name: string;
      outcomeText: string;
      detailText: string | null;
      tone: string;
    }>;
  }>,
): void => {
  clearHTML(container);

  if (summaryItems.length > 0) {
    const scoreboard = el('div', { class: 'game-over-scoreboard' });

    for (const item of summaryItems) {
      scoreboard.appendChild(
        el(
          'div',
          { class: 'go-stat-pill' },
          el('span', { class: 'go-stat-label', text: item.label }),
          el('span', { class: 'go-stat-value', text: item.value }),
        ),
      );
    }

    container.appendChild(scoreboard);
  }

  if (shipGroups.length > 0) {
    const groupsWrap = el('div', { class: 'game-over-ship-groups' });

    for (const group of shipGroups) {
      const groupEl = el(
        'section',
        { class: 'game-over-ship-group overlay-section-panel' },
        el('h3', {
          class: 'game-over-ship-group-title',
          text: group.title,
        }),
      );

      const grid = el('div', { class: 'fate-card-grid' });

      for (const item of group.items) {
        const body = el(
          'div',
          { class: 'fate-card-body' },
          el('span', { class: 'fate-card-name', text: item.name }),
        );

        if (item.detailText) {
          body.appendChild(
            el('span', { class: 'fate-card-detail', text: item.detailText }),
          );
        }

        const card = el('div', { class: 'fate-card' });
        card.dataset.tone = item.tone;
        card.appendChild(el('div', { class: 'fate-card-bar' }));
        card.appendChild(body);
        card.appendChild(
          el('span', {
            class: 'fate-card-status',
            text: item.outcomeText,
          }),
        );
        grid.appendChild(card);
      }

      groupEl.appendChild(grid);
      groupsWrap.appendChild(groupEl);
    }

    container.appendChild(groupsWrap);
  }
};

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
  const replayControlsEnabled = isClientFeatureEnabled('replayControls');
  const scope = createDisposalScope();
  const gameOverEl = byId('gameOver');
  const gameOverKickerEl = byId('gameOverKicker');
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
  const replayBarPlayBtn = byId<HTMLButtonElement>('replayBarPlayBtn');
  const replayPlayIcon = byId('replayPlayIcon');
  const replayPauseIcon = byId('replayPauseIcon');
  const replayBarNextBtn = byId<HTMLButtonElement>('replayBarNextBtn');
  const replayBarEndBtn = byId<HTMLButtonElement>('replayBarEndBtn');
  const reconnectOverlayEl = byId('reconnectOverlay');
  const reconnectTextEl = byId('reconnectText');
  const reconnectReassureEl = document.getElementById(
    'reconnectReassure',
  ) as HTMLElement | null;
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
  let gameOverShellWasVisible = false;
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
  type ToastRow = {
    id: number;
    message: string;
    type: 'error' | 'info' | 'success';
  };

  type AutoDismissEntry =
    | { kind: 'armed'; timerId: ReturnType<typeof setTimeout>; endTime: number }
    | { kind: 'paused'; remainingMs: number };

  const toastsSignal = signal([] as ToastRow[]);
  const autoDismissByToastId = new Map<number, AutoDismissEntry>();

  const removeToastById = (id: number): void => {
    const entry = autoDismissByToastId.get(id);
    if (entry?.kind === 'armed') {
      clearTimeout(entry.timerId);
      toastTimers.delete(entry.timerId);
    }
    autoDismissByToastId.delete(id);
    toastsSignal.update((toasts) => toasts.filter((toast) => toast.id !== id));
  };

  const pauseAutoDismiss = (id: number): void => {
    const entry = autoDismissByToastId.get(id);
    if (!entry || entry.kind !== 'armed') {
      return;
    }
    clearTimeout(entry.timerId);
    toastTimers.delete(entry.timerId);
    const remainingMs = Math.max(0, entry.endTime - Date.now());
    autoDismissByToastId.set(id, { kind: 'paused', remainingMs });
  };

  const resumeAutoDismiss = (id: number): void => {
    const entry = autoDismissByToastId.get(id);
    if (!entry || entry.kind !== 'paused') {
      return;
    }
    const timerId = setTimeout(() => {
      toastTimers.delete(timerId);
      removeToastById(id);
    }, entry.remainingMs);
    toastTimers.add(timerId);
    const endTime = Date.now() + entry.remainingMs;
    autoDismissByToastId.set(id, { kind: 'armed', timerId, endTime });
  };

  const resumeAutoDismissIfIdle = (id: number, toastEl: HTMLElement): void => {
    queueMicrotask(() => {
      if (
        toastEl.matches(':hover') ||
        toastEl.contains(document.activeElement)
      ) {
        return;
      }
      resumeAutoDismiss(id);
    });
  };

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

    if (type === 'error') {
      return;
    }

    const endTime = Date.now() + 3100;
    const timerId = setTimeout(() => {
      toastTimers.delete(timerId);
      removeToastById(id);
    }, 3100);
    toastTimers.add(timerId);
    autoDismissByToastId.set(id, { kind: 'armed', timerId, endTime });
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
    autoDismissByToastId.clear();
    toastsSignal.value = [];
    scope.dispose();
    hide(reconnectOverlayEl);
    hide(opponentDisconnectEl);
  };

  withScope(scope, () => {
    const gameOverShellVisible = computed(
      () =>
        state.gameOverViewSignal.value.visible &&
        !state.replayControlsSignal.value.active,
    );

    visible(gameOverEl, gameOverShellVisible, 'flex');

    // Keyboard escape from the game-over modal: route to `Exit` (returning
    // the player to the menu) rather than `Rematch`, since Exit is the
    // least-committing and matches Escape's conventional "dismiss" meaning.
    // Listening at the document level so we catch Escape regardless of
    // where focus lives when the modal opens; the visibility check
    // prevents triggering when the modal is closed. The document-contains
    // guard keeps jsdom tests that reset `document.body.innerHTML` between
    // cases from firing orphaned listeners from previous fixtures.
    listen(document, 'keydown', (event) => {
      if (!document.contains(gameOverEl)) return;
      if (!gameOverShellVisible.value) return;
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== 'Escape') return;
      const exitBtn = document.getElementById(
        'exitBtn',
      ) as HTMLButtonElement | null;
      if (!exitBtn || exitBtn.disabled) return;
      keyEvent.preventDefault();
      exitBtn.click();
    });

    effect(() => {
      const gameOverView = state.gameOverViewSignal.value;
      const replayActive = state.replayControlsSignal.value.active;
      const shellVisible = gameOverView.visible && !replayActive;

      const kickerText = gameOverView.kickerText ?? '';
      text(gameOverKickerEl, kickerText);
      visible(gameOverKickerEl, kickerText.length > 0, 'inline-flex');
      text(gameOverTextEl, gameOverView.titleText);
      gameOverTextEl.className = gameOverView.titleClass;
      text(gameOverReasonEl, gameOverView.reasonText);
      text(rematchBtn, gameOverView.rematchText);
      rematchBtn.disabled = gameOverView.rematchDisabled;

      // Apply outcome theme to the overlay root
      gameOverEl.classList.remove(
        'game-over--victory',
        'game-over--defeat',
        'game-over--neutral',
      );
      if (gameOverView.outcomeClass) {
        gameOverEl.classList.add(gameOverView.outcomeClass);
      }

      renderGameOverStats(
        gameOverStatsEl,
        gameOverView.summaryItems,
        gameOverView.shipGroups,
      );
      visible(
        gameOverStatsEl,
        gameOverView.summaryItems.length > 0 ||
          gameOverView.shipGroups.length > 0,
        'block',
      );

      if (shellVisible && !gameOverShellWasVisible) {
        gameOverEl.classList.remove('game-over-enter');
        show(gameOverEl, 'flex');
        void gameOverEl.offsetWidth;
        gameOverEl.classList.add('game-over-enter');
        if (!gameOverView.rematchDisabled) {
          queueMicrotask(() => {
            rematchBtn.focus({ preventScroll: true });
          });
        }
      } else if (!shellVisible) {
        gameOverEl.classList.remove('game-over-enter');
      }

      gameOverShellWasVisible = shellVisible;
    });

    effect(() => {
      const replayView = state.replayControlsSignal.value;
      const replayAvailable = replayControlsEnabled && replayView.available;

      visible(replayControlsEl, replayAvailable);
      visible(replayStatusEl, replayAvailable);

      // When replay is active, game-over shell visibility is handled by
      // gameOverShellVisible; show the compact bottom bar only.
      if (replayControlsEnabled && replayView.active) {
        show(replayBarEl, 'flex');
        text(replayBarStatusEl, replayView.statusText);
        replayBarStartBtn.disabled = !replayView.canStart;
        replayBarPrevBtn.disabled = !replayView.canPrev;
        replayBarNextBtn.disabled = !replayView.canNext;
        replayBarEndBtn.disabled = !replayView.canEnd;

        if (replayView.playing) {
          hide(replayPlayIcon);
          show(replayPauseIcon, 'inline');
          replayBarPlayBtn.setAttribute('aria-label', 'Pause');
        } else {
          show(replayPlayIcon, 'inline');
          hide(replayPauseIcon);
          replayBarPlayBtn.setAttribute('aria-label', 'Play');
        }
      } else {
        hide(replayBarEl);
      }

      if (!replayAvailable) {
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
      if (reconnectReassureEl) {
        visible(reconnectReassureEl, reconnectView.visible, 'block');
      }
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
        const dismissBtn = el('button', {
          class: 'toast-dismiss',
          title: 'Dismiss',
          text: '\u00d7',
          onClick: (event) => {
            event.stopPropagation();
            removeToastById(toast.id);
          },
        });
        dismissBtn.setAttribute('type', 'button');
        dismissBtn.setAttribute('aria-label', 'Dismiss notification');

        const toastEl = el(
          'div',
          {
            class: `toast toast-${toast.type}`,
          },
          el('div', { class: 'toast-body' }, toast.message),
          dismissBtn,
        );
        toastEl.setAttribute(
          'role',
          toast.type === 'error' ? 'alert' : 'status',
        );
        toastEl.setAttribute(
          'aria-live',
          toast.type === 'error' ? 'assertive' : 'polite',
        );
        toastEl.setAttribute('aria-atomic', 'true');

        if (toast.type !== 'error') {
          listen(toastEl, 'mouseenter', () => pauseAutoDismiss(toast.id));
          listen(toastEl, 'mouseleave', () =>
            resumeAutoDismissIfIdle(toast.id, toastEl),
          );
          listen(toastEl, 'focusin', () => pauseAutoDismiss(toast.id));
          listen(toastEl, 'focusout', () =>
            resumeAutoDismissIfIdle(toast.id, toastEl),
          );
        }

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
