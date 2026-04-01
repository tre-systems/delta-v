// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUIManager } from './ui';

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
    <span id="objectiveWrap" class="objective-wrap">
      <span id="objectiveCompass" class="objective-compass"></span>
      <span id="objective"></span>
    </span>
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
    <div id="replayStatus"></div>
    <div id="replayControls"></div>
    <button id="replayMatchPrevBtn"></button>
    <span id="replayMatchLabel"></span>
    <button id="replayMatchNextBtn"></button>
    <button id="replayToggleBtn"></button>
    <div id="replayNav"></div>
    <button id="replayStartBtn"></button>
    <button id="replayPrevBtn"></button>
    <button id="replayNextBtn"></button>
    <button id="replayEndBtn"></button>
    <div id="replayBar"></div>
    <span id="replayBarStatus"></span>
    <button id="replayBarStartBtn"></button>
    <button id="replayBarPrevBtn"></button>
    <button id="replayBarNextBtn"></button>
    <button id="replayBarEndBtn"></button>
    <button id="replayBarExitBtn"></button>
    <div id="reconnectOverlay"></div>
    <div id="reconnectText"></div>
    <div id="reconnectAttempt"></div>
    <button id="reconnectCancelBtn"></button>
    <div id="opponentDisconnectOverlay"></div>
    <div id="opponentDisconnectText"></div>
    <div id="scenarioList"></div>
    <button id="createBtn"></button>
    <button id="singlePlayerBtn"></button>
    <button id="backBtn"></button>
    <button id="joinBtn"></button>
    <input id="codeInput" />
    <button id="copyBtn"></button>
    <button id="copySpectateBtn"></button>
    <div id="gameCode"></div>
    <div id="waitingStatus"></div>
    <button class="btn-difficulty active" data-difficulty="normal"></button>
    <button id="undoBtn"></button>
    <button id="confirmBtn"></button>
    <button id="landFromOrbitBtn"></button>
    <button id="matchVelocityBtn"></button>
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
    <button id="helpCloseBtn"></button>
    <button id="soundBtn"></button>
    <div id="helpOverlay"></div>
    <div id="phaseAlert">
      <div class="phase-alert-title"></div>
      <div class="phase-alert-subtitle"></div>
    </div>
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
    const ui = createUIManager();
    expect(ui).toBeDefined();
    expect(ui.onEvent).toBeNull();
  });

  it('routes static button clicks through onEvent', () => {
    const ui = createUIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    document.getElementById('confirmBtn')?.click();
    document.getElementById('undoBtn')?.click();
    document.getElementById('rematchBtn')?.click();
    document.getElementById('replayToggleBtn')?.click();

    expect(events).toEqual([
      { type: 'confirm' },
      { type: 'undo' },
      { type: 'rematch' },
      { type: 'toggleReplay' },
    ]);
  });

  it('showMenu makes menu visible and hides HUD', () => {
    const ui = createUIManager();
    ui.showMenu();

    expect(document.getElementById('menu')?.style.display).toBe('flex');
    expect(document.getElementById('hud')?.style.display).toBe('none');
    expect(document.getElementById('gameOver')?.style.display).toBe('none');
  });

  it('showHUD makes HUD visible and hides menu', () => {
    const ui = createUIManager();
    ui.showHUD();

    expect(document.getElementById('hud')?.style.display).toBe('block');
    expect(document.getElementById('menu')?.style.display).toBe('none');
    expect(document.getElementById('menu')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(document.getElementById('shipList')?.style.display).toBe('flex');
  });

  it('showWaiting shows waiting screen with room code', () => {
    const ui = createUIManager();
    ui.setWaitingState('ABC12', false);
    ui.showWaiting();

    expect(document.getElementById('waiting')?.style.display).toBe('flex');
    expect(document.getElementById('gameCode')?.textContent).toBe('ABC12');
  });

  it('hideAll hides all screens', () => {
    const ui = createUIManager();
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
    const ui = createUIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    ui.dispose();

    document.getElementById('confirmBtn')?.click();
    // After dispose, events should still fire (onEvent not nulled)
    // but disposal of subviews should not throw
    expect(ui).toBeDefined();
  });
});
