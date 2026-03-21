// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverlayView } from './overlay-view';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="gameOver" style="display:none"></div>
    <div id="gameOverText"></div>
    <div id="gameOverReason"></div>
    <button id="rematchBtn" disabled>Rematch</button>
    <div id="reconnectOverlay" style="display:none"></div>
    <div id="reconnectText"></div>
    <div id="reconnectAttempt"></div>
    <button id="reconnectCancelBtn"></button>
    <div id="toastContainer"></div>
    <div id="phaseAlert">
      <div class="phase-alert-title"></div>
      <div class="phase-alert-subtitle"></div>
    </div>
  `;
};

describe('OverlayView', () => {
  beforeEach(() => {
    installFixture();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders game-over and rematch-pending states', () => {
    const view = new OverlayView();

    view.showGameOver(true, 'Fleet eliminated!', {
      turns: 12,
      myShipsAlive: 2,
      myShipsTotal: 3,
      enemyShipsAlive: 0,
      enemyShipsTotal: 2,
    });

    expect(
      (document.getElementById('gameOver') as HTMLElement).style.display,
    ).toBe('flex');
    expect(document.getElementById('gameOverText')?.textContent).toBe(
      'VICTORY',
    );
    expect(document.getElementById('gameOverReason')?.textContent).toContain(
      'Fleet eliminated!',
    );

    const rematchBtn = document.getElementById(
      'rematchBtn',
    ) as HTMLButtonElement;
    expect(rematchBtn.disabled).toBe(false);

    view.showRematchPending();
    expect(rematchBtn.textContent).toBe('Waiting...');
    expect(rematchBtn.disabled).toBe(true);
  });

  it('shows reconnect overlay and runs cancel handler', () => {
    const view = new OverlayView();
    const onCancel = vi.fn();

    view.showReconnecting(2, 5, onCancel);

    expect(
      (document.getElementById('reconnectOverlay') as HTMLElement).style
        .display,
    ).toBe('flex');
    expect(document.getElementById('reconnectText')?.textContent).toBe(
      'Connection lost',
    );
    expect(document.getElementById('reconnectAttempt')?.textContent).toBe(
      'Attempt 2 of 5',
    );

    document.getElementById('reconnectCancelBtn')?.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(
      (document.getElementById('reconnectOverlay') as HTMLElement).style
        .display,
    ).toBe('none');
  });

  it('shows toast and phase alert with timed cleanup', () => {
    const view = new OverlayView();

    view.showToast('Warning', 'error');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
    expect(document.getElementById('toastContainer')?.textContent).toContain(
      'Warning',
    );

    vi.advanceTimersByTime(3100);
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);

    view.showPhaseAlert('astrogation', true);

    const phaseAlert = document.getElementById('phaseAlert') as HTMLElement;
    expect(phaseAlert.querySelector('.phase-alert-title')?.textContent).toBe(
      'Astrogation',
    );
    expect(phaseAlert.querySelector('.phase-alert-subtitle')?.textContent).toBe(
      'YOUR TURN',
    );
    expect(phaseAlert.classList.contains('active')).toBe(true);

    vi.advanceTimersByTime(1200);
    expect(phaseAlert.classList.contains('active')).toBe(false);
  });
});
