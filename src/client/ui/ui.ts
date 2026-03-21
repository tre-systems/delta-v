import { CODE_LENGTH } from '../../shared/constants';
import { SCENARIOS } from '../../shared/map-data';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  Ship,
} from '../../shared/types';
import { byId, el, hide, show, visible } from '../dom';
import { ACTION_BUTTON_IDS, STATIC_BUTTON_BINDINGS } from './button-bindings';
import type { UIEvent } from './events';
import { FleetBuildingView } from './fleet-building-view';
import {
  getLatencyStatus,
  getPhaseAlertCopy,
  parseJoinInput,
} from './formatters';
import { GameLogView } from './game-log-view';
import { buildHUDView, type HUDInput } from './hud';
import { deriveHudLayoutOffsets } from './layout';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  buildScreenVisibility,
  buildWaitingScreenCopy,
  type UIScreenMode,
} from './screens';
import { buildShipListView } from './ship-list';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private topBarEl: HTMLElement;
  private bottomBarEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;
  private lastPhase: string | null = null;
  private fleetBuildingEl: HTMLElement;
  private isMobile: boolean;
  private layoutSyncFrame: number | null = null;

  private readonly actionButtonIds = ACTION_BUTTON_IDS;
  private readonly fleetBuildingView: FleetBuildingView;
  private readonly gameLogView: GameLogView;

  onEvent: ((event: UIEvent) => void) | null = null;

  private aiDifficulty: 'easy' | 'normal' | 'hard' = 'normal';

  // true when scenario selection is for AI game
  private pendingAIGame = false;

  private readonly handleViewportResize = () => {
    this.queueLayoutSync();
  };

  constructor() {
    this.menuEl = byId('menu');
    this.scenarioEl = byId('scenarioSelect');
    this.waitingEl = byId('waiting');
    this.hudEl = byId('hud');
    this.topBarEl = byId('topBar');
    this.bottomBarEl = byId('bottomBar');
    this.gameOverEl = byId('gameOver');
    this.shipListEl = byId('shipList');
    this.fleetBuildingEl = byId('fleetBuilding');
    this.fleetBuildingView = new FleetBuildingView({
      onFleetReady: (purchases) => {
        this.emit({ type: 'fleetReady', purchases });
      },
    });
    this.gameLogView = new GameLogView({
      onChat: (text) => {
        this.emit({ type: 'chat', text });
      },
    });

    const mobileQuery = window.matchMedia('(max-width: 760px)');
    this.isMobile = mobileQuery.matches;
    this.gameLogView.setMobile(
      this.isMobile,
      this.hudEl.style.display !== 'none',
    );

    mobileQuery.addEventListener('change', (e) => {
      this.isMobile = e.matches;
      this.gameLogView.setMobile(
        e.matches,
        this.hudEl.style.display !== 'none',
      );
    });

    window.addEventListener('resize', this.handleViewportResize);
    window.visualViewport?.addEventListener(
      'resize',
      this.handleViewportResize,
    );

    this.bindMenuControls();
    this.bindDifficultyButtons();
    // Generate scenario buttons from data
    this.buildScenarioList();
    this.bindJoinControls();
    this.bindCopyButton();
    this.bindStaticButtons();
  }

  private emit(event: UIEvent) {
    this.onEvent?.(event);
  }

  private bindMenuControls() {
    byId('createBtn').addEventListener('click', () => {
      this.showScenarioSelect();
    });

    byId('singlePlayerBtn').addEventListener('click', () => {
      this.pendingAIGame = true;
      this.showScenarioSelect();
    });

    byId('backBtn').addEventListener('click', () => {
      this.emit({ type: 'backToMenu' });
      this.showMenu();
    });
  }

  private bindDifficultyButtons() {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>('.btn-difficulty'),
    );

    for (const btn of buttons) {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();

        const diff = btn.dataset.difficulty as 'easy' | 'normal' | 'hard';
        this.aiDifficulty = diff;

        for (const button of buttons) {
          button.classList.remove('active');
        }

        btn.classList.add('active');
      });
    }
  }

  private submitJoin(rawValue: string) {
    const parsed = parseJoinInput(rawValue, CODE_LENGTH);

    if (!parsed) {
      return;
    }

    this.emit({
      type: 'join',
      code: parsed.code,
      playerToken: parsed.playerToken,
    });
  }

  private bindJoinControls() {
    byId('joinBtn').addEventListener('click', () => {
      this.submitJoin((byId('codeInput') as HTMLInputElement).value);
    });

    byId('codeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.submitJoin((e.target as HTMLInputElement).value);
      }
    });
  }

  private bindCopyButton() {
    byId('copyBtn').addEventListener('click', () => {
      const code = byId('gameCode').textContent;
      const url = `${window.location.origin}/?code=${code}`;

      navigator.clipboard?.writeText(url).then(() => {
        byId('copyBtn').textContent = 'Copied!';

        setTimeout(() => {
          byId('copyBtn').textContent = 'Copy Link';
        }, 2000);
      });
    });
  }

  private bindStaticButtons() {
    for (const binding of STATIC_BUTTON_BINDINGS) {
      byId(binding.id).addEventListener('click', () => {
        this.emit(binding.event);
      });
    }
  }

  toggleLog() {
    this.gameLogView.toggle();
  }

  private applyScreenVisibility(mode: UIScreenMode) {
    const visibility = buildScreenVisibility(mode, true);

    this.menuEl.style.display = visibility.menu;
    this.scenarioEl.style.display = visibility.scenario;
    this.waitingEl.style.display = visibility.waiting;
    this.hudEl.style.display = visibility.hud;
    this.gameOverEl.style.display = visibility.gameOver;
    this.shipListEl.style.display = visibility.shipList;
    this.fleetBuildingEl.style.display = visibility.fleetBuilding;
    this.gameLogView.applyScreenVisibility(mode);

    byId('helpBtn').style.display = visibility.helpBtn;
    byId('soundBtn').style.display = visibility.soundBtn;
    byId('helpOverlay').style.display = visibility.helpOverlay;
  }

  hideAll() {
    this.applyScreenVisibility('hidden');
    this.gameLogView.resetVisibilityState();
    this.resetLayoutMetrics();
  }

  setPlayerId(id: number) {
    this.gameLogView.setPlayerId(id);
  }

  private buildScenarioList() {
    const container = byId('scenarioList');

    for (const [key, def] of Object.entries(SCENARIOS)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-scenario';
      btn.dataset.scenario = key;

      const tags = (def.tags ?? [])
        .map((t) => `<span class="scenario-tag">${t}</span>`)
        .join('');

      btn.innerHTML =
        `<div class="scenario-name">${def.name}${tags}</div>` +
        `<div class="scenario-desc">${def.description}</div>`;

      btn.addEventListener('click', () => {
        if (this.pendingAIGame) {
          this.pendingAIGame = false;
          this.onEvent?.({
            type: 'startSinglePlayer',
            scenario: key,
            difficulty: this.aiDifficulty,
          });
        } else {
          this.onEvent?.({
            type: 'selectScenario',
            scenario: key,
          });
        }
      });

      container.appendChild(btn);
    }
  }

  showMenu() {
    this.hideAll();
    this.applyScreenVisibility('menu');
    // Reset state
    this.pendingAIGame = false;
  }

  setMenuLoading(loading: boolean) {
    const btn = byId<HTMLButtonElement>('createBtn');

    btn.disabled = loading;
    btn.textContent = loading ? 'CREATING...' : 'Create Game';
  }

  showScenarioSelect() {
    this.hideAll();
    this.applyScreenVisibility('scenario');
  }

  showWaiting(code: string) {
    this.hideAll();
    this.applyScreenVisibility('waiting');

    const copy = buildWaitingScreenCopy(code, false);

    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  showConnecting() {
    this.hideAll();
    this.applyScreenVisibility('waiting');

    const copy = buildWaitingScreenCopy('', true);

    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  showHUD() {
    this.hideAll();
    this.applyScreenVisibility('hud');
    this.gameLogView.showHUD();
    this.queueLayoutSync();
  }

  showFleetBuilding(state: GameState, playerId: number) {
    this.hideAll();
    this.applyScreenVisibility('fleetBuilding');
    this.fleetBuildingView.show(state, playerId);
  }

  showFleetWaiting() {
    this.fleetBuildingView.showWaiting();
  }

  updateHUD(input: Omit<HUDInput, 'isMobile'>) {
    const hudView = buildHUDView({
      ...input,
      isMobile: this.isMobile,
    });
    const { turn, phase, isMyTurn } = input;

    byId('turnInfo').textContent = hudView.turnText;
    byId('phaseInfo').textContent = hudView.phaseText;
    byId('objective').textContent = hudView.objectiveText;

    // Trigger phase alert if turn or phase changed
    const phaseKey = `${turn}-${phase}-${isMyTurn}`;

    if (this.lastPhase !== phaseKey) {
      this.lastPhase = phaseKey;
      this.showPhaseAlert(phase, isMyTurn);
    }

    byId('fuelGauge').textContent = hudView.fuelGaugeText;

    visible(byId('undoBtn'), hudView.undoVisible, 'inline-block');
    visible(byId('confirmBtn'), hudView.confirmVisible, 'inline-block');

    const launchMineBtn = byId<HTMLButtonElement>('launchMineBtn');
    const launchTorpedoBtn = byId<HTMLButtonElement>('launchTorpedoBtn');
    const launchNukeBtn = byId<HTMLButtonElement>('launchNukeBtn');
    const emplaceBaseBtn = byId<HTMLButtonElement>('emplaceBaseBtn');

    visible(launchMineBtn, hudView.launchMine.visible, 'inline-block');
    visible(launchTorpedoBtn, hudView.launchTorpedo.visible, 'inline-block');
    visible(launchNukeBtn, hudView.launchNuke.visible, 'inline-block');
    visible(emplaceBaseBtn, hudView.emplaceBaseVisible, 'inline-block');
    visible(
      byId('skipOrdnanceBtn'),
      hudView.skipOrdnanceVisible,
      'inline-block',
    );

    launchMineBtn.disabled = hudView.launchMine.disabled;
    launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
    launchNukeBtn.disabled = hudView.launchNuke.disabled;

    launchMineBtn.style.opacity = hudView.launchMine.opacity;
    launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
    launchNukeBtn.style.opacity = hudView.launchNuke.opacity;

    launchMineBtn.title = hudView.launchMine.title;
    launchTorpedoBtn.title = hudView.launchTorpedo.title;
    launchNukeBtn.title = hudView.launchNuke.title;

    visible(byId('skipCombatBtn'), hudView.skipCombatVisible, 'inline-block');
    visible(
      byId('skipLogisticsBtn'),
      hudView.skipLogisticsVisible,
      'inline-block',
    );
    visible(
      byId('confirmTransfersBtn'),
      hudView.confirmTransfersVisible,
      'inline-block',
    );
    visible(byId('transferPanel'), hudView.showTransferPanel, 'block');

    const statusMsg = byId('statusMsg');

    if (hudView.statusText) {
      statusMsg.textContent = hudView.statusText;
      show(statusMsg, 'block');
    } else {
      hide(statusMsg);
    }

    this.queueLayoutSync();
  }

  updateLatency(latencyMs: number | null) {
    const latencyEl = byId('latencyInfo');
    const status = getLatencyStatus(latencyMs);

    latencyEl.textContent = status.text;
    latencyEl.className = status.className;
  }

  updateFleetStatus(status: string) {
    byId('fleetStatus').textContent = status;
  }

  toggleHelpOverlay() {
    const helpOverlay = byId('helpOverlay');

    visible(helpOverlay, helpOverlay.style.display === 'none', 'flex');
  }

  updateSoundButton(muted: boolean) {
    const btn = byId('soundBtn');
    btn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    btn.title = muted ? 'Sound off' : 'Sound on';
    btn.setAttribute(
      'aria-label',
      muted ? 'Enable sound effects' : 'Disable sound effects',
    );
    btn.classList.toggle('muted', muted);
  }

  setTurnTimer(text: string, className: string) {
    const timerEl = byId('turnTimer');
    timerEl.textContent = text;
    timerEl.className = className;
    this.queueLayoutSync();
  }

  clearTurnTimer() {
    const timerEl = byId('turnTimer');

    if (timerEl) {
      timerEl.textContent = '';
    }

    this.queueLayoutSync();
  }

  updateShipList(
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) {
    this.shipListEl.innerHTML = '';

    const shipListView = buildShipListView(ships, selectedId, burns);

    for (const [index, ship] of ships.entries()) {
      const entryView = shipListView[index];

      const entry = document.createElement('div');
      entry.className = 'ship-entry';
      if (entryView.isSelected) {
        entry.classList.add('active');
      }
      if (entryView.isDestroyed) {
        entry.classList.add('destroyed');
      }

      entry.innerHTML = `
        <span class="ship-name">${entryView.displayName}</span>
        <span class="ship-status">
          ${entryView.statusText}
          ${entryView.hasBurn ? '<span class="burn-dot"></span>' : ''}
        </span>
        <span class="ship-fuel">${entryView.fuelText}</span>
      `;

      // Show expanded details for selected ship
      if (entryView.detailRows.length > 0) {
        const details = document.createElement('div');
        details.className = 'ship-details';

        const rows = entryView.detailRows.map((row) => {
          const style = row.tone ? ` style="color:var(--${row.tone})"` : '';

          return `<div class="ship-detail-row"><span class="ship-detail-label">${row.label}</span><span class="ship-detail-value"${style}>${row.value}</span></div>`;
        });

        details.innerHTML = rows.join('');
        entry.appendChild(details);
      }

      if (!ship.destroyed) {
        entry.addEventListener('click', () =>
          this.onEvent?.({
            type: 'selectShip',
            shipId: ship.id,
          }),
        );
      }

      this.shipListEl.appendChild(entry);
    }
  }

  showAttackButton(isVisible: boolean) {
    visible(byId('attackBtn'), isVisible, 'inline-block');
    this.queueLayoutSync();
  }

  showFireButton(isVisible: boolean, count: number) {
    const btn = byId('fireBtn');

    visible(btn, isVisible, 'inline-block');

    btn.textContent = count > 0 ? `FIRE ALL (${count})` : 'FIRE ALL';

    this.queueLayoutSync();
  }

  showMovementStatus() {
    const statusMsg = byId('statusMsg');
    statusMsg.textContent = 'Ships moving...';
    show(statusMsg, 'block');

    for (const id of this.actionButtonIds) {
      hide(byId(id));
    }

    this.queueLayoutSync();
  }

  showGameOver(
    won: boolean,
    reason: string,
    stats?: {
      turns: number;
      myShipsAlive: number;
      myShipsTotal: number;
      enemyShipsAlive: number;
      enemyShipsTotal: number;
    },
  ) {
    const view = buildGameOverView(won, reason, stats);

    show(this.gameOverEl, 'flex');

    byId('gameOverText').textContent = view.titleText;

    const reasonEl = byId('gameOverReason');
    reasonEl.textContent = view.reasonText;
    reasonEl.style.whiteSpace = 'pre-line';

    const rematchBtn = byId('rematchBtn');
    rematchBtn.textContent = view.rematchText;
    rematchBtn.removeAttribute('disabled');
  }

  showRematchPending() {
    const view = buildRematchPendingView();
    const btn = byId('rematchBtn');
    btn.textContent = view.rematchText;

    if (view.rematchDisabled) {
      btn.setAttribute('disabled', 'true');
    }
  }

  showReconnecting(attempt: number, maxAttempts: number, onCancel: () => void) {
    const view = buildReconnectView(attempt, maxAttempts);
    const overlay = byId('reconnectOverlay');

    show(overlay, 'flex');

    byId('reconnectText').textContent = view.reconnectText;
    byId('reconnectAttempt').textContent = view.attemptText;

    const cancelBtn = byId('reconnectCancelBtn');
    cancelBtn.onclick = () => {
      this.hideReconnecting();
      onCancel();
    };
  }

  hideReconnecting() {
    hide(byId('reconnectOverlay'));
  }

  // --- Toast notifications ---

  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    const container = byId('toastContainer');

    const toast = el('div', {
      class: `toast toast-${type}`,
      text: message,
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3100);
  }

  showPhaseAlert(phase: string, isMyTurn: boolean) {
    const alertEl = byId('phaseAlert');

    const titleEl = alertEl.querySelector('.phase-alert-title') as HTMLElement;
    const subEl = alertEl.querySelector('.phase-alert-subtitle') as HTMLElement;

    const copy = getPhaseAlertCopy(phase, isMyTurn);
    titleEl.textContent = copy.title;
    subEl.textContent = copy.subtitle;
    subEl.style.color = copy.subtitleColor;

    alertEl.classList.remove('active');
    void alertEl.offsetWidth; // trigger reflow
    alertEl.classList.add('active');

    setTimeout(() => {
      alertEl.classList.remove('active');
    }, 1200);
  }

  // --- Game log ---

  clearLog() {
    this.gameLogView.clear();
  }

  setChatEnabled(enabled: boolean) {
    this.gameLogView.setChatEnabled(enabled);
  }

  logTurn(turn: number, player: string) {
    this.gameLogView.logTurn(turn, player);
  }

  logText(text: string, cssClass = '') {
    this.gameLogView.logText(text, cssClass);
  }

  logMovementEvents(events: MovementEvent[], ships: Ship[]) {
    this.gameLogView.logMovementEvents(events, ships);
  }

  logCombatResults(results: CombatResult[], ships: Ship[]) {
    this.gameLogView.logCombatResults(results, ships);
  }

  logLanding(shipName: string, bodyName: string) {
    this.gameLogView.logLanding(shipName, bodyName);
  }

  private queueLayoutSync() {
    if (this.layoutSyncFrame !== null) return;

    this.layoutSyncFrame = window.requestAnimationFrame(() => {
      this.layoutSyncFrame = null;
      this.syncLayoutMetrics();
    });
  }

  private syncLayoutMetrics() {
    if (this.hudEl.style.display === 'none') {
      this.resetLayoutMetrics();

      return;
    }

    const offsets = deriveHudLayoutOffsets(
      window.innerHeight,
      this.topBarEl.getBoundingClientRect(),
      this.bottomBarEl.getBoundingClientRect(),
    );

    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--hud-top-offset', `${offsets.hudTopOffsetPx}px`);
    rootStyle.setProperty(
      '--hud-bottom-offset',
      `${offsets.hudBottomOffsetPx}px`,
    );
  }

  private resetLayoutMetrics() {
    if (this.layoutSyncFrame !== null) {
      window.cancelAnimationFrame(this.layoutSyncFrame);
      this.layoutSyncFrame = null;
    }

    const rootStyle = document.documentElement.style;

    rootStyle.removeProperty('--hud-top-offset');
    rootStyle.removeProperty('--hud-bottom-offset');
  }
}
