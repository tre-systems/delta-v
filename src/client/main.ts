import type { GameState, S2C, AstrogationOrder, ShipMovement } from '../shared/types';
import { getSolarSystemMap } from '../shared/map-data';
import { SHIP_STATS } from '../shared/constants';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { UIManager } from './ui';

type ClientState =
  | 'menu'
  | 'connecting'
  | 'waitingForOpponent'
  | 'playing_astrogation'
  | 'playing_combat'
  | 'playing_movementAnim'
  | 'playing_opponentTurn'
  | 'gameOver';

class GameClient {
  private state: ClientState = 'menu';
  private ws: WebSocket | null = null;
  private playerId = -1;
  private gameCode = '';
  private gameState: GameState | null = null;

  private canvas: HTMLCanvasElement;
  renderer: Renderer;
  private input: InputHandler;
  private ui: UIManager;
  private map = getSolarSystemMap();

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);
    this.input = new InputHandler(this.canvas, this.renderer.camera, this.renderer.planningState);
    this.ui = new UIManager();

    this.renderer.setMap(this.map);
    this.input.setMap(this.map);

    // Wire UI callbacks
    this.ui.onCreate = () => this.createGame();
    this.ui.onJoin = (code) => this.joinGame(code);
    this.ui.onConfirm = () => this.confirmOrders();
    this.ui.onSkipCombat = () => this.sendSkipCombat();
    this.ui.onRematch = () => this.sendRematch();
    this.ui.onExit = () => this.exitToMenu();

    // Start render loop
    this.renderer.start();

    // Check for auto-join code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code && code.length === 5) {
      this.joinGame(code.toUpperCase());
    } else {
      this.setState('menu');
    }
  }

  private setState(newState: ClientState) {
    this.state = newState;

    switch (newState) {
      case 'menu':
        this.ui.showMenu();
        // Reset camera to default view centered on the solar system
        this.renderer.resetCamera();
        break;

      case 'connecting':
        this.ui.showConnecting();
        break;

      case 'waitingForOpponent':
        this.ui.showWaiting(this.gameCode);
        break;

      case 'playing_astrogation':
        this.ui.showHUD();
        this.updateHUD();
        // Reset planning state
        this.renderer.planningState.selectedShipId = null;
        this.renderer.planningState.burns.clear();
        // Auto-select the player's first ship
        if (this.gameState) {
          const myShip = this.gameState.ships.find(s => s.owner === this.playerId && !s.destroyed);
          if (myShip) {
            this.renderer.planningState.selectedShipId = myShip.id;
          }
        }
        this.renderer.frameOnShips();
        break;

      case 'playing_combat':
        this.ui.showHUD();
        this.updateHUD();
        break;

      case 'playing_movementAnim':
        this.ui.showHUD();
        this.ui.showMovementStatus();
        break;

      case 'playing_opponentTurn':
        this.ui.showHUD();
        this.updateHUD();
        break;

      case 'gameOver':
        // gameOver overlay is shown via showGameOver
        break;
    }
  }

  // --- Network ---

  private async createGame() {
    try {
      const res = await fetch('/create', { method: 'POST' });
      const data = await res.json() as { code: string };
      this.gameCode = data.code;
      // Update URL
      history.replaceState(null, '', `/?code=${this.gameCode}`);
      this.connect(this.gameCode);
      this.setState('waitingForOpponent');
    } catch (err) {
      console.error('Failed to create game:', err);
    }
  }

  private joinGame(code: string) {
    this.gameCode = code;
    history.replaceState(null, '', `/?code=${code}`);
    this.connect(code);
    this.setState('connecting');
  }

  private connect(code: string) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws/${code}`);
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onclose = () => this.handleDisconnect();
    this.ws.onerror = () => this.handleDisconnect();
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: S2C) {
    switch (msg.type) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.gameCode = msg.code;
        this.renderer.setPlayerId(msg.playerId);
        this.input.setPlayerId(msg.playerId);
        if (this.state === 'connecting') {
          this.setState('waitingForOpponent');
        }
        break;

      case 'matchFound':
        // Game is about to start
        break;

      case 'gameStart':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        if (this.gameState.activePlayer === this.playerId) {
          this.setState('playing_astrogation');
        } else {
          this.setState('playing_opponentTurn');
        }
        break;

      case 'movementResult':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        this.setState('playing_movementAnim');
        this.renderer.animateMovements(msg.movements, () => {
          this.onAnimationComplete();
        });
        break;

      case 'combatResult':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        // After combat resolves, transition based on new state
        this.transitionToPhase();
        break;

      case 'stateUpdate':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        if (this.state !== 'playing_movementAnim') {
          this.transitionToPhase();
        }
        break;

      case 'gameOver':
        this.setState('gameOver');
        this.ui.showGameOver(
          msg.winner === this.playerId,
          msg.reason,
        );
        break;

      case 'opponentDisconnected':
        this.setState('gameOver');
        this.ui.showGameOver(true, 'Opponent disconnected');
        break;

      case 'error':
        console.error('Server error:', msg.message);
        break;

      case 'pong':
        // Latency measurement (unused for now)
        break;
    }
  }

  private handleDisconnect() {
    if (this.state !== 'menu' && this.state !== 'gameOver') {
      this.setState('menu');
    }
  }

  // --- Game actions ---

  private confirmOrders() {
    if (!this.gameState || this.state !== 'playing_astrogation') return;

    const orders: AstrogationOrder[] = [];
    for (const ship of this.gameState.ships) {
      if (ship.owner !== this.playerId) continue;
      orders.push({
        shipId: ship.id,
        burn: this.renderer.planningState.burns.get(ship.id) ?? null,
      });
    }

    this.send({ type: 'astrogation', orders });
  }

  private onAnimationComplete() {
    if (!this.gameState) return;
    this.transitionToPhase();
  }

  private transitionToPhase() {
    if (!this.gameState) return;
    if (this.gameState.phase === 'gameOver') return;

    const isMyTurn = this.gameState.activePlayer === this.playerId;

    if (this.gameState.phase === 'combat' && isMyTurn) {
      this.setState('playing_combat');
    } else if (this.gameState.phase === 'astrogation' && isMyTurn) {
      this.setState('playing_astrogation');
    } else {
      this.setState('playing_opponentTurn');
    }
  }

  private sendSkipCombat() {
    if (!this.gameState || this.state !== 'playing_combat') return;
    this.send({ type: 'skipCombat' });
  }

  private sendRematch() {
    this.send({ type: 'rematch' });
  }

  private exitToMenu() {
    this.ws?.close();
    this.ws = null;
    this.gameState = null;
    history.replaceState(null, '', '/');
    this.setState('menu');
  }

  // --- Helpers ---

  private updateHUD() {
    if (!this.gameState) return;
    const isMyTurn = this.gameState.activePlayer === this.playerId;
    const myShip = this.gameState.ships.find(s => s.owner === this.playerId && !s.destroyed);
    const stats = myShip ? SHIP_STATS[myShip.type] : null;
    this.ui.updateHUD(
      this.gameState.turnNumber,
      this.gameState.phase,
      isMyTurn,
      myShip?.fuel ?? 0,
      stats?.fuel ?? 0,
    );
  }

  // Deserialize state from server (plain object -> proper types)
  private deserializeState(raw: GameState): GameState {
    return raw; // JSON types are already compatible
  }
}

// --- Bootstrap ---
(window as any).__game = new GameClient();
