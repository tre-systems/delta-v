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
    <div id="helpOverlay" style="display:none"></div>
    <button id="helpBtn"></button>
    <button id="helpCloseBtn"></button>
    <button id="soundBtn"></button>
    <div id="turnTimer"></div>
    <div id="transferPanel" style="display:none"></div>
    ${actionButtons}
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
  canEmplaceBase: false,
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
    expect(
      (document.getElementById('undoBtn') as HTMLElement).style.display,
    ).toBe('inline-block');
    expect(
      (document.getElementById('confirmBtn') as HTMLElement).style.display,
    ).toBe('none');
    // Phase alerts are no longer shown — HUD top bar is sufficient
    expect(showPhaseAlert).not.toHaveBeenCalled();
    expect(queueLayoutSync).toHaveBeenCalledTimes(1);
  });

  it('shows and rotates the objective compass when bearing is set', () => {
    const view = createHUDChromeView({
      queueLayoutSync: vi.fn(),
      showPhaseAlert: vi.fn(),
      onStatusText: vi.fn(),
    });

    view.update(buildInput());
    const compass = document.getElementById('objectiveCompass') as HTMLElement;
    expect(compass.style.display).toBe('none');

    view.update(buildInput({ objectiveBearingDeg: -30 }));
    expect(compass.style.display).toBe('inline-flex');
    expect(compass.style.transform).toBe('rotate(-30deg)');
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
    expect(
      (document.getElementById('helpOverlay') as HTMLElement).style.display,
    ).toBe('flex');
    expect(document.activeElement).toBe(
      document.getElementById('helpCloseBtn'),
    );
    view.toggleHelpOverlay();
    await Promise.resolve();
    expect(
      (document.getElementById('helpOverlay') as HTMLElement).style.display,
    ).toBe('none');
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
    expect(
      (document.getElementById('attackBtn') as HTMLElement).style.display,
    ).toBe('inline-block');

    view.showFireButton(true, 3);
    expect(document.getElementById('fireBtn')?.textContent).toBe('CONFIRM');

    view.update(
      buildInput({
        statusOverrideText: 'Ships moving...',
        suppressActionButtons: true,
      }),
    );

    expect(onStatusText).toHaveBeenCalledWith('Ships moving...');
    for (const id of ACTION_BUTTON_IDS) {
      expect((document.getElementById(id) as HTMLElement).style.display).toBe(
        'none',
      );
    }

    turnTimerSignal.value = null;
    expect(document.getElementById('turnTimer')?.textContent).toBe('');
    expect(queueLayoutSync).toHaveBeenCalledTimes(5);
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
