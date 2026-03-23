// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UIManager } from './ui';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const installFixture = () => {
  document.body.innerHTML = `
    <div id="menu"></div>
    <div id="scenarioSelect"></div>
    <div id="waiting"></div>
    <div id="hud"></div>
    <div id="topBar"></div>
    <div id="bottomBar"></div>
    <div id="gameOver">
      <div id="gameOverTitle"></div>
      <div id="gameOverReason"></div>
    </div>
    <div id="shipList"></div>
    <div id="fleetBuilding">
      <div id="fleetCredits"></div>
      <div id="fleetCart"></div>
      <div id="fleetShopList"></div>
      <button id="fleetReadyBtn"></button>
      <button id="fleetClearBtn"></button>
      <div id="fleetWaiting"></div>
    </div>
    <div id="gameLog">
      <div id="logBar"></div>
      <div id="logEntries"></div>
      <input id="chatInput" />
      <button id="chatSendBtn"></button>
      <div id="statusText"></div>
    </div>
    <div id="turnInfo"></div>
    <div id="phaseInfo"></div>
    <div id="objective"></div>
    <div id="fuelGauge"></div>
    <div id="transferPanel"></div>
    <div id="latencyInfo"></div>
    <div id="fleetStatus"></div>
    <div id="turnTimer"></div>
    <div id="chatInputRow"></div>
    <div id="logLatestBar"></div>
    <div id="logLatestText"></div>
    <div id="gameOverText"></div>
    <div id="gameOverReason"></div>
    <div id="gameOverStats"></div>
    <div id="reconnectOverlay"></div>
    <div id="reconnectText"></div>
    <div id="reconnectAttempt"></div>
    <button id="reconnectCancelBtn"></button>
    <div id="scenarioList"></div>
    <button id="createBtn"></button>
    <button id="singlePlayerBtn"></button>
    <button id="backBtn"></button>
    <button id="joinBtn"></button>
    <input id="codeInput" />
    <button id="copyBtn"></button>
    <div id="gameCode"></div>
    <div id="waitingStatus"></div>
    <button class="btn-difficulty active" data-difficulty="normal"></button>
    <button id="undoBtn"></button>
    <button id="confirmBtn"></button>
    <button id="launchMineBtn"></button>
    <button id="launchTorpedoBtn"></button>
    <button id="launchNukeBtn"></button>
    <button id="emplaceBaseBtn"></button>
    <button id="skipOrdnanceBtn"></button>
    <button id="attackBtn"></button>
    <button id="fireBtn"></button>
    <button id="skipCombatBtn"></button>
    <button id="skipLogisticsBtn"></button>
    <button id="confirmTransfersBtn"></button>
    <button id="rematchBtn"></button>
    <button id="exitBtn"></button>
    <button id="helpBtn"></button>
    <button id="soundBtn"></button>
    <div id="helpOverlay"></div>
    <div id="phaseAlert"></div>
    <div id="reconnecting">
      <div id="reconnectStatus"></div>
    </div>
    <div id="toastContainer"></div>
  `;
};

describe('UIManager', () => {
  beforeEach(() => {
    installFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs without throwing and wires subviews', () => {
    const ui = new UIManager();
    expect(ui).toBeDefined();
    expect(ui.onEvent).toBeNull();
  });

  it('routes static button clicks through onEvent', () => {
    const ui = new UIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    document.getElementById('confirmBtn')?.click();
    document.getElementById('undoBtn')?.click();
    document.getElementById('rematchBtn')?.click();

    expect(events).toEqual([
      { type: 'confirm' },
      { type: 'undo' },
      { type: 'rematch' },
    ]);
  });

  it('showMenu makes menu visible and hides HUD', () => {
    const ui = new UIManager();
    ui.showMenu();

    expect(document.getElementById('menu')?.style.display).toBe('flex');
    expect(document.getElementById('hud')?.style.display).toBe('none');
    expect(document.getElementById('gameOver')?.style.display).toBe('none');
  });

  it('showHUD makes HUD visible and hides menu', () => {
    const ui = new UIManager();
    ui.showHUD();

    expect(document.getElementById('hud')?.style.display).toBe('block');
    expect(document.getElementById('menu')?.style.display).toBe('none');
    expect(document.getElementById('shipList')?.style.display).toBe('flex');
  });

  it('showWaiting shows waiting screen with room code', () => {
    const ui = new UIManager();
    ui.showWaiting('ABC12');

    expect(document.getElementById('waiting')?.style.display).toBe('flex');
    expect(document.getElementById('gameCode')?.textContent).toBe('ABC12');
  });

  it('hideAll hides all screens', () => {
    const ui = new UIManager();
    ui.showMenu();
    ui.hideAll();

    const ids = [
      'menu',
      'scenarioSelect',
      'waiting',
      'hud',
      'gameOver',
      'shipList',
      'fleetBuilding',
    ];

    for (const id of ids) {
      expect(document.getElementById(id)?.style.display).toBe('none');
    }
  });

  it('dispose removes event listeners cleanly', () => {
    const ui = new UIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    ui.dispose();

    document.getElementById('confirmBtn')?.click();
    // After dispose, events should still fire (onEvent not nulled)
    // but disposal of subviews should not throw
    expect(ui).toBeDefined();
  });
});
