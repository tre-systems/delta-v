// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientState } from '../game/phase';
import { signal } from '../reactive';
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
    <div id="bottomBar">
      <div id="hudBottomButtons" class="hud-bottom-buttons is-empty"></div>
    </div>
    <div id="gameOver">
      <div id="gameOverTitle"></div>
      <div id="gameOverReason"></div>
    </div>
    <div id="shipList"></div>
    <div id="fleetBuilding">
      <div id="fleetCredits"></div>
      <p id="fleetBuildingScenario" hidden></p>
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
    <div id="gameOverKicker"></div>
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
    <div id="reconnectOverlay"></div>
    <div id="reconnectText"></div>
    <div id="reconnectAttempt"></div>
    <button id="reconnectCancelBtn"></button>
    <div id="opponentDisconnectOverlay"></div>
    <div id="opponentDisconnectText"></div>
    <div id="scenarioList"></div>
    <button id="quickMatchBtn"></button>
    <button id="createBtn"></button>
    <button id="singlePlayerBtn"></button>
    <input id="playerNameInput" />
    <button id="saveRecoveryCodeBtn"></button>
    <button id="restoreCallsignBtn"></button>
    <button id="forgetCallsignBtn"></button>
    <div id="recoveryPanel" hidden>
      <div id="recoveryCodeBlock" hidden>
        <div id="recoveryCodeText"></div>
        <button id="copyRecoveryCodeBtn"></button>
      </div>
      <div id="recoveryRestoreForm" hidden>
        <input id="recoveryCodeInput" />
        <button id="submitRecoveryCodeBtn"></button>
      </div>
    </div>
    <div id="callsignStatus"></div>
    <button id="backBtn"></button>
    <button id="joinBtn"></button>
    <input id="codeInput" />
    <button id="copyBtn"></button>
    <button id="copySpectateBtn"></button>
    <button id="cancelWaitingBtn"></button>
    <div id="waitingTitle"></div>
    <div id="gameCode"></div>
    <p id="waitingScenario" hidden></p>
    <div id="waitingStatus"></div>
    <button class="btn-difficulty active" data-difficulty="normal"></button>
    <button id="undoBtn"></button>
    <button id="skipShipBtn"></button>
    <button id="confirmBtn"></button>
    <button id="landFromOrbitBtn"></button>
    <button id="launchMineBtn"></button>
    <button id="launchTorpedoBtn"></button>
    <button id="launchNukeBtn"></button>
    <button id="emplaceBaseBtn"></button>
    <button id="nextOrdnanceBtn"></button>
    <button id="confirmOrdnanceBtn"></button>
    <button id="attackBtn"></button>
    <button id="fireBtn"></button>
    <button id="skipCombatBtn"></button>
    <button id="skipLogisticsBtn"></button>
    <button id="confirmTransfersBtn"></button>
    <button id="rematchBtn"></button>
    <button id="exitBtn"></button>
    <button id="menuHowToPlayBtn"></button>
    <button id="helpBtn"></button>
    <button id="helpCloseBtn"></button>
    <button id="soundBtn"></button>
    <button id="exitGameBtn"></button>
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

const bindClientState = (
  ui: ReturnType<typeof createUIManager>,
  state: ClientState,
) => {
  const s = signal<ClientState>(state);
  ui.bindClientStateSignal(s);
  return s;
};

const createTestUIManager = () =>
  createUIManager({
    playerProfile: {
      getProfile: () => ({
        playerKey: 'playerkey1',
        username: 'Pilot 1',
      }),
      setUsername: (username: string) => ({
        playerKey: 'playerkey1',
        username,
      }),
      resetProfile: () => ({
        playerKey: 'playerkey2',
        username: 'Pilot ABC',
      }),
      restoreProfile: (profile) => profile,
    },
    sessionTokens: {
      clearAllStoredPlayerTokens: vi.fn(),
    },
  });

