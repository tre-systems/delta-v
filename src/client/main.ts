import type { GameState, S2C, AstrogationOrder, OrdnanceLaunch, CombatAttack } from '../shared/types';
import { canAttack } from '../shared/combat';
import { getSolarSystemMap } from '../shared/map-data';
import { SHIP_STATS, ORDNANCE_MASS } from '../shared/constants';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { UIManager } from './ui';
import { initAudio, playSelect, playConfirm, playThrust, playCombat, playExplosion, playPhaseChange, playVictory, playDefeat } from './audio';

type ClientState =
  | 'menu'
  | 'connecting'
  | 'waitingForOpponent'
  | 'playing_astrogation'
  | 'playing_ordnance'
  | 'playing_combat'
  | 'playing_movementAnim'
  | 'playing_opponentTurn'
  | 'gameOver';

class GameClient {
  private state: ClientState = 'menu';
  private ws: WebSocket | null = null;
  private playerId = -1;
  private gameCode = '';
  private scenario = 'biplanetary';
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
    this.ui.onSelectScenario = (scenario) => this.createGame(scenario);
    this.ui.onJoin = (code) => this.joinGame(code);
    this.ui.onUndo = () => this.undoSelectedShipBurn();
    this.ui.onConfirm = () => this.confirmOrders();
    this.ui.onLaunchOrdnance = (ordType) => this.sendOrdnanceLaunch(ordType);
    this.ui.onSkipOrdnance = () => this.sendSkipOrdnance();
    this.ui.onAttack = () => this.sendAttack();
    this.ui.onSkipCombat = () => this.sendSkipCombat();
    this.ui.onRematch = () => this.sendRematch();
    this.ui.onExit = () => this.exitToMenu();
    this.ui.onSelectShip = (shipId) => {
      this.renderer.planningState.selectedShipId = shipId;
      this.updateHUD();
      // Center camera on selected ship
      const ship = this.gameState?.ships.find(s => s.id === shipId);
      if (ship) this.renderer.centerOnHex(ship.position);
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && this.gameState &&
          (this.state === 'playing_astrogation' || this.state === 'playing_ordnance' || this.state === 'playing_combat')) {
        e.preventDefault();
        this.cycleShip(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        // Deselect ship and clear targets
        if (this.renderer.planningState.combatTargetId) {
          this.renderer.planningState.combatTargetId = null;
          this.ui.showAttackButton(false);
        } else if (this.renderer.planningState.torpedoAccel !== null) {
          this.renderer.planningState.torpedoAccel = null;
        } else {
          this.renderer.planningState.selectedShipId = null;
          this.updateHUD();
        }
      }
    });

    // Start render loop and audio
    initAudio();
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
        this.renderer.planningState.overloads.clear();
        this.renderer.planningState.weakGravityChoices.clear();
        // Auto-select the player's first ship
        if (this.gameState) {
          const myShip = this.gameState.ships.find(s => s.owner === this.playerId && !s.destroyed);
          if (myShip) {
            this.renderer.planningState.selectedShipId = myShip.id;
          }
        }
        this.renderer.frameOnShips();
        break;

      case 'playing_ordnance':
        this.ui.showHUD();
        this.updateHUD();
        this.renderer.planningState.selectedShipId = null;
        // Auto-select first ship that can launch ordnance
        if (this.gameState) {
          const launchable = this.gameState.ships.find(s =>
            s.owner === this.playerId && !s.destroyed && !s.landed &&
            s.damage.disabledTurns === 0 && this.canLaunchOrdnance(s),
          );
          if (launchable) {
            this.renderer.planningState.selectedShipId = launchable.id;
          }
        }
        break;

      case 'playing_combat':
        this.ui.showHUD();
        this.updateHUD();
        this.renderer.planningState.combatTargetId = null;
        this.ui.showAttackButton(false);
        this.startCombatTargetWatch();
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

  private async createGame(scenario: string) {
    try {
      this.scenario = scenario;
      const res = await fetch('/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
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

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: number | null = null;

  private connect(code: string) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${location.host}/ws/${code}`;
    if (this.scenario && this.scenario !== 'biplanetary') {
      url += `?scenario=${this.scenario}`;
    }
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onclose = () => this.handleDisconnect();
    this.ws.onerror = () => {}; // onclose fires after onerror
  }

  private attemptReconnect() {
    if (!this.gameCode || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('menu');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
    this.ui.showReconnecting(this.reconnectAttempts);
    this.reconnectTimer = window.setTimeout(() => {
      this.connect(this.gameCode!);
    }, delay);
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
        this.reconnectAttempts = 0; // Reset on successful connection
        this.renderer.setPlayerId(msg.playerId);
        this.input.setPlayerId(msg.playerId);
        if (this.state === 'connecting') {
          this.setState('waitingForOpponent');
        }
        break;

      case 'matchFound':
        playPhaseChange();
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
        playThrust();
        if (msg.events.length > 0) {
          this.renderer.showMovementEvents(msg.events);
          // Play explosion sound for destructive events
          const hasDestruction = msg.events.some(e => e.damageType === 'eliminated' || e.type === 'crash');
          if (hasDestruction) setTimeout(() => playExplosion(), 500);
        }
        this.renderer.animateMovements(msg.movements, msg.ordnanceMovements, () => {
          this.onAnimationComplete();
        });
        break;

      case 'combatResult':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        this.renderer.showCombatResults(msg.results);
        this.renderer.planningState.combatTargetId = null;
        playCombat();
        if (msg.results.some(r => r.damageType === 'eliminated')) {
          setTimeout(() => playExplosion(), 300);
        }
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
        if (msg.winner === this.playerId) {
          playVictory();
        } else {
          playDefeat();
        }
        break;

      case 'rematchPending':
        this.ui.showRematchPending();
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
    if (this.state === 'menu' || this.state === 'gameOver') return;

    // If we have an active game, attempt reconnection
    if (this.gameCode && this.gameState) {
      this.attemptReconnect();
    } else {
      this.setState('menu');
    }
  }

  // --- Game actions ---

  private undoSelectedShipBurn() {
    if (!this.gameState || this.state !== 'playing_astrogation') return;
    const shipId = this.renderer.planningState.selectedShipId;
    if (shipId) {
      this.renderer.planningState.burns.delete(shipId);
      this.renderer.planningState.overloads.delete(shipId);
      this.renderer.planningState.weakGravityChoices.delete(shipId);
    }
    this.updateHUD();
  }

  private confirmOrders() {
    if (!this.gameState || this.state !== 'playing_astrogation') return;

    const orders: AstrogationOrder[] = [];
    for (const ship of this.gameState.ships) {
      if (ship.owner !== this.playerId) continue;
      const burn = this.renderer.planningState.burns.get(ship.id) ?? null;
      const overload = this.renderer.planningState.overloads.get(ship.id) ?? null;
      const wgChoices = this.renderer.planningState.weakGravityChoices.get(ship.id);
      const order: AstrogationOrder = { shipId: ship.id, burn };
      if (overload !== null) order.overload = overload;
      if (wgChoices && Object.keys(wgChoices).length > 0) order.weakGravityChoices = wgChoices;
      orders.push(order);
    }

    playConfirm();
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
      playPhaseChange();
    } else if (this.gameState.phase === 'ordnance' && isMyTurn) {
      this.setState('playing_ordnance');
      playPhaseChange();
    } else if (this.gameState.phase === 'astrogation' && isMyTurn) {
      this.setState('playing_astrogation');
      playPhaseChange();
    } else {
      this.setState('playing_opponentTurn');
    }
  }

  private sendAttack() {
    if (!this.gameState || this.state !== 'playing_combat') return;
    const targetId = this.renderer.planningState.combatTargetId;
    if (!targetId) return;

    const attackerIds = this.gameState.ships
      .filter(s => s.owner === this.playerId && !s.destroyed && canAttack(s))
      .map(s => s.id);

    if (attackerIds.length === 0) return;

    const attacks: CombatAttack[] = [{ attackerIds, targetId }];
    this.send({ type: 'combat', attacks });
  }

  private combatWatchInterval: number | null = null;

  private startCombatTargetWatch() {
    if (this.combatWatchInterval) clearInterval(this.combatWatchInterval);
    this.combatWatchInterval = window.setInterval(() => {
      if (this.state !== 'playing_combat') {
        if (this.combatWatchInterval) clearInterval(this.combatWatchInterval);
        this.combatWatchInterval = null;
        return;
      }
      const hasTarget = this.renderer.planningState.combatTargetId !== null;
      this.ui.showAttackButton(hasTarget);
    }, 100);
  }

  private sendOrdnanceLaunch(ordType: 'mine' | 'torpedo' | 'nuke') {
    if (!this.gameState || this.state !== 'playing_ordnance') return;
    const selectedId = this.renderer.planningState.selectedShipId;
    if (!selectedId) return;

    const ship = this.gameState.ships.find(s => s.id === selectedId);
    if (!ship) return;

    const launch: OrdnanceLaunch = {
      shipId: selectedId,
      ordnanceType: ordType,
    };

    // For torpedoes and nukes, use the selected guidance direction (if any)
    if (ordType === 'torpedo' || ordType === 'nuke') {
      launch.torpedoAccel = this.renderer.planningState.torpedoAccel ?? null;
    }

    this.send({ type: 'ordnance', launches: [launch] });
  }

  private sendSkipOrdnance() {
    if (!this.gameState || this.state !== 'playing_ordnance') return;
    this.send({ type: 'skipOrdnance' });
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

  private cycleShip(direction: number) {
    if (!this.gameState) return;
    const myShips = this.gameState.ships.filter(s => s.owner === this.playerId && !s.destroyed);
    if (myShips.length <= 1) return;
    const currentIdx = myShips.findIndex(s => s.id === this.renderer.planningState.selectedShipId);
    const nextIdx = (currentIdx + direction + myShips.length) % myShips.length;
    this.renderer.planningState.selectedShipId = myShips[nextIdx].id;
    this.renderer.centerOnHex(myShips[nextIdx].position);
    this.updateHUD();
  }

  // --- Helpers ---

  private updateHUD() {
    if (!this.gameState) return;
    const isMyTurn = this.gameState.activePlayer === this.playerId;
    const myShips = this.gameState.ships.filter(s => s.owner === this.playerId);
    const selectedId = this.renderer.planningState.selectedShipId;
    const selectedShip = myShips.find(s => s.id === selectedId) ?? myShips.find(s => !s.destroyed);
    const stats = selectedShip ? SHIP_STATS[selectedShip.type] : null;
    // Check if any ship has a burn set (for undo button visibility)
    const hasBurns = Array.from(this.renderer.planningState.burns.values()).some(b => b !== null);
    const cargoFree = selectedShip && stats ? stats.cargo - selectedShip.cargoUsed : 0;
    const cargoMax = stats?.cargo ?? 0;
    this.ui.updateHUD(
      this.gameState.turnNumber,
      this.gameState.phase,
      isMyTurn,
      selectedShip?.fuel ?? 0,
      stats?.fuel ?? 0,
      hasBurns,
      cargoFree,
      cargoMax,
    );
    this.ui.updateShipList(
      myShips,
      selectedId,
      this.renderer.planningState.burns,
    );
  }

  private canLaunchOrdnance(ship: { type: string; cargoUsed: number }): boolean {
    const stats = SHIP_STATS[ship.type];
    if (!stats) return false;
    return (stats.cargo - ship.cargoUsed) >= ORDNANCE_MASS.mine;
  }

  // Deserialize state from server (plain object -> proper types)
  private deserializeState(raw: GameState): GameState {
    return raw; // JSON types are already compatible
  }
}

// --- Bootstrap ---
(window as any).__game = new GameClient();
