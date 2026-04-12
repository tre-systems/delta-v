// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signal } from '../reactive';
import { ACTION_BUTTON_IDS } from './button-bindings';
import type { HUDInput } from './hud';
import { createHUDChromeView } from './hud-chrome-view';

const installFixture = () => {
  const actionButtons = ACTION_BUTTON_IDS.map(
    (id) => `<button id="${id}" style="display:inline-block"></button>`,
  ).join('');

  document.body.innerHTML = `
    <div id="turnInfo"></div>
    <div id="phaseInfo"></div>
    <span id="objectiveWrap" class="objective-wrap">
      <span id="objectiveCompass" class="objective-compass"></span>
      <span id="objective"></span>
    </span>
    <div id="fuelGauge"></div>
    <div id="latencyInfo"></div>
    <div id="fleetStatus"></div>
    <div id="hudBottomButtons" class="hud-bottom-buttons is-empty"></div>
    <div id="helpOverlay" hidden>
      <button id="helpCloseBtn"></button>
    </div>
    <button id="helpBtn"></button>
    <button id="soundBtn"></button>
    <div id="turnTimer"></div>
    <div id="transferPanel" hidden></div>
    <div id="actionButtonFixture">${actionButtons}</div>
  `;
};

const buildInput = (
  overrides: Partial<Omit<HUDInput, 'isMobile'>> = {},
): Omit<HUDInput, 'isMobile'> => ({
  turn: 2,
  phase: 'astrogation',
  isMyTurn: true,
  fuel: 8,
  maxFuel: 12,
  hasBurns: true,
  cargoFree: 6,
  cargoMax: 8,
  objective: 'Hold Mars',
  objectiveBearingDeg: null,
  emplaceBaseState: {
    visible: false,
    disabled: true,
    title: '',
  },
  launchMineState: {
    visible: true,
    disabled: false,
    title: '',
  },
  launchTorpedoState: {
    visible: true,
    disabled: false,
    title: '',
  },
  launchNukeState: {
    visible: true,
    disabled: true,
    title: 'Not enough cargo (need 20, have 6)',
  },
  torpedoAimingActive: false,
  torpedoAccelSteps: null,
  allOrdnanceShipsAcknowledged: false,
  queuedOrdnanceType: null,
  queuedLaunchCount: 0,
  astrogationCtx: {
    selectedShipLanded: false,
    selectedShipDisabled: false,
    selectedShipHasBurn: true,
    allShipsAcknowledged: false,
    multipleShipsAlive: true,
    hasSelection: true,
  },
  speed: 0,
  fuelToStop: 0,
  ...overrides,
});

