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
    <div id="gameOver" hidden></div>
    <div id="gameOverKicker" hidden></div>
    <div id="gameOverText"></div>
    <div id="gameOverReason"></div>
    <div id="gameOverStats"></div>
    <div id="replayStatus" hidden></div>
    <div id="replayControls" hidden></div>
    <button id="replayMatchPrevBtn"></button>
    <span id="replayMatchLabel"></span>
    <button id="replayMatchNextBtn"></button>
    <button id="replayToggleBtn"></button>
    <div id="replayNav" hidden></div>
    <button id="replayStartBtn"></button>
    <button id="replayPrevBtn"></button>
    <button id="replayNextBtn"></button>
    <button id="replayEndBtn"></button>
    <button id="rematchBtn" disabled>Rematch</button>
    <div id="replayBar" hidden></div>
    <span id="replayBarStatus"></span>
    <button id="replayBarStartBtn"></button>
    <button id="replayBarPrevBtn"></button>
    <button id="replayBarPlayBtn"></button>
    <svg id="replayPlayIcon"></svg>
    <svg id="replayPauseIcon" hidden></svg>
    <button id="replayBarNextBtn"></button>
    <button id="replayBarEndBtn"></button>
    <div id="reconnectOverlay" hidden></div>
    <div id="reconnectText"></div>
    <div id="reconnectAttempt"></div>
    <button id="reconnectCancelBtn"></button>
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
    delete (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (
      globalThis as typeof globalThis & {
        __DELTA_V_FEATURE_FLAGS?: unknown;
      }
    ).__DELTA_V_FEATURE_FLAGS;
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
  });

  it('shows toast and phase alert with timed cleanup', () => {
    const state = createOverlayStateStore();
    const view = createOverlayView(state);

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
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(1);
  });
});
