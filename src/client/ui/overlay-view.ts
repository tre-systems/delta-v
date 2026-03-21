import { byId, el, hide, show } from '../dom';
import { getPhaseAlertCopy } from './formatters';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
} from './screens';

export class OverlayView {
  private readonly gameOverEl = byId('gameOver');
  private readonly gameOverTextEl = byId('gameOverText');
  private readonly gameOverReasonEl = byId('gameOverReason');
  private readonly rematchBtn = byId<HTMLButtonElement>('rematchBtn');
  private readonly reconnectOverlayEl = byId('reconnectOverlay');
  private readonly reconnectTextEl = byId('reconnectText');
  private readonly reconnectAttemptEl = byId('reconnectAttempt');
  private readonly reconnectCancelBtn = byId('reconnectCancelBtn');
  private readonly toastContainerEl = byId('toastContainer');
  private readonly phaseAlertEl = byId('phaseAlert');
  private readonly phaseAlertTitleEl = this.phaseAlertEl.querySelector(
    '.phase-alert-title',
  ) as HTMLElement;
  private readonly phaseAlertSubtitleEl = this.phaseAlertEl.querySelector(
    '.phase-alert-subtitle',
  ) as HTMLElement;

  showGameOver(
    won: boolean,
    reason: string,
    stats?: {
      turns: number;
      myShipsAlive: number;
      myShipsTotal: number;
      enemyShipsAlive: number;
      enemyShipsTotal: number;
    },
  ): void {
    const view = buildGameOverView(won, reason, stats);

    show(this.gameOverEl, 'flex');
    this.gameOverTextEl.textContent = view.titleText;
    this.gameOverReasonEl.textContent = view.reasonText;
    this.gameOverReasonEl.style.whiteSpace = 'pre-line';
    this.rematchBtn.textContent = view.rematchText;
    this.rematchBtn.removeAttribute('disabled');
  }

  showRematchPending(): void {
    const view = buildRematchPendingView();
    this.rematchBtn.textContent = view.rematchText;

    if (view.rematchDisabled) {
      this.rematchBtn.setAttribute('disabled', 'true');
    }
  }

  showReconnecting(
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ): void {
    const view = buildReconnectView(attempt, maxAttempts);

    show(this.reconnectOverlayEl, 'flex');
    this.reconnectTextEl.textContent = view.reconnectText;
    this.reconnectAttemptEl.textContent = view.attemptText;
    this.reconnectCancelBtn.onclick = () => {
      this.hideReconnecting();
      onCancel();
    };
  }

  hideReconnecting(): void {
    hide(this.reconnectOverlayEl);
  }

  showToast(
    message: string,
    type: 'error' | 'info' | 'success' = 'info',
  ): void {
    const toast = el('div', {
      class: `toast toast-${type}`,
      text: message,
    });

    this.toastContainerEl.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3100);
  }

  showPhaseAlert(phase: string, isMyTurn: boolean): void {
    const copy = getPhaseAlertCopy(phase, isMyTurn);

    this.phaseAlertTitleEl.textContent = copy.title;
    this.phaseAlertSubtitleEl.textContent = copy.subtitle;
    this.phaseAlertSubtitleEl.style.color = copy.subtitleColor;

    this.phaseAlertEl.classList.remove('active');
    void this.phaseAlertEl.offsetWidth;
    this.phaseAlertEl.classList.add('active');

    setTimeout(() => {
      this.phaseAlertEl.classList.remove('active');
    }, 1200);
  }
}
