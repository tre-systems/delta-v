import type { GameState, S2C, AstrogationOrder, OrdnanceLaunch, CombatAttack, ShipMovement } from '../shared/types';
import { pixelToHex, hexEqual, hexVecLength } from '../shared/hex';
import { canAttack } from '../shared/combat';
import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../shared/map-data';
import { SHIP_STATS, ORDNANCE_MASS } from '../shared/constants';
import { createGame, processAstrogation, processOrdnance, skipOrdnance, processCombat, skipCombat } from '../shared/game-engine';
import { aiAstrogation, aiOrdnance, aiCombat, type AIDifficulty } from '../shared/ai';
import { Renderer, HEX_SIZE } from './renderer';
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
  private gameCode: string | null = null;
  private scenario = 'biplanetary';
  private gameState: GameState | null = null;
  private isLocalGame = false; // true for single player vs AI
  private aiDifficulty: AIDifficulty = 'normal';

  private canvas: HTMLCanvasElement;
  renderer: Renderer;
  private input: InputHandler;
  private ui: UIManager;
  private map = getSolarSystemMap();
  private tooltipEl: HTMLElement;

  // Ping/latency tracking
  private pingInterval: number | null = null;
  private lastPingSent = 0;
  private latencyMs = -1; // -1 = unknown

  // Turn timer
  private turnStartTime = 0;

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);
    this.input = new InputHandler(this.canvas, this.renderer.camera, this.renderer.planningState);
    this.ui = new UIManager();
    this.tooltipEl = document.getElementById('shipTooltip')!;

    this.renderer.setMap(this.map);
    this.input.setMap(this.map);

    // Wire UI callbacks
    this.ui.onSelectScenario = (scenario) => this.createGame(scenario);
    this.ui.onSinglePlayer = (scenario, difficulty) => {
      this.aiDifficulty = difficulty;
      this.startLocalGame(scenario);
    };
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
      // Don't handle keys when typing in input fields
      if (e.target instanceof HTMLInputElement) return;

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
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (this.state === 'playing_astrogation') {
          e.preventDefault();
          this.confirmOrders();
        } else if (this.state === 'playing_ordnance') {
          e.preventDefault();
          this.sendSkipOrdnance();
        } else if (this.state === 'playing_combat') {
          e.preventDefault();
          if (this.renderer.planningState.combatTargetId) {
            this.sendAttack();
          } else {
            this.sendSkipCombat();
          }
        }
      } else if (e.key >= '1' && e.key <= '6' && this.state === 'playing_astrogation') {
        // Number keys 1-6 for burn directions
        this.setBurnDirection(parseInt(e.key) - 1);
      } else if (e.key === '0' && this.state === 'playing_astrogation') {
        // 0 to clear burn
        this.clearSelectedBurn();
      } else if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') {
        this.renderer.camera.pan(0, 40);
      } else if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
        this.renderer.camera.pan(0, -40);
      } else if (e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') {
        this.renderer.camera.pan(40, 0);
      } else if (e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') {
        this.renderer.camera.pan(-40, 0);
      } else if (e.key === '=' || e.key === '+') {
        this.renderer.camera.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.15);
      } else if (e.key === '-' || e.key === '_') {
        this.renderer.camera.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.87);
      } else if (e.key === '?' || e.key === '/') {
        this.toggleHelp();
      }
    });

    // Help overlay
    document.getElementById('helpCloseBtn')!.addEventListener('click', () => this.toggleHelp());
    document.getElementById('helpBtn')!.addEventListener('click', () => this.toggleHelp());

    // Ship hover tooltip
    this.canvas.addEventListener('mousemove', (e) => this.updateTooltip(e.clientX, e.clientY));
    this.canvas.addEventListener('mouseleave', () => { this.tooltipEl.style.display = 'none'; });

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
    // Hide tooltip on state changes
    this.tooltipEl.style.display = 'none';

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
        this.ui.showWaiting(this.gameCode ?? '');
        break;

      case 'playing_astrogation':
        this.ui.showHUD();
        this.turnStartTime = Date.now();
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
        this.renderer.frameOnShips();
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

  private startLocalGame(scenario: string) {
    this.isLocalGame = true;
    this.playerId = 0;
    this.lastLoggedTurn = -1;
    this.renderer.setPlayerId(0);
    this.input.setPlayerId(0);

    const scenarioDef = SCENARIOS[scenario] ?? SCENARIOS.biplanetary;
    this.gameState = createGame(scenarioDef, this.map, 'LOCAL', findBaseHex);
    this.ui.clearLog();
    this.ui.logText(`vs AI (${this.aiDifficulty}) — ${scenarioDef.name}`);
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    this.logScenarioBriefing();

    if (this.gameState.activePlayer === this.playerId) {
      this.setState('playing_astrogation');
    } else {
      this.setState('playing_opponentTurn');
      this.runAITurn();
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
    this.startPing();
  }

  private startPing() {
    this.stopPing();
    this.latencyMs = -1;
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastPingSent = Date.now();
        this.send({ type: 'ping', t: this.lastPingSent });
      }
    }, 5000);
  }

  private stopPing() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.latencyMs = -1;
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
        this.ui.clearLog();
        this.logScenarioBriefing();
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
          this.ui.logMovementEvents(msg.events, this.gameState.ships);
          const hasDestruction = msg.events.some(e => e.damageType === 'eliminated' || e.type === 'crash');
          if (hasDestruction) setTimeout(() => playExplosion(), 500);
        }
        this.logLandings(msg.movements);
        this.renderer.animateMovements(msg.movements, msg.ordnanceMovements, () => {
          this.onAnimationComplete();
        });
        break;

      case 'combatResult':
        this.gameState = this.deserializeState(msg.state);
        this.renderer.setGameState(this.gameState);
        this.input.setGameState(this.gameState);
        this.renderer.showCombatResults(msg.results);
        this.ui.logCombatResults(msg.results, this.gameState.ships);
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

      case 'gameOver': {
        this.setState('gameOver');
        const won = msg.winner === this.playerId;
        this.ui.showGameOver(won, msg.reason);
        this.ui.logText(`${won ? 'VICTORY' : 'DEFEAT'}: ${msg.reason}`, won ? 'log-landed' : 'log-eliminated');
        if (won) {
          playVictory();
        } else {
          playDefeat();
        }
        break;
      }

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
        if (msg.t > 0) {
          this.latencyMs = Date.now() - msg.t;
          // Update latency display in HUD
          const latEl = document.getElementById('latencyInfo');
          if (latEl) {
            latEl.textContent = `${this.latencyMs}ms`;
            latEl.className = 'latency-text ' + (
              this.latencyMs < 100 ? 'latency-good' :
              this.latencyMs < 250 ? 'latency-ok' : 'latency-bad'
            );
          }
        }
        break;
    }
  }

  private handleDisconnect() {
    this.stopPing();
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
    if (this.isLocalGame) {
      this.localProcessAstrogation(orders);
    } else {
      this.send({ type: 'astrogation', orders });
    }
  }

  private onAnimationComplete() {
    if (!this.gameState) return;
    this.transitionToPhase();
  }

  private lastLoggedTurn = -1;

  private transitionToPhase() {
    if (!this.gameState) return;
    if (this.gameState.phase === 'gameOver') return;

    // Log turn header when turn changes
    if (this.gameState.turnNumber !== this.lastLoggedTurn && this.gameState.phase === 'astrogation') {
      this.lastLoggedTurn = this.gameState.turnNumber;
      const playerLabel = this.gameState.activePlayer === this.playerId ? 'You' : 'Opponent';
      this.ui.logTurn(this.gameState.turnNumber, playerLabel);
    }

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
      // In local game, trigger AI turn
      if (this.isLocalGame && this.gameState.activePlayer !== this.playerId) {
        setTimeout(() => this.runAITurn(), 500);
      }
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
    if (this.isLocalGame) {
      this.localProcessCombat(attacks);
    } else {
      this.send({ type: 'combat', attacks });
    }
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

    const shipName = SHIP_STATS[ship.type]?.name ?? ship.type;
    this.ui.logText(`${shipName} launched ${ordType}`);

    if (this.isLocalGame) {
      this.localProcessOrdnance([launch]);
    } else {
      this.send({ type: 'ordnance', launches: [launch] });
    }
  }

  private sendSkipOrdnance() {
    if (!this.gameState || this.state !== 'playing_ordnance') return;
    if (this.isLocalGame) {
      this.localSkipOrdnance();
    } else {
      this.send({ type: 'skipOrdnance' });
    }
  }

  private sendSkipCombat() {
    if (!this.gameState || this.state !== 'playing_combat') return;
    if (this.isLocalGame) {
      this.localSkipCombat();
    } else {
      this.send({ type: 'skipCombat' });
    }
  }

  private sendRematch() {
    if (this.isLocalGame) {
      this.startLocalGame(this.scenario);
      return;
    }
    this.send({ type: 'rematch' });
  }

  private exitToMenu() {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.gameState = null;
    this.isLocalGame = false;
    history.replaceState(null, '', '/');
    this.setState('menu');
  }

  // --- Local game (single player) ---

  private localProcessAstrogation(orders: AstrogationOrder[]) {
    if (!this.gameState) return;
    const result = processAstrogation(this.gameState, this.playerId, orders, this.map);
    if ('error' in result) {
      console.error('Local astrogation error:', result.error);
      return;
    }
    this.gameState = result.state;
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    this.setState('playing_movementAnim');
    playThrust();
    if (result.events.length > 0) {
      this.renderer.showMovementEvents(result.events);
      this.ui.logMovementEvents(result.events, this.gameState.ships);
      if (result.events.some(e => e.damageType === 'eliminated' || e.type === 'crash')) {
        setTimeout(() => playExplosion(), 500);
      }
    }
    this.logLandings(result.movements);
    this.renderer.animateMovements(result.movements, result.ordnanceMovements, () => {
      this.localCheckGameEnd();
      this.onAnimationComplete();
    });
  }

  private localProcessOrdnance(launches: OrdnanceLaunch[]) {
    if (!this.gameState) return;
    const result = processOrdnance(this.gameState, this.playerId, launches, this.map);
    if ('error' in result) {
      console.error('Local ordnance error:', result.error);
      return;
    }
    this.gameState = result.state;
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    this.localCheckGameEnd();
    this.transitionToPhase();
  }

  private localSkipOrdnance() {
    if (!this.gameState) return;
    const result = skipOrdnance(this.gameState, this.playerId);
    if ('error' in result) return;
    this.gameState = result.state;
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    this.transitionToPhase();
  }

  private localProcessCombat(attacks: CombatAttack[]) {
    if (!this.gameState) return;
    const result = processCombat(this.gameState, this.playerId, attacks, this.map);
    if ('error' in result) return;
    this.gameState = result.state;
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    this.renderer.showCombatResults(result.results);
    this.ui.logCombatResults(result.results, this.gameState.ships);
    this.renderer.planningState.combatTargetId = null;
    playCombat();
    if (result.results.some(r => r.damageType === 'eliminated')) {
      setTimeout(() => playExplosion(), 300);
    }
    this.localCheckGameEnd();
    this.transitionToPhase();
  }

  private localSkipCombat() {
    if (!this.gameState) return;
    const result = skipCombat(this.gameState, this.playerId, this.map);
    if ('error' in result) return;
    this.gameState = result.state;
    this.renderer.setGameState(this.gameState);
    this.input.setGameState(this.gameState);
    if (result.baseDefenseResults && result.baseDefenseResults.length > 0) {
      this.renderer.showCombatResults(result.baseDefenseResults);
      this.ui.logCombatResults(result.baseDefenseResults, this.gameState.ships);
    }
    this.localCheckGameEnd();
    this.transitionToPhase();
  }

  private localCheckGameEnd() {
    if (!this.gameState || this.gameState.phase !== 'gameOver') return;
    this.setState('gameOver');
    const won = this.gameState.winner === this.playerId;
    const reason = this.gameState.winReason ?? '';
    this.ui.showGameOver(won, reason);
    this.ui.logText(`${won ? 'VICTORY' : 'DEFEAT'}: ${reason}`, won ? 'log-landed' : 'log-eliminated');
    if (won) {
      playVictory();
    } else {
      playDefeat();
    }
  }

  private runAITurn() {
    if (!this.gameState || this.gameState.phase === 'gameOver') return;
    const aiPlayer = this.gameState.activePlayer;
    if (aiPlayer === this.playerId) return; // Not AI's turn

    // Astrogation phase
    if (this.gameState.phase === 'astrogation') {
      const orders = aiAstrogation(this.gameState, aiPlayer, this.map, this.aiDifficulty);
      const result = processAstrogation(this.gameState, aiPlayer, orders, this.map);
      if ('error' in result) {
        console.error('AI astrogation error:', result.error);
        return;
      }
      this.gameState = result.state;
      this.renderer.setGameState(this.gameState);
      this.input.setGameState(this.gameState);
      this.setState('playing_movementAnim');
      playThrust();
      if (result.events.length > 0) {
        this.renderer.showMovementEvents(result.events);
        this.ui.logMovementEvents(result.events, this.gameState.ships);
        if (result.events.some(e => e.damageType === 'eliminated' || e.type === 'crash')) {
          setTimeout(() => playExplosion(), 500);
        }
      }
      this.logLandings(result.movements);
      this.renderer.animateMovements(result.movements, result.ordnanceMovements, () => {
        this.localCheckGameEnd();
        this.continueAIAfterAstrogation(aiPlayer);
      });
      return;
    }

    // If we get here with ordnance/combat phase, process them directly
    this.processAIPhases(aiPlayer);
  }

  private continueAIAfterAstrogation(aiPlayer: number) {
    if (!this.gameState || this.gameState.phase === 'gameOver') return;
    // Process ordnance and combat phases for AI
    this.processAIPhases(aiPlayer);
  }

  private processAIPhases(aiPlayer: number) {
    if (!this.gameState || this.gameState.phase === 'gameOver') return;

    // Ordnance phase
    if (this.gameState.phase === 'ordnance' && this.gameState.activePlayer === aiPlayer) {
      const launches = aiOrdnance(this.gameState, aiPlayer, this.map, this.aiDifficulty);
      if (launches.length > 0) {
        for (const l of launches) {
          const ship = this.gameState.ships.find(s => s.id === l.shipId);
          const name = ship ? (SHIP_STATS[ship.type]?.name ?? ship.type) : l.shipId;
          this.ui.logText(`AI: ${name} launched ${l.ordnanceType}`);
        }
        const result = processOrdnance(this.gameState, aiPlayer, launches, this.map);
        if (!('error' in result)) {
          this.gameState = result.state;
        }
      } else {
        const result = skipOrdnance(this.gameState, aiPlayer);
        if (!('error' in result)) {
          this.gameState = result.state;
        }
      }
      this.renderer.setGameState(this.gameState);
      this.input.setGameState(this.gameState);
    }

    // Combat phase
    if (this.gameState.phase === 'combat' && this.gameState.activePlayer === aiPlayer) {
      const attacks = aiCombat(this.gameState, aiPlayer, this.aiDifficulty);
      if (attacks.length > 0) {
        const result = processCombat(this.gameState, aiPlayer, attacks, this.map);
        if (!('error' in result)) {
          this.gameState = result.state;
          this.renderer.showCombatResults(result.results);
          this.ui.logCombatResults(result.results, this.gameState.ships);
          playCombat();
          if (result.results.some(r => r.damageType === 'eliminated')) {
            setTimeout(() => playExplosion(), 300);
          }
        }
      } else {
        const result = skipCombat(this.gameState, aiPlayer, this.map);
        if (!('error' in result)) {
          this.gameState = result.state;
          if (result.baseDefenseResults && result.baseDefenseResults.length > 0) {
            this.renderer.showCombatResults(result.baseDefenseResults);
            this.ui.logCombatResults(result.baseDefenseResults, this.gameState.ships);
          }
        }
      }
      this.renderer.setGameState(this.gameState);
      this.input.setGameState(this.gameState);
    }

    this.localCheckGameEnd();

    // Transition to the next phase (should be player's turn now)
    if (this.gameState.phase !== 'gameOver') {
      this.transitionToPhase();
    }
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

  // --- Burn shortcuts ---

  private setBurnDirection(dir: number) {
    if (!this.gameState || this.state !== 'playing_astrogation') return;
    const shipId = this.renderer.planningState.selectedShipId;
    if (!shipId) return;
    const ship = this.gameState.ships.find(s => s.id === shipId);
    if (!ship || ship.fuel <= 0 || ship.destroyed || ship.damage.disabledTurns > 0) return;

    const current = this.renderer.planningState.burns.get(shipId) ?? null;
    // Toggle: same direction = cancel
    this.renderer.planningState.burns.set(shipId, current === dir ? null : dir);
    if (current !== dir) {
      this.renderer.planningState.overloads.delete(shipId);
    }
    playSelect();
    this.updateHUD();
  }

  private clearSelectedBurn() {
    if (!this.gameState || this.state !== 'playing_astrogation') return;
    const shipId = this.renderer.planningState.selectedShipId;
    if (!shipId) return;
    this.renderer.planningState.burns.delete(shipId);
    this.renderer.planningState.overloads.delete(shipId);
    this.renderer.planningState.weakGravityChoices.delete(shipId);
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
    // Build objective text
    const player = this.gameState.players[this.playerId];
    const objective = player?.escapeWins
      ? '⬡ Escape the map'
      : player?.targetBody
        ? `⬡ Land on ${player.targetBody}`
        : '';
    this.ui.updateHUD(
      this.gameState.turnNumber,
      this.gameState.phase,
      isMyTurn,
      selectedShip?.fuel ?? 0,
      stats?.fuel ?? 0,
      hasBurns,
      cargoFree,
      cargoMax,
      objective,
    );
    // Update latency display (multiplayer only)
    const latencyEl = document.getElementById('latencyInfo')!;
    if (!this.isLocalGame && this.latencyMs >= 0) {
      latencyEl.textContent = `${this.latencyMs}ms`;
      latencyEl.className = 'latency-text ' + (
        this.latencyMs < 100 ? 'latency-good' :
        this.latencyMs < 250 ? 'latency-ok' : 'latency-bad'
      );
    } else {
      latencyEl.textContent = '';
    }
    this.ui.updateShipList(
      myShips,
      selectedId,
      this.renderer.planningState.burns,
    );
  }

  private logScenarioBriefing() {
    if (!this.gameState) return;
    const player = this.gameState.players[this.playerId];
    const myShips = this.gameState.ships.filter(s => s.owner === this.playerId);
    const shipNames = myShips.map(s => SHIP_STATS[s.type]?.name ?? s.type).join(', ');
    this.ui.logText(`Your fleet: ${shipNames}`);
    if (player.escapeWins) {
      this.ui.logText('Objective: Escape the solar system!', 'log-landed');
    } else if (player.targetBody) {
      this.ui.logText(`Objective: Land on ${player.targetBody}`, 'log-landed');
    }
    this.ui.logText('Press ? for controls help');
  }

  private toggleHelp() {
    const helpOverlay = document.getElementById('helpOverlay')!;
    helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  private logLandings(movements: ShipMovement[]) {
    if (!this.gameState) return;
    for (const m of movements) {
      if (!m.landedAt) continue;
      const ship = this.gameState.ships.find(s => s.id === m.shipId);
      if (!ship) continue;
      const name = SHIP_STATS[ship.type]?.name ?? ship.type;
      this.ui.logLanding(name, m.landedAt);
      // Check if it's at a friendly base (resupply happened)
      const player = this.gameState.players[ship.owner];
      if (player && player.homeBody === m.landedAt) {
        this.ui.logText(`  ${name} resupplied: fuel + cargo restored`);
      }
    }
  }

  private canLaunchOrdnance(ship: { type: string; cargoUsed: number }): boolean {
    const stats = SHIP_STATS[ship.type];
    if (!stats) return false;
    return (stats.cargo - ship.cargoUsed) >= ORDNANCE_MASS.mine;
  }

  private updateTooltip(screenX: number, screenY: number) {
    if (!this.gameState || this.state === 'menu' || this.state === 'connecting'
        || this.state === 'waitingForOpponent' || this.state === 'playing_movementAnim'
        || this.state === 'gameOver') {
      this.tooltipEl.style.display = 'none';
      return;
    }

    const worldPos = this.renderer.camera.screenToWorld(screenX, screenY);
    const hoverHex = pixelToHex(worldPos, HEX_SIZE);

    // Find ship at hover hex
    const ship = this.gameState.ships.find(s => {
      if (s.destroyed) return false;
      if (s.owner !== this.playerId && !s.detected) return false;
      return hexEqual(s.position, hoverHex);
    });

    if (!ship) {
      this.tooltipEl.style.display = 'none';
      return;
    }

    const stats = SHIP_STATS[ship.type];
    const name = stats?.name ?? ship.type;
    const isEnemy = ship.owner !== this.playerId;
    const nameClass = isEnemy ? 'tt-enemy' : 'tt-name';
    const speed = hexVecLength(ship.velocity);
    const combat = stats ? `${stats.combat}${stats.defensiveOnly ? 'D' : ''}` : '?';

    let html = `<div class="${nameClass}">${name}</div>`;
    html += `<div class="tt-stat">Combat: ${combat}</div>`;
    html += `<div class="tt-stat">Speed: ${speed.toFixed(1)}</div>`;

    if (!isEnemy) {
      // Show detailed info for own ships
      html += `<div class="tt-stat">Fuel: ${ship.fuel}/${stats?.fuel ?? '?'}</div>`;
      if (stats && stats.cargo > 0) {
        html += `<div class="tt-stat">Cargo: ${stats.cargo - ship.cargoUsed}/${stats.cargo}</div>`;
      }
    }

    if (ship.damage.disabledTurns > 0) {
      html += `<div class="tt-warn">Disabled: ${ship.damage.disabledTurns}T</div>`;
    }
    if (ship.landed) {
      html += `<div class="tt-stat">Landed</div>`;
    }

    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = 'block';
    // Position tooltip offset from cursor
    this.tooltipEl.style.left = `${screenX + 12}px`;
    this.tooltipEl.style.top = `${screenY - 10}px`;
  }

  // Deserialize state from server (plain object -> proper types)
  private deserializeState(raw: GameState): GameState {
    return raw; // JSON types are already compatible
  }
}

// --- Bootstrap ---
(window as any).__game = new GameClient();
