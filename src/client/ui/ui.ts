import { CODE_LENGTH } from '../../shared/constants';
import type {
  CombatResult,
  FleetPurchase,
  GameState,
  MovementEvent,
  Ship,
} from '../../shared/types';
import { byId, el, hide, show, visible } from '../dom';
import type { UIEvent } from './events';
import { canAddFleetShip, getFleetCartView, getFleetShopView } from './fleet';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
  getLatencyStatus,
  getPhaseAlertCopy,
  parseJoinInput,
} from './formatters';
import { buildHUDView, type HUDInput } from './hud';
import { deriveHudLayoutOffsets } from './layout';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  buildScreenVisibility,
  buildWaitingScreenCopy,
  toggleLogVisible,
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
  private gameLogEl: HTMLElement;
  private logEntriesEl: HTMLElement;
  private chatInputRow: HTMLElement;
  private chatInput: HTMLInputElement;
  private lastPhase: string | null = null;
  private logShowBtn: HTMLElement;
  private fleetBuildingEl: HTMLElement;
  private logVisible = true;
  private logLatestBar: HTMLElement;
  private logLatestText: HTMLElement;
  private isMobile: boolean;
  private logExpandedOnMobile = false;
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
    'skipLogisticsBtn',
    'confirmTransfersBtn',
  ];

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
    this.gameLogEl = byId('gameLog');
    this.logEntriesEl = byId('logEntries');
    this.logShowBtn = byId('logShowBtn');
    this.logLatestBar = byId('logLatestBar');
    this.logLatestText = byId('logLatestText');
    this.chatInputRow = byId('chatInputRow');
    this.chatInput = byId('chatInput') as HTMLInputElement;
    this.fleetBuildingEl = byId('fleetBuilding');

    this.chatInput.addEventListener('keydown', (e) => {
      // Prevent game keyboard shortcuts while
      // typing
      e.stopPropagation();

      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();

        if (text && this.onEvent) {
          this.onEvent({ type: 'chat', text });
          this.chatInput.value = '';
        }
      }
    });

    const mobileQuery = window.matchMedia('(max-width: 760px)');
    this.isMobile = mobileQuery.matches;

    mobileQuery.addEventListener('change', (e) => {
      this.isMobile = e.matches;
      this.syncLogVisibility();
    });

    this.logLatestBar.addEventListener('click', () => {
      this.expandMobileLog();
    });

    window.addEventListener('resize', this.handleViewportResize);
    window.visualViewport?.addEventListener(
      'resize',
      this.handleViewportResize,
    );

    // Wire up buttons
    byId('createBtn').addEventListener('click', () => {
      this.showScenarioSelect();
    });

    byId('singlePlayerBtn').addEventListener('click', () => {
      this.pendingAIGame = true;
      this.showScenarioSelect();
    });

    // Difficulty buttons
    for (const btn of Array.from(
      document.querySelectorAll('.btn-difficulty'),
    )) {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();

        const diff = (btn as HTMLElement).dataset.difficulty as
          | 'easy'
          | 'normal'
          | 'hard';
        this.aiDifficulty = diff;

        // Update active state
        for (const b of Array.from(
          document.querySelectorAll('.btn-difficulty'),
        )) {
          b.classList.remove('active');
        }

        btn.classList.add('active');
      });
    }

    // Scenario buttons — dispatch to multiplayer or
    // AI based on context
    for (const btn of Array.from(document.querySelectorAll('.btn-scenario'))) {
      btn.addEventListener('click', () => {
        const scenario = (btn as HTMLElement).dataset.scenario!;

        if (this.pendingAIGame) {
          this.pendingAIGame = false;
          this.onEvent?.({
            type: 'startSinglePlayer',
            scenario,
            difficulty: this.aiDifficulty,
          });
        } else {
          this.onEvent?.({
            type: 'selectScenario',
            scenario,
          });
        }
      });
    }

    byId('backBtn').addEventListener('click', () => {
      this.onEvent?.({ type: 'backToMenu' });
      this.showMenu();
    });

    byId('joinBtn').addEventListener('click', () => {
      const parsed = parseJoinInput(
        (byId('codeInput') as HTMLInputElement).value,
        CODE_LENGTH,
      );

      if (parsed) {
        this.onEvent?.({
          type: 'join',
          code: parsed.code,
          playerToken: parsed.playerToken,
        });
      }
    });

    byId('codeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const parsed = parseJoinInput(
          (e.target as HTMLInputElement).value,
          CODE_LENGTH,
        );

        if (parsed) {
          this.onEvent?.({
            type: 'join',
            code: parsed.code,
            playerToken: parsed.playerToken,
          });
        }
      }
    });

    byId('copyBtn').addEventListener('click', () => {
      const code = byId('gameCode').textContent;
      const url = this.inviteUrl ?? `${window.location.origin}/?code=${code}`;

      navigator.clipboard?.writeText(url).then(() => {
        byId('copyBtn').textContent = 'Copied!';

        setTimeout(() => {
          byId('copyBtn').textContent = 'Copy Link';
        }, 2000);
      });
    });

    byId('undoBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'undo' }),
    );

    byId('confirmBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'confirm' }),
    );

    byId('launchMineBtn').addEventListener('click', () =>
      this.onEvent?.({
        type: 'launchOrdnance',
        ordType: 'mine',
      }),
    );

    byId('launchTorpedoBtn').addEventListener('click', () =>
      this.onEvent?.({
        type: 'launchOrdnance',
        ordType: 'torpedo',
      }),
    );

    byId('launchNukeBtn').addEventListener('click', () =>
      this.onEvent?.({
        type: 'launchOrdnance',
        ordType: 'nuke',
      }),
    );

    byId('emplaceBaseBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'emplaceBase' }),
    );

    byId('skipOrdnanceBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'skipOrdnance' }),
    );

    byId('attackBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'attack' }),
    );

    byId('fireBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'fireAll' }),
    );

    byId('skipCombatBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'skipCombat' }),
    );

    byId('skipLogisticsBtn').addEventListener('click', () =>
      this.onEvent?.({
        type: 'skipLogistics',
      }),
    );

    byId('confirmTransfersBtn').addEventListener('click', () =>
      this.onEvent?.({
        type: 'confirmTransfers',
      }),
    );

    byId('rematchBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'rematch' }),
    );

    byId('exitBtn').addEventListener('click', () =>
      this.onEvent?.({ type: 'exit' }),
    );

    // Game log toggle
    byId('logToggleBtn').addEventListener('click', () => {
      if (this.isMobile) {
        this.collapseMobileLog();

        return;
      }

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
    if (this.isMobile) {
      if (this.logExpandedOnMobile) {
        this.collapseMobileLog();
      } else {
        this.expandMobileLog();
      }

      return;
    }

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

    byId('helpBtn').style.display = visibility.helpBtn;
    byId('soundBtn').style.display = visibility.soundBtn;
    byId('helpOverlay').style.display = visibility.helpOverlay;
  }

  hideAll() {
    this.applyScreenVisibility('hidden');
    this.logLatestBar.style.display = 'none';
    this.logExpandedOnMobile = false;
    this.gameLogEl.classList.remove('mobile-expanded');
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

    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  showConnecting() {
    this.hideAll();
    this.applyScreenVisibility('waiting');
    this.inviteUrl = null;

    const copy = buildWaitingScreenCopy('', true);

    byId('gameCode').textContent = copy.codeText;
    byId('waitingStatus').textContent = copy.statusText;
  }

  showHUD() {
    this.hideAll();
    this.applyScreenVisibility('hud');

    if (this.isMobile) {
      // On mobile, start with log collapsed —
      // show latest-bar instead
      this.gameLogEl.style.display = 'none';
      this.logShowBtn.style.display = 'none';
      this.logLatestBar.style.display = 'block';
    }

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
    byId('fleetReadyBtn').onclick = () => {
      this.onEvent?.({
        type: 'fleetReady',
        purchases: this.fleetCart,
      });
    };

    byId('fleetClearBtn').onclick = () => {
      this.fleetCart = [];
      this.renderFleetCart(credits);
    };

    hide(byId('fleetWaiting'));
  }

  showFleetWaiting() {
    hide(byId('fleetReadyBtn'));
    hide(byId('fleetClearBtn'));
    show(byId('fleetWaiting'), 'block');
  }

  private renderFleetShop(totalCredits: number) {
    const shopEl = byId('fleetShopList');
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
          this.fleetCart.push({
            shipType: itemView.shipType,
          });
          this.renderFleetCart(totalCredits);

          // Apply recoil animation to cart
          const cartEl = byId('fleetCart');
          cartEl.classList.remove('recoil-anim');
          void cartEl.offsetWidth;
          cartEl.classList.add('recoil-anim');
        }
      });

      shopEl.appendChild(item);
    }
  }

  private renderFleetCart(totalCredits: number) {
    const cartEl = byId('fleetCart');
    const creditsEl = byId('fleetCredits');

    const cartView = getFleetCartView(this.fleetCart, totalCredits);

    creditsEl.textContent = cartView.remainingLabel;
    cartEl.innerHTML = '';

    if (cartView.isEmpty) {
      cartEl.innerHTML =
        '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';

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

    for (const [idx, item] of Array.from(shopItems).entries()) {
      item.classList.toggle('disabled', shopView[idx]?.disabled ?? false);
    }
  }

  updateHUD(input: HUDInput) {
    const hudView = buildHUDView(input);
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
    this.logEntriesEl.innerHTML = '';
  }

  setChatEnabled(enabled: boolean) {
    this.chatInputRow.style.display = enabled ? '' : 'none';
    this.chatInput.value = '';
  }

  logTurn(turn: number, player: string) {
    const text = `\u2014 Turn ${turn}: ${player} \u2014`;

    this.logEntriesEl.appendChild(
      el('div', {
        class: 'log-entry log-turn',
        text,
      }),
    );

    this.scrollLogToBottom();
    this.updateLatestBar(text, 'log-turn');
  }

  logText(text: string, cssClass = '') {
    this.logEntriesEl.appendChild(
      el('div', {
        class: `log-entry ${cssClass}`,
        text,
      }),
    );

    this.scrollLogToBottom();
    this.updateLatestBar(text, cssClass);
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

  private updateLatestBar(text: string, cssClass: string) {
    if (!this.isMobile) return;

    this.logLatestText.textContent = text;
    this.logLatestText.className = `log-latest-text ${cssClass}`;
  }

  private expandMobileLog() {
    this.logExpandedOnMobile = true;
    this.gameLogEl.classList.add('mobile-expanded');
    this.gameLogEl.style.display = 'flex';
    this.logLatestBar.style.display = 'none';
    this.scrollLogToBottom();
  }

  private collapseMobileLog() {
    this.logExpandedOnMobile = false;
    this.gameLogEl.classList.remove('mobile-expanded');
    this.gameLogEl.style.display = 'none';
    this.logLatestBar.style.display = 'block';
  }

  private syncLogVisibility() {
    // Only sync if HUD is active (gameLogEl would
    // be managed)
    if (this.hudEl.style.display === 'none') return;

    if (this.isMobile) {
      // Entering mobile: collapse log to bar
      this.gameLogEl.classList.remove('mobile-expanded');
      this.gameLogEl.style.display = 'none';
      this.logShowBtn.style.display = 'none';
      this.logLatestBar.style.display = 'block';
      this.logExpandedOnMobile = false;
    } else {
      // Entering desktop: restore log panel,
      // hide bar
      this.gameLogEl.classList.remove('mobile-expanded');
      this.logLatestBar.style.display = 'none';
      this.logExpandedOnMobile = false;

      const visibility = buildScreenVisibility('hud', this.logVisible);

      this.gameLogEl.style.display = visibility.gameLog;
      this.logShowBtn.style.display = visibility.logShowBtn;
    }
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
