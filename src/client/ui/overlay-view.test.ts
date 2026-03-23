// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOverlayView } from './overlay-view';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="gameOver" style="display:none"></div>
    <div id="gameOverText"></div>
    <div id="gameOverReason"></div>
    <div id="gameOverStats"></div>
    <div id="replayStatus" style="display:none"></div>
    <div id="replayControls" style="display:none"></div>
    <button id="replayMatchPrevBtn"></button>
    <span id="replayMatchLabel"></span>
    <button id="replayMatchNextBtn"></button>
    <button id="replayToggleBtn"></button>
    <div id="replayNav" style="display:none"></div>
    <button id="replayStartBtn"></button>
    <button id="replayPrevBtn"></button>
    <button id="replayNextBtn"></button>
    <button id="replayEndBtn"></button>
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
    const view = createOverlayView();

    view.showGameOver(true, 'Fleet eliminated!', {
      turns: 12,
      myShipsAlive: 2,
      myShipsTotal: 3,
      enemyShipsAlive: 0,
      enemyShipsTotal: 2,
      myShipsDestroyed: 1,
      enemyShipsDestroyed: 2,
      myFuelSpent: 18,
      enemyFuelSpent: 12,
      basesDestroyed: 0,
      ordnanceInFlight: 0,
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
    const view = createOverlayView();
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

  it('shows replay controls and updates navigation state', () => {
    const view = createOverlayView();

    view.showGameOver(true, 'Fleet eliminated!');
    view.setReplayControls({
      available: true,
      active: true,
      loading: false,
      statusText: 'ABCDE-m1 • Turn 2',
      selectedGameId: 'ABCDE-m1',
      canSelectPrevMatch: false,
      canSelectNextMatch: true,
      canStart: false,
      canPrev: false,
      canNext: true,
      canEnd: true,
    });

    expect(
      (document.getElementById('replayControls') as HTMLElement).style.display,
    ).not.toBe('none');
    expect(
      (document.getElementById('replayNav') as HTMLElement).style.display,
    ).not.toBe('none');
    expect(document.getElementById('replayStatus')?.textContent).toContain(
      'ABCDE-m1',
    );
    expect(document.getElementById('replayMatchLabel')?.textContent).toBe(
      'ABCDE-m1',
    );
    expect(document.getElementById('replayToggleBtn')?.textContent).toBe(
      'Exit Replay',
    );
    expect(
      (document.getElementById('replayMatchPrevBtn') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (document.getElementById('replayMatchNextBtn') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (document.getElementById('replayStartBtn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (document.getElementById('replayNextBtn') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('shows toast and phase alert with timed cleanup', () => {
    const view = createOverlayView();

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

  it('disposes reconnect handlers and pending timers', () => {
    const view = createOverlayView();
    const onCancel = vi.fn();

    view.showReconnecting(1, 3, onCancel);
    view.showToast('Warning', 'error');
    view.showPhaseAlert('combat', false);
    view.dispose();

    document.getElementById('reconnectCancelBtn')?.click();
    vi.advanceTimersByTime(5000);

    expect(onCancel).not.toHaveBeenCalled();
    expect(
      (document.getElementById('reconnectOverlay') as HTMLElement).style
        .display,
    ).toBe('none');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
  });
});