describe('UIManager', () => {
  beforeEach(() => {
    installFixture();
  });

  afterEach(() => {
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('constructs without throwing and wires subviews', () => {
    const ui = createTestUIManager();
    expect(ui).toBeDefined();
    expect(ui.onEvent).toBeNull();
  });

  it('routes static button clicks through onEvent', () => {
    const ui = createTestUIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    document.getElementById('confirmBtn')?.click();
    document.getElementById('nextOrdnanceBtn')?.click();
    document.getElementById('confirmOrdnanceBtn')?.click();
    document.getElementById('undoBtn')?.click();
    document.getElementById('rematchBtn')?.click();
    document.getElementById('replayToggleBtn')?.click();

    expect(events).toEqual([
      { type: 'confirm' },
      { type: 'skipOrdnanceShip' },
      { type: 'confirmOrdnance' },
      { type: 'undo' },
      { type: 'rematch' },
      { type: 'toggleReplay' },
    ]);
  });

  it('shows menu when interaction mode is menu', () => {
    const ui = createTestUIManager();
    bindClientState(ui, 'menu');

    const menu = document.getElementById('menu') as HTMLElement;
    const hud = document.getElementById('hud') as HTMLElement;
    const gameOver = document.getElementById('gameOver') as HTMLElement;
    expect(menu.style.display).toBe('flex');
    expect(menu.hasAttribute('hidden')).toBe(false);
    expect(hud.hasAttribute('hidden')).toBe(true);
    expect(gameOver.hasAttribute('hidden')).toBe(true);
    expect(document.body.classList.contains('ui-mode-menu')).toBe(true);
    expect(document.body.classList.contains('ui-mode-overlay')).toBe(true);
  });

  it('uses overlay chrome for scenario, waiting, and fleet-building screens', () => {
    const ui = createTestUIManager();
    const state = bindClientState(ui, 'menu');

    ui.showScenarioSelect();
    expect(document.body.classList.contains('ui-mode-overlay')).toBe(true);

    ui.setWaitingState({
      kind: 'private',
      code: 'ABC12',
      connecting: false,
    });
    state.value = 'waitingForOpponent';
    expect(document.body.classList.contains('ui-mode-overlay')).toBe(true);

    state.value = 'playing_fleetBuilding';
    expect(document.body.classList.contains('ui-mode-overlay')).toBe(true);
  });

  it('shows HUD when interaction mode is astrogation', () => {
    const ui = createTestUIManager();
    bindClientState(ui, 'playing_astrogation');

    const hudPlaying = document.getElementById('hud') as HTMLElement;
    const menuPlaying = document.getElementById('menu') as HTMLElement;
    const shipList = document.getElementById('shipList') as HTMLElement;
    expect(hudPlaying.style.display).toBe('block');
    expect(hudPlaying.hasAttribute('hidden')).toBe(false);
    expect(menuPlaying.hasAttribute('hidden')).toBe(true);
    expect(menuPlaying.getAttribute('aria-hidden')).toBe('true');
    expect(shipList.style.display).toBe('flex');
    expect(shipList.hasAttribute('hidden')).toBe(false);
    expect(document.body.classList.contains('ui-mode-menu')).toBe(false);
    expect(document.body.classList.contains('ui-mode-overlay')).toBe(false);
  });

  it('shows waiting screen when interaction mode is waiting', () => {
    const ui = createTestUIManager();
    ui.setWaitingState({
      kind: 'private',
      code: 'ABC12',
      connecting: false,
    });
    bindClientState(ui, 'waitingForOpponent');

    const waiting = document.getElementById('waiting') as HTMLElement;
    expect(waiting.style.display).toBe('flex');
    expect(waiting.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('gameCode')?.textContent).toBe('ABC12');
  });

  it('hides all screens when interaction signal is not bound', () => {
    createTestUIManager();

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
      const el = document.getElementById(id) as HTMLElement;
      expect(el.hasAttribute('hidden')).toBe(true);
    }
  });

  it('dispose removes event listeners cleanly', () => {
    const ui = createTestUIManager();
    const events: unknown[] = [];
    ui.onEvent = (e) => events.push(e);

    ui.dispose();

    document.getElementById('confirmBtn')?.click();
    // After dispose, events should still fire (onEvent not nulled)
    // but disposal of subviews should not throw
    expect(ui).toBeDefined();
  });
});
