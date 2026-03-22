// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTION_BUTTON_IDS } from './button-bindings';
import type { HUDInput } from './hud';
import { HUDChromeView } from './hud-chrome-view';

const installFixture = () => {
  const actionButtons = ACTION_BUTTON_IDS.map(
    (id) => `<button id="${id}" style="display:inline-block"></button>`,
  ).join('');

  document.body.innerHTML = `
    <div id="turnInfo"></div>
    <div id="phaseInfo"></div>
    <div id="objective"></div>
    <div id="fuelGauge"></div>
    <div id="latencyInfo"></div>
    <div id="fleetStatus"></div>
    <div id="helpOverlay" style="display:none"></div>
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
  astrogationCtx: {
    selectedShipLanded: false,
    selectedShipDisabled: false,
    selectedShipHasBurn: true,
    allShipsHaveBurns: false,
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
    const view = new HUDChromeView({
      getIsMobile: () => false,
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
      expect.stringContaining('Confirm'),
    );
    expect(
      (document.getElementById('undoBtn') as HTMLElement).style.display,
    ).toBe('inline-block');
    expect(
      (document.getElementById('confirmBtn') as HTMLElement).style.display,
    ).toBe('inline-block');
    expect(showPhaseAlert).toHaveBeenCalledWith('astrogation', true);
    expect(queueLayoutSync).toHaveBeenCalledTimes(1);

    view.update(buildInput());
    expect(showPhaseAlert).toHaveBeenCalledTimes(1);

    view.update(buildInput({ phase: 'combat', hasBurns: false }));
    expect(showPhaseAlert).toHaveBeenCalledTimes(2);
    expect(showPhaseAlert).toHaveBeenLastCalledWith('combat', true);
  });

  it('updates HUD chrome helpers and hides action buttons during movement', () => {
    const queueLayoutSync = vi.fn();
    const onStatusText = vi.fn();
    const view = new HUDChromeView({
      getIsMobile: () => false,
      queueLayoutSync,
      showPhaseAlert: vi.fn(),
      onStatusText,
    });

    view.updateLatency(275);
    expect(document.getElementById('latencyInfo')?.textContent).toBe('275ms');
    expect(document.getElementById('latencyInfo')?.className).toContain(
      'latency-bad',
    );

    view.updateFleetStatus('2 ships ready');
    expect(document.getElementById('fleetStatus')?.textContent).toBe(
      '2 ships ready',
    );

    view.toggleHelpOverlay();
    expect(
      (document.getElementById('helpOverlay') as HTMLElement).style.display,
    ).toBe('flex');
    view.toggleHelpOverlay();
    expect(
      (document.getElementById('helpOverlay') as HTMLElement).style.display,
    ).toBe('none');

    view.updateSoundButton(true);
    const soundBtn = document.getElementById('soundBtn') as HTMLButtonElement;
    expect(soundBtn.textContent).toBe('\uD83D\uDD07');
    expect(soundBtn.classList.contains('muted')).toBe(true);

    view.setTurnTimer('00:15', 'timer-warning');
    expect(document.getElementById('turnTimer')?.textContent).toBe('00:15');
    expect(document.getElementById('turnTimer')?.className).toBe(
      'timer-warning',
    );

    view.showAttackButton(true);
    expect(
      (document.getElementById('attackBtn') as HTMLElement).style.display,
    ).toBe('inline-block');

    view.showFireButton(true, 3);
    expect(document.getElementById('fireBtn')?.textContent).toBe(
      'FIRE ALL (3)',
    );

    view.showMovementStatus();
    expect(onStatusText).toHaveBeenCalledWith('Ships moving...');
    for (const id of ACTION_BUTTON_IDS) {
      expect((document.getElementById(id) as HTMLElement).style.display).toBe(
        'none',
      );
    }

    view.clearTurnTimer();
    expect(document.getElementById('turnTimer')?.textContent).toBe('');
    expect(queueLayoutSync).toHaveBeenCalledTimes(5);
  });
});
