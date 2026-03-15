import type { Ship, MovementEvent, CombatResult } from '../shared/types';
import { SHIP_STATS, ORDNANCE_MASS } from '../shared/constants';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;
  private gameLogEl: HTMLElement;
  private logEntriesEl: HTMLElement;
  private logShowBtn: HTMLElement;
  private logVisible = true;
  private readonly actionButtonIds = [
    'undoBtn',
    'confirmBtn',
    'launchMineBtn',
    'launchTorpedoBtn',
    'launchNukeBtn',
    'skipOrdnanceBtn',
    'attackBtn',
    'skipCombatBtn',
  ];

  // Callbacks
  onSelectScenario: ((scenario: string) => void) | null = null;
  onSinglePlayer: ((scenario: string, difficulty: 'easy' | 'normal' | 'hard') => void) | null = null;
  private aiDifficulty: 'easy' | 'normal' | 'hard' = 'normal';
  private pendingAIGame = false; // true when scenario selection is for AI game
  onJoin: ((code: string) => void) | null = null;
  onUndo: (() => void) | null = null;
  onConfirm: (() => void) | null = null;
  onLaunchOrdnance: ((type: 'mine' | 'torpedo' | 'nuke') => void) | null = null;
  onSkipOrdnance: (() => void) | null = null;
  onAttack: (() => void) | null = null;
  onSkipCombat: (() => void) | null = null;
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
      const code = (document.getElementById('codeInput') as HTMLInputElement).value.toUpperCase().trim();
      if (code.length === 5) this.onJoin?.(code);
    });

    document.getElementById('codeInput')!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = (e.target as HTMLInputElement).value.toUpperCase().trim();
        if (code.length === 5) this.onJoin?.(code);
      }
    });

    document.getElementById('copyBtn')!.addEventListener('click', () => {
      const code = document.getElementById('gameCode')!.textContent;
      const url = `${window.location.origin}/?code=${code}`;
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
    document.getElementById('skipOrdnanceBtn')!.addEventListener('click', () => this.onSkipOrdnance?.());
    document.getElementById('attackBtn')!.addEventListener('click', () => this.onAttack?.());
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
    document.getElementById('helpBtn')!.style.display = 'none';
    document.getElementById('soundBtn')!.style.display = 'none';
    document.getElementById('helpOverlay')!.style.display = 'none';
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

  showWaiting(code: string) {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
    document.getElementById('gameCode')!.textContent = code;
    document.getElementById('waitingStatus')!.textContent = 'Waiting for opponent...';
  }

  showConnecting() {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('soundBtn')!.style.display = 'flex';
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

  updateHUD(turn: number, phase: string, isMyTurn: boolean, fuel: number, maxFuel: number, hasBurns = false, cargoFree = 0, cargoMax = 0, objective = '', isWarship = false) {
    document.getElementById('turnInfo')!.textContent = `Turn ${turn}`;
    document.getElementById('phaseInfo')!.textContent = isMyTurn ? phase.toUpperCase() : 'OPPONENT\'S TURN';
    document.getElementById('objective')!.textContent = objective;
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
    const skipOrdnanceBtn = document.getElementById('skipOrdnanceBtn')!;
    const showOrd = isMyTurn && phase === 'ordnance';
    launchMineBtn.style.display = showOrd ? 'inline-block' : 'none';
    launchTorpedoBtn.style.display = showOrd ? 'inline-block' : 'none';
    launchNukeBtn.style.display = showOrd ? 'inline-block' : 'none';
    skipOrdnanceBtn.style.display = showOrd ? 'inline-block' : 'none';
    // Disable buttons based on cargo capacity and warship status
    if (showOrd) {
      const canMine = cargoFree >= ORDNANCE_MASS.mine;
      const canTorpedo = isWarship && cargoFree >= ORDNANCE_MASS.torpedo;
      const canNuke = isWarship && cargoFree >= ORDNANCE_MASS.nuke;
      launchMineBtn.disabled = !canMine;
      launchTorpedoBtn.disabled = !canTorpedo;
      launchNukeBtn.disabled = !canNuke;
      launchMineBtn.style.opacity = canMine ? '1' : '0.4';
      launchTorpedoBtn.style.opacity = canTorpedo ? '1' : '0.4';
      launchNukeBtn.style.opacity = canNuke ? '1' : '0.4';
      launchTorpedoBtn.title = isWarship ? '' : 'Warships only';
      launchNukeBtn.title = isWarship ? '' : 'Warships only';
    }

    const skipCombatBtn = document.getElementById('skipCombatBtn')!;
    skipCombatBtn.style.display = isMyTurn && phase === 'combat' ? 'inline-block' : 'none';

    const statusMsg = document.getElementById('statusMsg')!;
    if (!isMyTurn) {
      statusMsg.textContent = 'Waiting for opponent...';
      statusMsg.style.display = 'block';
    } else if (phase === 'astrogation') {
      statusMsg.textContent = 'Click ship → click direction arrow to burn (1-6 keys) → CONFIRM (Enter)';
      statusMsg.style.display = 'block';
    } else if (phase === 'ordnance') {
      statusMsg.textContent = 'Select ship, set guidance (click arrows), launch ordnance — or SKIP (Enter)';
      statusMsg.style.display = 'block';
    } else if (phase === 'combat') {
      statusMsg.textContent = 'Click enemy ship to target → ATTACK — or SKIP COMBAT (Enter)';
      statusMsg.style.display = 'block';
    } else {
      statusMsg.style.display = 'none';
    }
  }

  updateShipList(ships: Ship[], selectedId: string | null, burns: Map<string, number | null>) {
    this.shipListEl.innerHTML = '';
    // Count ship types for numbering (e.g., "Transport 1", "Transport 2")
    const typeCounts: Record<string, number> = {};
    for (const ship of ships) {
      typeCounts[ship.type] = (typeCounts[ship.type] ?? 0) + 1;
    }
    const typeIndices: Record<string, number> = {};

    for (const ship of ships) {
      const stats = SHIP_STATS[ship.type];
      const name = stats?.name ?? ship.type;
      const needsNumber = (typeCounts[ship.type] ?? 0) > 1;
      typeIndices[ship.type] = (typeIndices[ship.type] ?? 0) + 1;
      const displayName = needsNumber ? `${name} ${typeIndices[ship.type]}` : name;

      const entry = document.createElement('div');
      entry.className = 'ship-entry';
      if (ship.id === selectedId) entry.classList.add('active');
      if (ship.destroyed) entry.classList.add('destroyed');

      const hasBurn = burns.has(ship.id) && burns.get(ship.id) !== null;

      entry.innerHTML = `
        <span class="ship-name">${displayName}</span>
        <span class="ship-status">
          ${ship.destroyed ? 'X' : ship.damage.disabledTurns > 0 ? `D${ship.damage.disabledTurns}` : ''}
          ${hasBurn ? '<span class="burn-dot"></span>' : ''}
        </span>
        <span class="ship-fuel">${ship.destroyed ? '' : `${ship.fuel}/${stats?.fuel ?? '?'}`}</span>
      `;

      // Show expanded details for selected ship
      if (ship.id === selectedId && !ship.destroyed && stats) {
        const details = document.createElement('div');
        details.className = 'ship-details';
        const combat = stats.combat + (stats.defensiveOnly ? 'D' : '');
        const cargo = stats.cargo > 0 ? `Cargo: ${stats.cargo - ship.cargoUsed}/${stats.cargo}` : '';
        const velocity = `Vel: (${ship.velocity.dq},${ship.velocity.dr})`;
        const dmg = ship.damage.disabledTurns > 0 ? `Dmg: ${ship.damage.disabledTurns}T` : '';
        const status = ship.landed ? 'Landed' : '';
        details.innerHTML = `<span>ATK:${combat} ${cargo}</span><span>${velocity} ${dmg} ${status}</span>`;
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
      const ship = ships.find(s => s.id === ev.shipId);
      const name = ship ? (SHIP_STATS[ship.type]?.name ?? ship.type) : ev.shipId;
      let text: string;
      let cls: string;

      switch (ev.type) {
        case 'crash':
          text = `${name} crashed!`;
          cls = 'log-eliminated';
          break;
        case 'ramming':
          text = `${name}: RAMMED [${ev.dieRoll}] ${ev.damageType === 'eliminated' ? '— ELIMINATED' : ev.damageType === 'disabled' ? `— D${ev.disabledTurns}` : '— no damage'}`;
          cls = ev.damageType === 'eliminated' ? 'log-eliminated' : ev.damageType === 'disabled' ? 'log-damage' : '';
          break;
        case 'asteroidHit':
          text = `${name}: asteroid [${ev.dieRoll}] ${ev.damageType === 'eliminated' ? '— ELIMINATED' : ev.damageType === 'disabled' ? `— D${ev.disabledTurns}` : '— miss'}`;
          cls = ev.damageType === 'eliminated' ? 'log-eliminated' : ev.damageType === 'disabled' ? 'log-damage' : '';
          break;
        case 'mineDetonation':
          text = `Mine hit ${name} [${ev.dieRoll}] ${ev.damageType === 'eliminated' ? '— ELIMINATED' : ev.damageType === 'disabled' ? `— D${ev.disabledTurns}` : '— no effect'}`;
          cls = ev.damageType === 'eliminated' ? 'log-eliminated' : ev.damageType === 'disabled' ? 'log-damage' : '';
          break;
        case 'torpedoHit':
          text = `Torpedo hit ${name} [${ev.dieRoll}] ${ev.damageType === 'eliminated' ? '— ELIMINATED' : ev.damageType === 'disabled' ? `— D${ev.disabledTurns}` : '— no effect'}`;
          cls = ev.damageType === 'eliminated' ? 'log-eliminated' : ev.damageType === 'disabled' ? 'log-damage' : '';
          break;
        case 'nukeDetonation':
          text = `NUKE hit ${name} [${ev.dieRoll}] ${ev.damageType === 'eliminated' ? '— ELIMINATED' : ev.damageType === 'disabled' ? `— D${ev.disabledTurns}` : '— no effect'}`;
          cls = ev.damageType === 'eliminated' ? 'log-eliminated' : ev.damageType === 'disabled' ? 'log-damage' : '';
          break;
        default:
          continue;
      }
      this.logText(text, cls);
    }
  }

  logCombatResults(results: CombatResult[], ships: Ship[]) {
    for (const r of results) {
      const target = ships.find(s => s.id === r.targetId);
      const targetName = target ? (SHIP_STATS[target.type]?.name ?? target.type) : r.targetId;
      const result = r.damageType === 'eliminated' ? 'ELIMINATED'
        : r.damageType === 'disabled' ? `D${r.disabledTurns}`
        : 'miss';
      const cls = r.damageType === 'eliminated' ? 'log-eliminated'
        : r.damageType === 'disabled' ? 'log-damage' : '';
      this.logText(`${r.odds} [${r.dieRoll}→${r.modifiedRoll}] ${targetName}: ${result}`, cls);

      if (r.counterattack) {
        const cTarget = ships.find(s => s.id === r.counterattack!.targetId);
        const cName = cTarget ? (SHIP_STATS[cTarget.type]?.name ?? cTarget.type) : r.counterattack.targetId;
        const cResult = r.counterattack.damageType === 'eliminated' ? 'ELIMINATED'
          : r.counterattack.damageType === 'disabled' ? `D${r.counterattack.disabledTurns}`
          : 'miss';
        const cCls = r.counterattack.damageType === 'eliminated' ? 'log-eliminated'
          : r.counterattack.damageType === 'disabled' ? 'log-damage' : '';
        this.logText(`  Counter: ${cName} ${cResult}`, cCls);
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
