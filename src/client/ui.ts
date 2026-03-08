import type { Ship } from '../shared/types';
import { SHIP_STATS } from '../shared/constants';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;

  // Callbacks
  onSelectScenario: ((scenario: string) => void) | null = null;
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

    // Wire up buttons
    document.getElementById('createBtn')!.addEventListener('click', () => {
      this.showScenarioSelect();
    });

    // Scenario buttons
    document.querySelectorAll('.btn-scenario').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scenario = (btn as HTMLElement).dataset.scenario!;
        this.onSelectScenario?.(scenario);
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
  }

  hideAll() {
    this.menuEl.style.display = 'none';
    this.scenarioEl.style.display = 'none';
    this.waitingEl.style.display = 'none';
    this.hudEl.style.display = 'none';
    this.gameOverEl.style.display = 'none';
    this.shipListEl.style.display = 'none';
  }

  showMenu() {
    this.hideAll();
    this.menuEl.style.display = 'flex';
  }

  showScenarioSelect() {
    this.hideAll();
    this.scenarioEl.style.display = 'flex';
  }

  showWaiting(code: string) {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('gameCode')!.textContent = code;
    document.getElementById('waitingStatus')!.textContent = 'Waiting for opponent...';
  }

  showConnecting() {
    this.hideAll();
    this.waitingEl.style.display = 'flex';
    document.getElementById('gameCode')!.textContent = '...';
    document.getElementById('waitingStatus')!.textContent = 'Connecting...';
  }

  showHUD() {
    this.hideAll();
    this.hudEl.style.display = 'block';
    this.shipListEl.style.display = 'flex';
  }

  updateHUD(turn: number, phase: string, isMyTurn: boolean, fuel: number, maxFuel: number, hasBurns = false) {
    document.getElementById('turnInfo')!.textContent = `Turn ${turn}`;
    document.getElementById('phaseInfo')!.textContent = isMyTurn ? phase.toUpperCase() : 'OPPONENT\'S TURN';
    document.getElementById('fuelGauge')!.textContent = `Fuel: ${fuel}/${maxFuel}`;

    const undoBtn = document.getElementById('undoBtn')!;
    undoBtn.style.display = isMyTurn && phase === 'astrogation' && hasBurns ? 'inline-block' : 'none';

    const confirmBtn = document.getElementById('confirmBtn')!;
    confirmBtn.style.display = isMyTurn && phase === 'astrogation' ? 'inline-block' : 'none';

    const launchMineBtn = document.getElementById('launchMineBtn')!;
    const launchTorpedoBtn = document.getElementById('launchTorpedoBtn')!;
    const launchNukeBtn = document.getElementById('launchNukeBtn')!;
    const skipOrdnanceBtn = document.getElementById('skipOrdnanceBtn')!;
    launchMineBtn.style.display = isMyTurn && phase === 'ordnance' ? 'inline-block' : 'none';
    launchTorpedoBtn.style.display = isMyTurn && phase === 'ordnance' ? 'inline-block' : 'none';
    launchNukeBtn.style.display = isMyTurn && phase === 'ordnance' ? 'inline-block' : 'none';
    skipOrdnanceBtn.style.display = isMyTurn && phase === 'ordnance' ? 'inline-block' : 'none';

    const skipCombatBtn = document.getElementById('skipCombatBtn')!;
    skipCombatBtn.style.display = isMyTurn && phase === 'combat' ? 'inline-block' : 'none';

    const statusMsg = document.getElementById('statusMsg')!;
    if (!isMyTurn) {
      statusMsg.textContent = 'Waiting for opponent...';
      statusMsg.style.display = 'block';
    } else if (phase === 'astrogation') {
      statusMsg.textContent = 'Select your ship and set a burn direction, then confirm';
      statusMsg.style.display = 'block';
    } else if (phase === 'ordnance') {
      statusMsg.textContent = 'Launch mines or torpedoes, or skip';
      statusMsg.style.display = 'block';
    } else if (phase === 'combat') {
      statusMsg.textContent = 'Combat phase — skip or engage enemy ships';
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
    document.getElementById('confirmBtn')!.style.display = 'none';
  }

  showGameOver(won: boolean, reason: string) {
    this.gameOverEl.style.display = 'flex';
    document.getElementById('gameOverText')!.textContent = won ? 'VICTORY' : 'DEFEAT';
    document.getElementById('gameOverReason')!.textContent = reason;
    document.getElementById('rematchBtn')!.textContent = 'Rematch';
    document.getElementById('rematchBtn')!.removeAttribute('disabled');
  }

  showRematchPending() {
    const btn = document.getElementById('rematchBtn')!;
    btn.textContent = 'Waiting...';
    btn.setAttribute('disabled', 'true');
  }
}
