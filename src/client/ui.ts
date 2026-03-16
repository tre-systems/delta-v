import type { Ship, GameState, FleetPurchase, MovementEvent, CombatResult } from '../shared/types';
import { CODE_LENGTH, ORDNANCE_MASS } from '../shared/constants';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
  getLatencyStatus,
  getPhaseAlertCopy,
  parseJoinInput,
} from './ui-formatters';
import {
  canAddFleetShip,
  getFleetCartView,
  getFleetShopView,
} from './ui-fleet';
import { buildShipListView } from './ui-ship-list';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
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

  constructor() {
    this.menuEl = document.getElementById('menu')!;
    this.scenarioEl = document.getElementById('scenarioSelect')!;
    this.waitingEl = document.getElementById('waiting')!;
    this.hudEl = document.getElementById('hud')!;
    this.gameOverEl = document.getElementById('gameOver')!;
    this.shipListEl = document.getElementById('shipList')!;
    this.gameLogEl = document.getElementById('gameLog')!;
    this.logEntriesEl = document.getElementById('logEntries')!;
    this.logShowBtn = document.getElementById('logShowBtn')!;
    this.fleetBuildingEl = document.getElementById('fleetBuilding')!;

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
        document.querySelectorAll('.btn-difficulty').forEach(b => b.classList.remove('active'));
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
      this.gameLogEl.style.display = 'none';
      this.logShowBtn.style.display = 'block';
    });
    this.logShowBtn.addEventListener('click', () => {
      this.logVisible = true;
      this.gameLogEl.style.display = 'flex';
      this.logShowBtn.style.display = 'none';
    });
  }

  toggleLog() {
    if (this.logVisible) {
      this.logVisible = false;
      this.gameLogEl.style.display = 'none';
      this.logShowBtn.style.display = 'block';
    } else {
      this.logVisible = true;
      this.gameLogEl.style.display = 'flex';
      this.logShowBtn.style.display = 'none';
    }
  }

  hideAll() {
    this.menuEl.style.display = 'none';
    this.scenarioEl.style.display = 'none';
    this.waitingEl.style.display = 'none';
    this.hudEl.style.display = 'none';
    this.gameOverEl.style.display = 'none';
    this.shipListEl.style.display = 'none';
    this.gameLogEl.style.display = 'none';
    this.logShowBtn.style.display = 'none';
    this.fleetBuildingEl.style.display = 'none';
    document.getElementById('helpBtn')!.style.display = 'none';
    document.getElementById('soundBtn')!.style.display = 'none';
    document.getElementById('helpOverlay')!.style.display = 'none';
  }

  setPlayerId(id: number) {
    this.playerId = id;
  }

  showMenu() {
    this.hideAll();
    this.menuEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
    // Reset state
    this.pendingAIGame = false;
  }

  showScenarioSelect() {
    this.hideAll();
    this.scenarioEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
  }

  showWaiting(code: string, inviteUrl: string | null = null) {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
    this.inviteUrl = inviteUrl;
    document.getElementById('gameCode')!.textContent = code;
    document.getElementById('waitingStatus')!.textContent = 'Waiting for opponent...';
  }

  showConnecting() {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
    this.inviteUrl = null;
    document.getElementById('gameCode')!.textContent = '...';
    document.getElementById('waitingStatus')!.textContent = 'Connecting...';
  }

  showHUD() {
    this.hideAll();
    this.hudEl.style.display = 'block';
    this.shipListEl.style.display = 'flex';
    document.getElementById('helpBtn')!.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
    if (this.logVisible) {
      this.gameLogEl.style.display = 'flex';
    } else {
      this.logShowBtn.style.display = 'block';
    }
  }

  showFleetBuilding(state: GameState, playerId: number) {
    this.hideAll();
    this.fleetBuildingEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
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

  updateHUD(turn: number, phase: string, isMyTurn: boolean, fuel: number, maxFuel: number, hasBurns = false, cargoFree = 0, cargoMax = 0, objective = '', isWarship = false, canEmplaceBase = false) {
    document.getElementById('turnInfo')!.textContent = `Turn ${turn}`;
    document.getElementById('phaseInfo')!.textContent = isMyTurn ? phase.toUpperCase() : 'OPPONENT\'S TURN';
    document.getElementById('objective')!.textContent = objective;

    // Trigger phase alert if turn or phase changed
    const phaseKey = `${turn}-${phase}-${isMyTurn}`;
    if (this.lastPhase !== phaseKey) {
      this.lastPhase = phaseKey;
      this.showPhaseAlert(phase, isMyTurn);
    }
    // Show cargo during ordnance phase, fuel otherwise
    if (phase === 'ordnance' && isMyTurn && cargoMax > 0) {
      document.getElementById('fuelGauge')!.textContent = `Cargo: ${cargoFree}/${cargoMax}`;
    } else {
      document.getElementById('fuelGauge')!.textContent = `Fuel: ${fuel}/${maxFuel}`;
    }

    const undoBtn = document.getElementById('undoBtn')!;
    undoBtn.style.display = isMyTurn && phase === 'astrogation' && hasBurns ? 'inline-block' : 'none';

    const confirmBtn = document.getElementById('confirmBtn')!;
    confirmBtn.style.display = isMyTurn && phase === 'astrogation' ? 'inline-block' : 'none';

    const launchMineBtn = document.getElementById('launchMineBtn')! as HTMLButtonElement;
    const launchTorpedoBtn = document.getElementById('launchTorpedoBtn')! as HTMLButtonElement;
    const launchNukeBtn = document.getElementById('launchNukeBtn')! as HTMLButtonElement;
    const emplaceBaseBtn = document.getElementById('emplaceBaseBtn')! as HTMLButtonElement;
    const skipOrdnanceBtn = document.getElementById('skipOrdnanceBtn')!;
    const showOrd = isMyTurn && phase === 'ordnance';
    launchMineBtn.style.display = showOrd ? 'inline-block' : 'none';
    launchTorpedoBtn.style.display = showOrd ? 'inline-block' : 'none';
    launchNukeBtn.style.display = showOrd ? 'inline-block' : 'none';
    emplaceBaseBtn.style.display = showOrd && canEmplaceBase ? 'inline-block' : 'none';
    skipOrdnanceBtn.style.display = showOrd ? 'inline-block' : 'none';
    // Disable buttons based on cargo capacity and warship status
    if (showOrd) {
      const canMine = cargoFree >= ORDNANCE_MASS.mine;
      const canTorpedo = isWarship && cargoFree >= ORDNANCE_MASS.torpedo;
      const canNuke = cargoFree >= ORDNANCE_MASS.nuke;
      launchMineBtn.disabled = !canMine;
      launchTorpedoBtn.disabled = !canTorpedo;
      launchNukeBtn.disabled = !canNuke;
      launchMineBtn.style.opacity = canMine ? '1' : '0.4';
      launchTorpedoBtn.style.opacity = canTorpedo ? '1' : '0.4';
      launchNukeBtn.style.opacity = canNuke ? '1' : '0.4';
      launchTorpedoBtn.title = isWarship ? '' : 'Warships only';
      launchNukeBtn.title = '';
    }

    const skipCombatBtn = document.getElementById('skipCombatBtn')!;
    skipCombatBtn.style.display = isMyTurn && phase === 'combat' ? 'inline-block' : 'none';

    const statusMsg = document.getElementById('statusMsg')!;
    if (!isMyTurn) {
      statusMsg.textContent = 'Waiting for opponent...';
      statusMsg.style.display = 'block';
    } else if (phase === 'astrogation') {
      statusMsg.textContent = 'Select ship · Choose burn direction (1-6) · Confirm (Enter)';
      statusMsg.style.display = 'block';
    } else if (phase === 'ordnance') {
      statusMsg.textContent = 'Launch ordnance or skip (Enter)';
      statusMsg.style.display = 'block';
    } else if (phase === 'combat') {
      statusMsg.textContent = 'Click enemies to target · Fire All to attack (Enter)';
      statusMsg.style.display = 'block';
    } else {
      statusMsg.style.display = 'none';
    }
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
  }

  clearTurnTimer() {
    const timerEl = document.getElementById('turnTimer');
    if (timerEl) {
      timerEl.textContent = '';
    }
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
          const style = row.tone
            ? ` style="color:var(--${row.tone})"`
            : '';
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
  }

  showFireButton(visible: boolean, count: number) {
    const btn = document.getElementById('fireBtn')!;
    btn.style.display = visible ? 'inline-block' : 'none';
    btn.textContent = count > 0 ? `FIRE ALL (${count})` : 'FIRE ALL';
  }

  showMovementStatus() {
    const statusMsg = document.getElementById('statusMsg')!;
    statusMsg.textContent = 'Ships moving...';
    statusMsg.style.display = 'block';
    for (const id of this.actionButtonIds) {
      document.getElementById(id)!.style.display = 'none';
    }
  }

  showGameOver(won: boolean, reason: string, stats?: { turns: number; myShipsAlive: number; myShipsTotal: number; enemyShipsAlive: number; enemyShipsTotal: number }) {
    this.gameOverEl.style.display = 'flex';
    document.getElementById('gameOverText')!.textContent = won ? 'VICTORY' : 'DEFEAT';
    let reasonText = reason;
    if (stats) {
      reasonText += `\n\nTurns: ${stats.turns}`;
      reasonText += ` | Your ships: ${stats.myShipsAlive}/${stats.myShipsTotal}`;
      reasonText += ` | Enemy: ${stats.enemyShipsAlive}/${stats.enemyShipsTotal}`;
    }
    const reasonEl = document.getElementById('gameOverReason')!;
    reasonEl.textContent = reasonText;
    reasonEl.style.whiteSpace = 'pre-line';
    document.getElementById('rematchBtn')!.textContent = 'Rematch';
    document.getElementById('rematchBtn')!.removeAttribute('disabled');
  }

  showRematchPending() {
    const btn = document.getElementById('rematchBtn')!;
    btn.textContent = 'Waiting...';
    btn.setAttribute('disabled', 'true');
  }

  showReconnecting(attempt: number, maxAttempts: number, onCancel: () => void) {
    const overlay = document.getElementById('reconnectOverlay')!;
    overlay.style.display = 'flex';
    document.getElementById('reconnectText')!.textContent = 'Connection lost';
    document.getElementById('reconnectAttempt')!.textContent = `Attempt ${attempt} of ${maxAttempts}`;
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
    }, 2000);
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
}