describe('HUDChromeView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('renders HUD state and alerts only when the phase key changes', () => {
    const queueLayoutSync = vi.fn();
    const showPhaseAlert = vi.fn();
    const onStatusText = vi.fn();
    const view = createHUDChromeView({
      queueLayoutSync,
      showPhaseAlert,
      onStatusText,
    });

    view.update(buildInput());

    expect(document.getElementById('turnInfo')?.textContent).toBe('Turn 2');
    expect(document.getElementById('phaseInfo')?.textContent).toBe(
      'ASTROGATION',
    );
    expect(document.getElementById('objective')?.textContent).toBe('Hold Mars');
    expect(document.getElementById('fuelGauge')?.textContent).toBe(
      'Fuel: 8/12',
    );
    expect(onStatusText).toHaveBeenCalledWith(
      expect.stringContaining('Select another ship'),
    );
    const undoBtn = document.getElementById('undoBtn') as HTMLElement;
    const confirmBtn = document.getElementById('confirmBtn') as HTMLElement;
    expect(undoBtn.hasAttribute('hidden')).toBe(false);
    expect(undoBtn.style.display).toBe('inline-block');
    expect(confirmBtn.hasAttribute('hidden')).toBe(true);
    // Phase alerts are no longer shown — HUD top bar is sufficient
    expect(showPhaseAlert).not.toHaveBeenCalled();
    expect(queueLayoutSync).toHaveBeenCalled();
    expect(
      document
        .getElementById('hudBottomButtons')
        ?.classList.contains('is-empty'),
    ).toBe(false);
  });

  it('shows and rotates the objective compass when bearing is set', () => {
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText: vi.fn(),
    });

    view.update(buildInput());
    const compass = document.getElementById('objectiveCompass') as HTMLElement;
    expect(compass.hasAttribute('hidden')).toBe(true);

    view.update(buildInput({ objectiveBearingDeg: -30 }));
    expect(compass.hasAttribute('hidden')).toBe(false);
    expect(compass.style.display).toBe('inline-flex');
    expect(compass.style.transform).toBe('rotate(-30deg)');
  });

  it('renders separate ordnance skip and confirm buttons', () => {
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText: vi.fn(),
    });

    view.update(
      buildInput({
        phase: 'ordnance',
        launchMineState: {
          visible: true,
          disabled: false,
          title: '',
        },
      }),
    );

    const nextBtn = document.getElementById(
      'nextOrdnanceBtn',
    ) as HTMLButtonElement;
    const confirmBtn = document.getElementById(
      'confirmOrdnanceBtn',
    ) as HTMLButtonElement;

    expect(nextBtn.hasAttribute('hidden')).toBe(false);
    expect(nextBtn.textContent).toBe('SKIP SHIP');
    expect(nextBtn.disabled).toBe(false);
    expect(confirmBtn.hasAttribute('hidden')).toBe(false);
    expect(confirmBtn.textContent).toBe('CONFIRM PHASE');
    expect(confirmBtn.disabled).toBe(true);

    view.update(
      buildInput({
        phase: 'ordnance',
        allOrdnanceShipsAcknowledged: true,
        launchMineState: {
          visible: true,
          disabled: false,
          title: '',
        },
      }),
    );

    expect(nextBtn.hasAttribute('hidden')).toBe(true);
    expect(confirmBtn.disabled).toBe(false);
  });

  it('updates HUD chrome helpers and applies movement presentation overrides', async () => {
    const queueLayoutSync = vi.fn();
    const onStatusText = vi.fn();
    const turnTimerSignal = signal<{
      text: string;
      className: string;
    } | null>(null);
    const view = createHUDChromeView({
      queueLayoutSync,
      showPhaseAlert: vi.fn(),
      onStatusText,
    });
    view.bindTurnTimerSignal(turnTimerSignal);

    view.updateLatency(275);
    expect(document.getElementById('latencyInfo')?.textContent).toBe('275ms');
    expect(document.getElementById('latencyInfo')?.className).toContain(
      'latency-bad',
    );

    view.updateFleetStatus('2 ships ready');
    expect(document.getElementById('fleetStatus')?.textContent).toBe(
      '2 ships ready',
    );

    const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
    helpBtn.focus();
    view.toggleHelpOverlay();
    await Promise.resolve();
    const helpOverlay = document.getElementById('helpOverlay') as HTMLElement;
    expect(helpOverlay.hasAttribute('hidden')).toBe(false);
    expect(helpOverlay.style.display).toBe('flex');
    expect(document.activeElement).toBe(
      document.getElementById('helpCloseBtn'),
    );
    view.toggleHelpOverlay();
    await Promise.resolve();
    expect(helpOverlay.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(helpBtn);

    view.updateSoundButton(true);
    const soundBtn = document.getElementById('soundBtn') as HTMLButtonElement;
    expect(soundBtn.querySelector('svg')).not.toBeNull();
    expect(soundBtn.innerHTML).toContain('line');
    expect(soundBtn.classList.contains('muted')).toBe(true);

    turnTimerSignal.value = {
      text: '00:15',
      className: 'timer-warning',
    };
    expect(document.getElementById('turnTimer')?.textContent).toBe('00:15');
    expect(document.getElementById('turnTimer')?.className).toBe(
      'timer-warning',
    );

    view.showAttackButton(true);
    const attackBtn = document.getElementById('attackBtn') as HTMLElement;
    expect(attackBtn.hasAttribute('hidden')).toBe(false);
    expect(attackBtn.style.display).toBe('inline-block');

    view.showFireButton(true, 3);
    expect(document.getElementById('fireBtn')?.textContent).toBe('END COMBAT');

    view.update(
      buildInput({
        statusOverrideText: 'Ships moving...',
        suppressActionButtons: true,
      }),
    );

    expect(onStatusText).toHaveBeenCalledWith('Ships moving...');
    for (const id of ACTION_BUTTON_IDS) {
      expect(
        (document.getElementById(id) as HTMLElement).hasAttribute('hidden'),
      ).toBe(true);
    }

    turnTimerSignal.value = null;
    expect(document.getElementById('turnTimer')?.textContent).toBe('');
    expect(queueLayoutSync.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(
      document
        .getElementById('hudBottomButtons')
        ?.classList.contains('is-empty'),
    ).toBe(true);
  });

  it('traps focus inside the help overlay and closes it on Escape', async () => {
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText: vi.fn(),
    });

    const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
    const helpCloseBtn = document.getElementById(
      'helpCloseBtn',
    ) as HTMLButtonElement;
    const helpOverlay = document.getElementById('helpOverlay') as HTMLElement;

    helpBtn.focus();
    view.toggleHelpOverlay();
    await Promise.resolve();

    expect(document.activeElement).toBe(helpCloseBtn);

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    helpCloseBtn.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(helpCloseBtn);

    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    helpOverlay.dispatchEvent(escapeEvent);
    await Promise.resolve();

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(helpOverlay.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(helpBtn);
  });

  it('recomputes status text when the mobile breakpoint changes', () => {
    const onStatusText = vi.fn();
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText,
    });

    view.update(
      buildInput({
        astrogationCtx: {
          selectedShipLanded: true,
          selectedShipDisabled: false,
          selectedShipHasBurn: false,
          allShipsAcknowledged: false,
          multipleShipsAlive: false,
          hasSelection: true,
        },
      }),
    );

    expect(onStatusText).toHaveBeenLastCalledWith(
      'Click a direction to burn (1 fuel)',
    );

    view.setMobile(true);

    expect(onStatusText).toHaveBeenLastCalledWith(
      'Tap a direction to burn (1 fuel)',
    );
  });

  it('re-renders even when update reuses the same input object reference', () => {
    const onStatusText = vi.fn();
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText,
    });
    const input = buildInput({
      astrogationCtx: {
        selectedShipLanded: true,
        selectedShipDisabled: false,
        selectedShipHasBurn: false,
        allShipsAcknowledged: false,
        multipleShipsAlive: false,
        hasSelection: true,
      },
    });

    view.update(input);
    expect(onStatusText).toHaveBeenLastCalledWith(
      'Click a direction to burn (1 fuel)',
    );

    input.astrogationCtx.selectedShipLanded = false;
    input.astrogationCtx.selectedShipHasBurn = true;
    view.update(input);

    expect(onStatusText).toHaveBeenLastCalledWith('Burn set · Confirm (Enter)');
  });

  it('disposes the reactive HUD effects cleanly', () => {
    const onStatusText = vi.fn();
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText,
    });

    view.update(buildInput());
    const callsBeforeDispose = onStatusText.mock.calls.length;

    view.dispose();
    view.setMobile(true);
    view.update(
      buildInput({
        astrogationCtx: {
          selectedShipLanded: true,
          selectedShipDisabled: false,
          selectedShipHasBurn: false,
          allShipsAcknowledged: false,
          multipleShipsAlive: false,
          hasSelection: true,
        },
      }),
    );

    expect(onStatusText).toHaveBeenCalledTimes(callsBeforeDispose);
  });
});
