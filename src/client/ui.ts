import { CODE_LENGTH } from '../shared/constants';
import type { CombatResult, FleetPurchase, GameState, MovementEvent, Ship } from '../shared/types';
import { canAddFleetShip, getFleetCartView, getFleetShopView } from './ui-fleet';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
  getLatencyStatus,
  getPhaseAlertCopy,
  parseJoinInput,
} from './ui-formatters';
import { buildHUDView } from './ui-hud';
import { deriveHudLayoutOffsets } from './ui-layout';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  buildScreenVisibility,
  buildWaitingScreenCopy,
  toggleLogVisible,
  type UIScreenMode,
} from './ui-screens';
import { buildShipListView } from './ui-ship-list';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private topBarEl: HTMLElement;
  private bottomBarEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;
  private gameLogEl: HTMLElement;
  private logEntriesEl: HTMLElement;
  private lastPhase: string | null = null;
  private logShowBtn: HTMLElement;
  private fleetBuildingEl: HTMLElement;
  private logVisible = true;
  private fleetCart: FleetPurchase[] = [];
  private playerId: number = -1;
  private inviteUrl: string | null = null;
  private layoutSyncFrame: number | null = null;
  private readonly actionButtonIds = [
    'undoBtn',
    'confirmBtn',
    'launchMineBtn',
    'launchTorpedoBtn',
    'launchNukeBtn',
    'emplaceBaseBtn',
    'skipOrdnanceBtn',
    'attackBtn',
    'fireBtn',
    'skipCombatBtn',
  ];

  // Callbacks
  onSelectScenario: ((scenario: string) => void) | null = null;
  onSinglePlayer: ((scenario: string, difficulty: 'easy' | 'normal' | 'hard') => void) | null = null;
  private aiDifficulty: 'easy' | 'normal' | 'hard' = 'normal';
  private pendingAIGame = false; // true when scenario selection is for AI game
  onJoin: ((code: string, playerToken?: string | null) => void) | null = null;
  onUndo: (() => void) | null = null;
  onConfirm: (() => void) | null = null;
  onLaunchOrdnance: ((type: 'mine' | 'torpedo' | 'nuke') => void) | null = null;
  onEmplaceBase: (() => void) | null = null;
  onSkipOrdnance: (() => void) | null = null;
  onAttack: (() => void) | null = null;
  onFireAll: (() => void) | null = null;
  onSkipCombat: (() => void) | null = null;
  onFleetReady: ((purchases: FleetPurchase[]) => void) | null = null;
  onRematch: (() => void) | null = null;
  onExit: (() => void) | null = null;
  onSelectShip: ((shipId: string) => void) | null = null;
  private readonly handleViewportResize = () => {
    this.queueLayoutSync();
  };

  constructor() {
    this.menuEl = document.getElementById('menu')!;
    this.scenarioEl = document.getElementById('scenarioSelect')!;
    this.waitingEl = document.getElementById('waiting')!;
    this.hudEl = document.getElementById('hud')!;
    this.topBarEl = document.getElementById('topBar')!;
    this.bottomBarEl = document.getElementById('bottomBar')!;
    this.gameOverEl = document.getElementById('gameOver')!;
    this.shipListEl = document.getElementById('shipList')!;
    this.gameLogEl = document.getElementById('gameLog')!;
    this.logEntriesEl = document.getElementById('logEntries')!;
    this.logShowBtn = document.getElementById('logShowBtn')!;
    this.fleetBuildingEl = document.getElementById('fleetBuilding')!;
    window.addEventListener('resize', this.handleViewportResize);
    window.visualViewport?.addEventListener('resize', this.handleViewportResize);

    // Wire up buttons
    document.getElementById('createBtn')!.addEventListener('click', () => {
      this.showScenarioSelect();
    });

    document.getElementById('singlePlayerBtn')!.addEventListener('click', () => {
      this.pendingAIGame = true;
      this.showScenarioSelect();
    });

    // Difficulty buttons
    document.querySelectorAll('.btn-difficulty').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const diff = (btn as HTMLElement).dataset.difficulty as 'easy' | 'normal' | 'hard';
        this.aiDifficulty = diff;
        // Update active state
        document.querySelectorAll('.btn-difficulty').forEach((b) => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      });
    });

    // Scenario buttons — dispatch to multiplayer or AI based on context
    document.querySelectorAll('.btn-scenario').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scenario = (btn as HTMLElement).dataset.scenario!;
        if (this.pendingAIGame) {
          this.pendingAIGame = false;
          this.onSinglePlayer?.(scenario, this.aiDifficulty);
        } else {
          this.onSelectScenario?.(scenario);
        }
      });
    });

    document.getElementById('backBtn')!.addEventListener('click', () => {
      this.showMenu();
    });

    document.getElementById('joinBtn')!.addEventListener('click', () => {
      const parsed = parseJoinInput((document.getElementById('codeInput') as HTMLInputElement).value, CODE_LENGTH);
      if (parsed) this.onJoin?.(parsed.code, parsed.playerToken);
    });

    document.getElementById('codeInput')!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const parsed = parseJoinInput((e.target as HTMLInputElement).value, CODE_LENGTH);
        if (parsed) this.onJoin?.(parsed.code, parsed.playerToken);
      }
    });

    document.getElementById('copyBtn')!.addEventListener('click', () => {
      const code = document.getElementById('gameCode')!.textContent;
      const url = this.inviteUrl ?? `${window.location.origin}/?code=${code}`;
      navigator.clipboard?.writeText(url).then(() => {
        document.getElementById('copyBtn')!.textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('copyBtn')!.textContent = 'Copy Link';
        }, 2000);
      });
    });

    document.getElementById('undoBtn')!.addEventListener('click', () => this.onUndo?.());
    document.getElementById('confirmBtn')!.addEventListener('click', () => this.onConfirm?.());
    document.getElementById('launchMineBtn')!.addEventListener('click', () => this.onLaunchOrdnance?.('mine'));
    document.getElementById('launchTorpedoBtn')!.addEventListener('click', () => this.onLaunchOrdnance?.('torpedo'));
    document.getElementById('launchNukeBtn')!.addEventListener('click', () => this.onLaunchOrdnance?.('nuke'));
    document.getElementById('emplaceBaseBtn')!.addEventListener('click', () => this.onEmplaceBase?.());
    document.getElementById('skipOrdnanceBtn')!.addEventListener('click', () => this.onSkipOrdnance?.());
    document.getElementById('attackBtn')!.addEventListener('click', () => this.onAttack?.());
    document.getElementById('fireBtn')!.addEventListener('click', () => this.onFireAll?.());
    document.getElementById('skipCombatBtn')!.addEventListener('click', () => this.onSkipCombat?.());
    document.getElementById('rematchBtn')!.addEventListener('click', () => this.onRematch?.());
    document.getElementById('exitBtn')!.addEventListener('click', () => this.onExit?.());

    // Game log toggle
    document.getElementById('logToggleBtn')!.addEventListener('click', () => {
      this.logVisible = false;
      const visibility = buildScreenVisibility('hud', this.logVisible);
      this.gameLogEl.style.display = visibility.gameLog;
      this.logShowBtn.style.display = visibility.logShowBtn;
    });
    this.logShowBtn.addEventListener('click', () => {
      this.logVisible = true;
      const visibility = buildScreenVisibility('hud', this.logVisible);
      this.gameLogEl.style.display = visibility.gameLog;
      this.logShowBtn.style.display = visibility.logShowBtn;
    });
  }

  toggleLog() {
    this.logVisible = toggleLogVisible(this.logVisible);
    const visibility = buildScreenVisibility('hud', this.logVisible);
    this.gameLogEl.style.display = visibility.gameLog;
    this.logShowBtn.style.display = visibility.logShowBtn;
  }

  private applyScreenVisibility(mode: UIScreenMode) {
    const visibility = buildScreenVisibility(mode, this.logVisible);
    this.menuEl.style.display = visibility.menu;
    this.scenarioEl.style.display = visibility.scenario;
    this.waitingEl.style.display = visibility.waiting;
    this.hudEl.style.display = visibility.hud;
    this.gameOverEl.style.display = visibility.gameOver;
    this.shipListEl.style.display = visibility.shipList;
    this.gameLogEl.style.display = visibility.gameLog;
    this.logShowBtn.style.display = visibility.logShowBtn;
    this.fleetBuildingEl.style.display = visibility.fleetBuilding;
    document.getElementById('helpBtn')!.style.display = visibility.helpBtn;
    document.getElementById('soundBtn')!.style.display = visibility.soundBtn;
    document.getElementById('helpOverlay')!.style.display = visibility.helpOverlay;
  }

  hideAll() {
    this.applyScreenVisibility('hidden');
    this.resetLayoutMetrics();
  }

  setPlayerId(id: number) {
    this.playerId = id;
  }

  showMenu() {
    this.hideAll();
    this.applyScreenVisibility('menu');
    // Reset state
    this.pendingAIGame = false;
  }

  showScenarioSelect() {
    this.hideAll();
    this.applyScreenVisibility('scenario');
  }

  showWaiting(code: string, inviteUrl: string | null = null) {
    this.hideAll();
    this.applyScreenVisibility('waiting');
    this.inviteUrl = inviteUrl;
    const copy = buildWaitingScreenCopy(code, false);
    document.getElementById('gameCode')!.textContent = copy.codeText;
    document.getElementById('waitingStatus')!.textContent = copy.statusText;
  }

  showConnecting() {
    this.hideAll();
    this.applyScreenVisibility('waiting');
    this.inviteUrl = null;
    const copy = buildWaitingScreenCopy('', true);
    document.getElementById('gameCode')!.textContent = copy.codeText;
    document.getElementById('waitingStatus')!.textContent = copy.statusText;
  }

  showHUD() {
    this.hideAll();
    this.applyScreenVisibility('hud');
    this.queueLayoutSync();
  }

  showFleetBuilding(state: GameState, playerId: number) {
    this.hideAll();
    this.applyScreenVisibility('fleetBuilding');
    this.fleetCart = [];

    const player = state.players[playerId];
    const credits = player.credits ?? 0;
    this.renderFleetShop(credits);
    this.renderFleetCart(credits);

    // Wire buttons
    document.getElementById('fleetReadyBtn')!.onclick = () => {
      this.onFleetReady?.(this.fleetCart);
    };
    document.getElementById('fleetClearBtn')!.onclick = () => {
      this.fleetCart = [];
      this.renderFleetCart(credits);
    };
    document.getElementById('fleetWaiting')!.style.display = 'none';
  }

  showFleetWaiting() {
    document.getElementById('fleetReadyBtn')!.style.display = 'none';
    document.getElementById('fleetClearBtn')!.style.display = 'none';
    document.getElementById('fleetWaiting')!.style.display = 'block';
  }

  private renderFleetShop(totalCredits: number) {
    const shopEl = document.getElementById('fleetShopList')!;
    shopEl.innerHTML = '';

    for (const itemView of getFleetShopView(this.fleetCart, totalCredits)) {
      const item = document.createElement('div');
      item.className = 'fleet-shop-item';
      item.classList.toggle('disabled', itemView.disabled);
      item.innerHTML = `
        <div>
          <div class="fleet-shop-name">${itemView.name}</div>
          <div class="fleet-shop-stats">${itemView.statsText}</div>
        </div>
        <div class="fleet-shop-cost">${itemView.cost} MC</div>
      `;
      item.addEventListener('click', () => {
        if (canAddFleetShip(this.fleetCart, totalCredits, itemView.shipType)) {
          this.fleetCart.push({ shipType: itemView.shipType });
          this.renderFleetCart(totalCredits);
          // Apply recoil animation to cart
          const cartEl = document.getElementById('fleetCart')!;
          cartEl.classList.remove('recoil-anim');
          void cartEl.offsetWidth;
          cartEl.classList.add('recoil-anim');
        }
      });
      shopEl.appendChild(item);
    }
  }

  private renderFleetCart(totalCredits: number) {
    const cartEl = document.getElementById('fleetCart')!;
    const creditsEl = document.getElementById('fleetCredits')!;
    const cartView = getFleetCartView(this.fleetCart, totalCredits);
    creditsEl.textContent = cartView.remainingLabel;

    cartEl.innerHTML = '';
    if (cartView.isEmpty) {
      cartEl.innerHTML = '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';
      return;
    }

    for (const [index, itemView] of cartView.items.entries()) {
      const chip = document.createElement('div');
      chip.className = 'fleet-cart-chip';
      chip.innerHTML = `${itemView.label} <span class="chip-remove">\u00d7</span>`;
      chip.addEventListener('click', () => {
        this.fleetCart.splice(index, 1);
        this.renderFleetCart(totalCredits);
      });
      cartEl.appendChild(chip);
    }

    // Update shop item disabled states
    const shopItems = document.querySelectorAll('.fleet-shop-item');
    const shopView = getFleetShopView(this.fleetCart, totalCredits);
    shopItems.forEach((item, idx) => {
      item.classList.toggle('disabled', shopView[idx]?.disabled ?? false);
    });
  }

  updateHUD(
    turn: number,
    phase: string,
    isMyTurn: boolean,
    fuel: number,
    maxFuel: number,
    hasBurns = false,
    cargoFree = 0,
    cargoMax = 0,
    objective = '',
    isWarship = false,
    canEmplaceBase = false,
  ) {
    const hudView = buildHUDView(
      turn,
      phase,
      isMyTurn,
      fuel,
      maxFuel,
      hasBurns,
      cargoFree,
      cargoMax,
      objective,
      isWarship,
      canEmplaceBase,
    );
    document.getElementById('turnInfo')!.textContent = hudView.turnText;
    document.getElementById('phaseInfo')!.textContent = hudView.phaseText;
    document.getElementById('objective')!.textContent = hudView.objectiveText;

    // Trigger phase alert if turn or phase changed
    const phaseKey = `${turn}-${phase}-${isMyTurn}`;
    if (this.lastPhase !== phaseKey) {
      this.lastPhase = phaseKey;
      this.showPhaseAlert(phase, isMyTurn);
    }
    document.getElementById('fuelGauge')!.textContent = hudView.fuelGaugeText;

    const undoBtn = document.getElementById('undoBtn')!;
    undoBtn.style.display = hudView.undoVisible ? 'inline-block' : 'none';

    const confirmBtn = document.getElementById('confirmBtn')!;
    confirmBtn.style.display = hudView.confirmVisible ? 'inline-block' : 'none';

    const launchMineBtn = document.getElementById('launchMineBtn')! as HTMLButtonElement;
    const launchTorpedoBtn = document.getElementById('launchTorpedoBtn')! as HTMLButtonElement;
    const launchNukeBtn = document.getElementById('launchNukeBtn')! as HTMLButtonElement;
    const emplaceBaseBtn = document.getElementById('emplaceBaseBtn')! as HTMLButtonElement;
    const skipOrdnanceBtn = document.getElementById('skipOrdnanceBtn')!;
    launchMineBtn.style.display = hudView.launchMine.visible ? 'inline-block' : 'none';
    launchTorpedoBtn.style.display = hudView.launchTorpedo.visible ? 'inline-block' : 'none';
    launchNukeBtn.style.display = hudView.launchNuke.visible ? 'inline-block' : 'none';
    emplaceBaseBtn.style.display = hudView.emplaceBaseVisible ? 'inline-block' : 'none';
    skipOrdnanceBtn.style.display = hudView.skipOrdnanceVisible ? 'inline-block' : 'none';
    launchMineBtn.disabled = hudView.launchMine.disabled;
    launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
    launchNukeBtn.disabled = hudView.launchNuke.disabled;
    launchMineBtn.style.opacity = hudView.launchMine.opacity;
    launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
    launchNukeBtn.style.opacity = hudView.launchNuke.opacity;
    launchMineBtn.title = hudView.launchMine.title;
    launchTorpedoBtn.title = hudView.launchTorpedo.title;
    launchNukeBtn.title = hudView.launchNuke.title;

    const skipCombatBtn = document.getElementById('skipCombatBtn')!;
    skipCombatBtn.style.display = hudView.skipCombatVisible ? 'inline-block' : 'none';

    const statusMsg = document.getElementById('statusMsg')!;
    if (hudView.statusText) {
      statusMsg.textContent = hudView.statusText;
      statusMsg.style.display = 'block';
    } else {
      statusMsg.style.display = 'none';
    }
    this.queueLayoutSync();
  }

  updateLatency(latencyMs: number | null) {
    const latencyEl = document.getElementById('latencyInfo')!;
    const status = getLatencyStatus(latencyMs);
    latencyEl.textContent = status.text;
    latencyEl.className = status.className;
  }

  updateFleetStatus(status: string) {
    document.getElementById('fleetStatus')!.textContent = status;
  }

  toggleHelpOverlay() {
    const helpOverlay = document.getElementById('helpOverlay')!;
    helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  updateSoundButton(muted: boolean) {
    const btn = document.getElementById('soundBtn')!;
    btn.textContent = muted ? 'OFF' : 'SFX';
    btn.title = muted ? 'Sound off' : 'Sound on';
    btn.setAttribute('aria-label', muted ? 'Enable sound effects' : 'Disable sound effects');
    btn.classList.toggle('muted', muted);
  }

  setTurnTimer(text: string, className: string) {
    const timerEl = document.getElementById('turnTimer')!;
    timerEl.textContent = text;
    timerEl.className = className;
    this.queueLayoutSync();
  }

  clearTurnTimer() {
    const timerEl = document.getElementById('turnTimer');
    if (timerEl) {
      timerEl.textContent = '';
    }
    this.queueLayoutSync();
  }

  updateShipList(ships: Ship[], selectedId: string | null, burns: Map<string, number | null>) {
    this.shipListEl.innerHTML = '';
    const shipListView = buildShipListView(ships, selectedId, burns);

    for (const [index, ship] of ships.entries()) {
      const entryView = shipListView[index];

      const entry = document.createElement('div');
      entry.className = 'ship-entry';
      if (entryView.isSelected) entry.classList.add('active');
      if (entryView.isDestroyed) entry.classList.add('destroyed');

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
        entry.addEventListener('click', () => this.onSelectShip?.(ship.id));
      }

      this.shipListEl.appendChild(entry);
    }
  }

  showAttackButton(visible: boolean) {
    document.getElementById('attackBtn')!.style.display = visible ? 'inline-block' : 'none';
    this.queueLayoutSync();
  }

  showFireButton(visible: boolean, count: number) {
    const btn = document.getElementById('fireBtn')!;
    btn.style.display = visible ? 'inline-block' : 'none';
    btn.textContent = count > 0 ? `FIRE ALL (${count})` : 'FIRE ALL';
    this.queueLayoutSync();
  }

  showMovementStatus() {
    const statusMsg = document.getElementById('statusMsg')!;
    statusMsg.textContent = 'Ships moving...';
    statusMsg.style.display = 'block';
    for (const id of this.actionButtonIds) {
      document.getElementById(id)!.style.display = 'none';
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
    this.gameOverEl.style.display = 'flex';
    document.getElementById('gameOverText')!.textContent = view.titleText;
    const reasonEl = document.getElementById('gameOverReason')!;
    reasonEl.textContent = view.reasonText;
    reasonEl.style.whiteSpace = 'pre-line';
    const rematchBtn = document.getElementById('rematchBtn')!;
    rematchBtn.textContent = view.rematchText;
    rematchBtn.removeAttribute('disabled');
  }

  showRematchPending() {
    const view = buildRematchPendingView();
    const btn = document.getElementById('rematchBtn')!;
    btn.textContent = view.rematchText;
    if (view.rematchDisabled) {
      btn.setAttribute('disabled', 'true');
    }
  }

  showReconnecting(attempt: number, maxAttempts: number, onCancel: () => void) {
    const view = buildReconnectView(attempt, maxAttempts);
    const overlay = document.getElementById('reconnectOverlay')!;
    overlay.style.display = 'flex';
    document.getElementById('reconnectText')!.textContent = view.reconnectText;
    document.getElementById('reconnectAttempt')!.textContent = view.attemptText;
    const cancelBtn = document.getElementById('reconnectCancelBtn')!;
    cancelBtn.onclick = () => {
      this.hideReconnecting();
      onCancel();
    };
  }

  hideReconnecting() {
    document.getElementById('reconnectOverlay')!.style.display = 'none';
  }

  // --- Toast notifications ---

  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    const container = document.getElementById('toastContainer')!;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Remove after animation
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3100);
  }

  showPhaseAlert(phase: string, isMyTurn: boolean) {
    const alertEl = document.getElementById('phaseAlert')!;
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
    this.logEntriesEl.innerHTML = '';
  }

  logTurn(turn: number, player: string) {
    const el = document.createElement('div');
    el.className = 'log-entry log-turn';
    el.textContent = `— Turn ${turn}: ${player} —`;
    this.logEntriesEl.appendChild(el);
    this.scrollLogToBottom();
  }

  logText(text: string, cssClass = '') {
    const el = document.createElement('div');
    el.className = `log-entry ${cssClass}`;
    el.textContent = text;
    this.logEntriesEl.appendChild(el);
    this.scrollLogToBottom();
  }

  logMovementEvents(events: MovementEvent[], ships: Ship[]) {
    for (const ev of events) {
      const entry = formatMovementEventEntry(ev, ships);
      if (entry) this.logText(entry.text, entry.className);
    }
  }

  logCombatResults(results: CombatResult[], ships: Ship[]) {
    for (const r of results) {
      for (const entry of formatCombatResultEntries(r, ships, this.playerId)) {
        this.logText(entry.text, entry.className);
      }
    }
  }

  logLanding(shipName: string, bodyName: string) {
    this.logText(`${shipName} landed at ${bodyName}`, 'log-landed');
  }

  private scrollLogToBottom() {
    this.logEntriesEl.scrollTop = this.logEntriesEl.scrollHeight;
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
    rootStyle.setProperty('--hud-bottom-offset', `${offsets.hudBottomOffsetPx}px`);
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
