export class UIManager {
  private menuEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private gameOverEl: HTMLElement;

  // Callbacks
  onCreate: (() => void) | null = null;
  onJoin: ((code: string) => void) | null = null;
  onConfirm: (() => void) | null = null;
  onRematch: (() => void) | null = null;
  onExit: (() => void) | null = null;

  constructor() {
    this.menuEl = document.getElementById('menu')!;
    this.waitingEl = document.getElementById('waiting')!;
    this.hudEl = document.getElementById('hud')!;
    this.gameOverEl = document.getElementById('gameOver')!;

    // Wire up buttons
    document.getElementById('createBtn')!.addEventListener('click', () => this.onCreate?.());

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

    document.getElementById('confirmBtn')!.addEventListener('click', () => this.onConfirm?.());
    document.getElementById('rematchBtn')!.addEventListener('click', () => this.onRematch?.());
    document.getElementById('exitBtn')!.addEventListener('click', () => this.onExit?.());
  }

  hideAll() {
    this.menuEl.style.display = 'none';
    this.waitingEl.style.display = 'none';
    this.hudEl.style.display = 'none';
    this.gameOverEl.style.display = 'none';
  }

  showMenu() {
    this.hideAll();
    this.menuEl.style.display = 'flex';
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
  }

  updateHUD(turn: number, phase: string, isMyTurn: boolean, fuel: number, maxFuel: number) {
    document.getElementById('turnInfo')!.textContent = `Turn ${turn}`;
    document.getElementById('phaseInfo')!.textContent = isMyTurn ? phase.toUpperCase() : 'OPPONENT\'S TURN';
    document.getElementById('fuelGauge')!.textContent = `Fuel: ${fuel}/${maxFuel}`;

    const confirmBtn = document.getElementById('confirmBtn')!;
    confirmBtn.style.display = isMyTurn && phase === 'astrogation' ? 'inline-block' : 'none';

    const statusMsg = document.getElementById('statusMsg')!;
    if (!isMyTurn) {
      statusMsg.textContent = 'Waiting for opponent...';
      statusMsg.style.display = 'block';
    } else if (phase === 'astrogation') {
      statusMsg.textContent = 'Select your ship and set a burn direction, then confirm';
      statusMsg.style.display = 'block';
    } else {
      statusMsg.style.display = 'none';
    }
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
  }
}
