// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signal } from '../reactive';
import {
  createHiddenReplayControls,
  createOverlayStateStore,
} from './overlay-state';
import { createOverlayView } from './overlay-view';

const installFixture = () => {
  document.body.innerHTML = `
    <div id="gameOver" hidden>
      <div id="gameOverKicker" hidden></div>
      <div id="gameOverText"></div>
      <div id="gameOverReason"></div>
      <div id="gameOverStats"></div>
      <div id="replayStatus" hidden></div>
      <div id="replayControls" hidden>
        <button id="replayMatchPrevBtn"></button>
        <span id="replayMatchLabel"></span>
        <button id="replayMatchNextBtn"></button>
        <button id="replayToggleBtn"></button>
        <div id="replayNav" hidden>
          <button id="replayStartBtn"></button>
          <button id="replayPrevBtn"></button>
          <button id="replayNextBtn"></button>
          <button id="replayEndBtn"></button>
        </div>
      </div>
      <button id="rematchBtn" disabled>Rematch</button>
      <button id="exitBtn">Exit</button>
    </div>
    <div id="replayBar" hidden></div>
    <span id="replayBarStatus"></span>
    <button id="replayBarStartBtn"></button>
    <button id="replayBarPrevBtn"></button>
    <button id="replayBarPlayBtn"></button>
    <svg id="replayPlayIcon"></svg>
    <svg id="replayPauseIcon" hidden></svg>
    <button id="replayBarNextBtn"></button>
    <button id="replayBarEndBtn"></button>
    <button id="replayBarSpeedBtn"></button>
    <div id="replayBarTurnLabel"></div>
    <div id="replayBarProgress">
      <div id="replayBarProgressFill"></div>
    </div>
    <button id="exitGameBtn"></button>
    <div id="reconnectOverlay" hidden>
      <div id="reconnectText"></div>
      <div id="reconnectAttempt"></div>
      <p id="reconnectReassure" class="reconnect-reassure" hidden></p>
      <button id="reconnectCancelBtn"></button>
    </div>
    <div id="opponentDisconnectOverlay" hidden></div>
    <div id="opponentDisconnectText"></div>
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
    (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS = undefined;
  });

  it('renders game-over and rematch-pending states', () => {
    const state = createOverlayStateStore();
    createOverlayView(state);

    state.showGameOver(true, 'Fleet eliminated!', {
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

    const gameOverEl = document.getElementById('gameOver') as HTMLElement;
    expect(gameOverEl.hasAttribute('hidden')).toBe(false);
    expect(gameOverEl.style.display).toBe('flex');
    expect(document.getElementById('gameOverText')?.textContent).toBe(
      'VICTORY',
    );
    expect(document.getElementById('gameOverReason')?.textContent).toContain(
      'Fleet eliminated!',
    );
    expect(document.body.classList.contains('game-over-shell-active')).toBe(
      true,
    );

    const rematchBtn = document.getElementById(
      'rematchBtn',
    ) as HTMLButtonElement;
    expect(rematchBtn.disabled).toBe(false);

    state.showRematchPending();
    expect(rematchBtn.textContent).toBe('Waiting...');
    expect(rematchBtn.disabled).toBe(true);
  });

  it('shows reconnect overlay and runs cancel handler', () => {
    const state = createOverlayStateStore();
    createOverlayView(state);
    const onCancel = vi.fn();

    state.showReconnecting(2, 5, onCancel);

    const reconnectEl = document.getElementById(
      'reconnectOverlay',
    ) as HTMLElement;
    expect(reconnectEl.hasAttribute('hidden')).toBe(false);
    expect(reconnectEl.style.display).toBe('flex');
    expect(document.getElementById('reconnectText')?.textContent).toBe(
      'Connection lost',
    );
    expect(document.getElementById('reconnectAttempt')?.textContent).toBe(
      'Attempt 2 of 5',
    );

    document.getElementById('reconnectCancelBtn')?.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(
      (document.getElementById('reconnectOverlay') as HTMLElement).hasAttribute(
        'hidden',
      ),
    ).toBe(true);
  });

  it('dismisses the game-over modal on Escape by clicking Exit', () => {
    // Regression for the P1-3 a11y sweep: before this binding, Escape had
    // no effect on the game-over modal so keyboard users couldn't dismiss
    // it without mousing to Exit. Escape routes to Exit (not Rematch) so
    // the keybinding does not accidentally commit the player to another
    // match.
    const state = createOverlayStateStore();
    createOverlayView(state);
    state.showGameOver(true, 'Fleet eliminated!');

    const exitBtn = document.getElementById('exitBtn') as HTMLButtonElement;
    const clicks = vi.fn();
    exitBtn.addEventListener('click', clicks);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the game-over modal', () => {
    const state = createOverlayStateStore();
    createOverlayView(state);
    state.showGameOver(true, 'Fleet eliminated!');

    const rematchBtn = document.getElementById(
      'rematchBtn',
    ) as HTMLButtonElement;
    const exitBtn = document.getElementById('exitBtn') as HTMLButtonElement;

    exitBtn.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(rematchBtn);

    rematchBtn.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(exitBtn);
  });

  it('traps Tab focus within the reconnect overlay', () => {
    const state = createOverlayStateStore();
    createOverlayView(state);
    state.showReconnecting(1, 3, vi.fn());

    const outsideButton = document.getElementById(
      'exitGameBtn',
    ) as HTMLButtonElement;
    const cancelBtn = document.getElementById(
      'reconnectCancelBtn',
    ) as HTMLButtonElement;

    outsideButton.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(cancelBtn);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('ignores Escape when the game-over modal is hidden', () => {
    // Ensure the Escape handler is a no-op when the modal is not open so
    // the rest of the app is unaffected.
    const state = createOverlayStateStore();
    createOverlayView(state);

    const exitBtn = document.getElementById('exitBtn') as HTMLButtonElement;
    const clicks = vi.fn();
    exitBtn.addEventListener('click', clicks);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(clicks).not.toHaveBeenCalled();
  });

  it('shows replay controls and updates navigation state', () => {
    (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: { replayControls?: boolean };
      }
    ).__DELTA_V_FEATURE_FLAGS = { replayControls: true };
    const state = createOverlayStateStore();
    createOverlayView(state);
    const replayControlsSignal = signal(createHiddenReplayControls());

    state.bindReplayControlsSignal(replayControlsSignal);
    state.showGameOver(true, 'Fleet eliminated!');
    replayControlsSignal.value = {
      available: true,
      active: true,
      loading: false,
      playing: false,
      statusText: 'ABCDE-m1 • Turn 2',
      selectedGameId: 'ABCDE-m1',
      canSelectPrevMatch: false,
      canSelectNextMatch: true,
      canStart: false,
      canPrev: false,
      canNext: true,
      canEnd: true,
      speed: 1,
      progress: 0.1,
      turnLabel: 'Turn 1/6',
    };

    expect(
      (document.getElementById('gameOver') as HTMLElement).hasAttribute(
        'hidden',
      ),
    ).toBe(true);
    const replayControls = document.getElementById(
      'replayControls',
    ) as HTMLElement;
    const replayNav = document.getElementById('replayNav') as HTMLElement;
    expect(replayControls.hasAttribute('hidden')).toBe(false);
    expect(replayNav.hasAttribute('hidden')).toBe(false);
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
    expect(document.body.classList.contains('replay-bar-active')).toBe(true);
    expect(document.body.classList.contains('game-over-shell-active')).toBe(
      false,
    );
  });

  it('shows toast and phase alert with timed cleanup', () => {
    const state = createOverlayStateStore();
    const view = createOverlayView(state);

    view.showToast('FYI', 'info');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
    expect(document.getElementById('toastContainer')?.textContent).toContain(
      'FYI',
    );

    vi.advanceTimersByTime(3100);
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);

    view.showToast('Problem', 'error');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
    (document.querySelector('.toast-dismiss') as HTMLButtonElement).click();
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

  it('suppresses non-error toasts while phase alert is visible', () => {
    const state = createOverlayStateStore();
    const view = createOverlayView(state);

    view.showPhaseAlert('combat', true);
    view.showToast('Would stack under phase', 'info');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);

    view.showToast('Still an error', 'error');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);

    vi.advanceTimersByTime(1200);
    view.showToast('After phase', 'info');
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(2);
  });

  it('disposes reconnect handlers and pending timers', () => {
    const state = createOverlayStateStore();
    const view = createOverlayView(state);
    const onCancel = vi.fn();

    state.showReconnecting(1, 3, onCancel);
    view.showToast('Warning', 'error');
    view.showPhaseAlert('combat', false);
    view.dispose();

    document.getElementById('reconnectCancelBtn')?.click();
    vi.advanceTimersByTime(5000);

    expect(onCancel).not.toHaveBeenCalled();
    expect(
      (document.getElementById('reconnectOverlay') as HTMLElement).hasAttribute(
        'hidden',
      ),
    ).toBe(true);
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);
  });
});
