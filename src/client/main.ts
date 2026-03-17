// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

import type { AIDifficulty } from '../shared/ai';
import { CODE_LENGTH, TURN_TIMEOUT_MS } from '../shared/constants';
import { createGame, type MovementResult, processEmplacement } from '../shared/engine/game-engine';
import { pixelToHex } from '../shared/hex';
import { findBaseHex, getSolarSystemMap, SCENARIOS } from '../shared/map-data';
import type {
  AstrogationOrder,
  CombatAttack,
  CombatResult,
  FleetPurchase,
  GameState,
  OrdnanceLaunch,
  S2C,
  ShipMovement,
} from '../shared/types';
import {
  initAudio,
  isMuted,
  playCombat,
  playConfirm,
  playDefeat,
  playExplosion,
  playPhaseChange,
  playSelect,
  playThrust,
  playVictory,
  playWarning,
  setMuted,
} from './audio';
import { deriveAIActionPlan } from './game/ai-flow';
import { deriveScenarioBriefingEntries } from './game/briefing';
import { deriveBurnChangePlan } from './game/burn';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  getAttackStrengthForSelection,
  hasSplitFireOptions,
} from './game/combat';
import { deriveGameOverPlan } from './game/endgame';
import { resolveLocalFleetReady } from './game/fleet';
import { buildAstrogationOrders, deriveHudViewModel } from './game/helpers';
import { getTooltipShip } from './game/hover';
import { deriveKeyboardAction, type KeyboardAction } from './game/keyboard';
import { deriveLandingLogEntries } from './game/landings';
import {
  type LocalResolution,
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveOrdnanceStep,
  resolveSkipCombatStep,
  resolveSkipOrdnanceStep,
} from './game/local';
import { deriveClientMessagePlan } from './game/messages';
import { getNearestEnemyPosition, getNextSelectedShip, getOwnFleetFocusPosition } from './game/navigation';
import { deriveDisconnectHandling, deriveGameStartClientState, deriveReconnectAttemptPlan } from './game/network';
import { resolveBaseEmplacementPlan, resolveOrdnanceLaunchPlan } from './game/ordnance';
import { type ClientState, derivePhaseTransition } from './game/phase';
import { deriveClientStateEntryPlan } from './game/phase-entry';
import { deriveClientScreenPlan } from './game/screen';
import {
  buildGameRoute,
  buildInviteLink,
  buildWebSocketUrl,
  getStoredInviteToken,
  getStoredPlayerToken,
  loadTokenStore,
  saveTokenStore,
  setStoredInviteToken,
  setStoredPlayerToken,
} from './game/session';
import { deriveTurnTimer } from './game/timer';
import { buildShipTooltipHtml } from './game/tooltip';
import { InputHandler } from './input';
import { HEX_SIZE, Renderer } from './renderer/renderer';
import { Tutorial } from './tutorial';
import { UIManager } from './ui/ui';

class GameClient {
  private state: ClientState = 'menu';
  private ws: WebSocket | null = null;
  private playerId = -1;
  private gameCode: string | null = null;
  private inviteLink: string | null = null;
  private scenario = 'biplanetary';
  private gameState: GameState | null = null;
  private isLocalGame = false; // true for single player vs AI
  private aiDifficulty: AIDifficulty = 'normal';

  private canvas: HTMLCanvasElement;
  renderer: Renderer;
  private input: InputHandler;
  private ui: UIManager;
  private tutorial: Tutorial;
  private map = getSolarSystemMap();
  private tooltipEl: HTMLElement;

  // Ping/latency tracking
  private pingInterval: number | null = null;
  private lastPingSent = 0;
  private latencyMs = -1; // -1 = unknown

  // Turn timer
  private turnStartTime = 0;
  private turnTimerInterval: number | null = null;
  private timerWarningPlayed = false;

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);
    this.input = new InputHandler(this.canvas, this.renderer.camera, this.renderer.planningState);
    this.ui = new UIManager();
    this.tutorial = new Tutorial();
    this.tooltipEl = document.getElementById('shipTooltip')!;

    this.renderer.setMap(this.map);
    this.input.setMap(this.map);

    // Wire UI callbacks
    this.ui.onSelectScenario = (scenario) => this.createGame(scenario);
    this.ui.onSinglePlayer = (scenario, difficulty) => {
      this.aiDifficulty = difficulty;
      this.startLocalGame(scenario);
    };
    this.ui.onJoin = (code, playerToken) => this.joinGame(code, playerToken ?? null);
    this.ui.onUndo = () => this.undoSelectedShipBurn();
    this.ui.onConfirm = () => this.confirmOrders();
    this.ui.onLaunchOrdnance = (ordType) => this.sendOrdnanceLaunch(ordType);
    this.ui.onEmplaceBase = () => this.sendEmplaceBase();
    this.ui.onSkipOrdnance = () => this.sendSkipOrdnance();
    this.ui.onAttack = () => this.queueAttack();
    this.ui.onFireAll = () => this.fireAllAttacks();
    this.ui.onSkipCombat = () => this.sendSkipCombat();
    this.ui.onFleetReady = (purchases) => this.sendFleetReady(purchases);
    this.ui.onRematch = () => this.sendRematch();
    this.ui.onExit = () => this.exitToMenu();
    this.ui.onSelectShip = (shipId) => {
      this.renderer.planningState.selectedShipId = shipId;
      this.updateHUD();
      // Center camera on selected ship
      const ship = this.gameState?.ships.find((s) => s.id === shipId);
      if (ship) this.renderer.centerOnHex(ship.position);
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const action = deriveKeyboardAction(
        {
          state: this.state,
          hasGameState: !!this.gameState,
          typingInInput: e.target instanceof HTMLInputElement,
          combatTargetId: this.renderer.planningState.combatTargetId,
          queuedAttackCount: this.renderer.planningState.queuedAttacks.length,
          torpedoAccelActive: this.renderer.planningState.torpedoAccel !== null,
        },
        { key: e.key, shiftKey: e.shiftKey },
      );
      if (action.kind === 'none') {
        return;
      }
      if (action.preventDefault) {
        e.preventDefault();
      }
      this.handleKeyboardAction(action);
    });

    // Help overlay
    document.getElementById('helpCloseBtn')!.addEventListener('click', () => this.toggleHelp());
    document.getElementById('helpBtn')!.addEventListener('click', () => this.toggleHelp());

    // Sound toggle
    const soundBtn = document.getElementById('soundBtn')!;
    this.updateSoundButton();
    soundBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      this.updateSoundButton();
    });

    // Ship hover tooltip
    this.canvas.addEventListener('mousemove', (e) => this.updateTooltip(e.clientX, e.clientY));
    this.canvas.addEventListener('mouseleave', () => {
      this.tooltipEl.style.display = 'none';
    });

    // Start render loop and audio
    initAudio();
    this.renderer.start();

    // Check for auto-join code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const playerToken = urlParams.get('playerToken');
    if (code && code.length === CODE_LENGTH) {
      const normalizedCode = code.toUpperCase();
      if (playerToken) {
        this.storePlayerToken(normalizedCode, playerToken);
      }
      // Strip token from URL to avoid leaking it via browser history / referrer headers
      history.replaceState(null, '', buildGameRoute(normalizedCode));
      this.joinGame(normalizedCode);
    } else {
      this.setState('menu');
    }
  }

  private setState(newState: ClientState) {
    this.state = newState;
    // Hide tooltip on state changes
    this.tooltipEl.style.display = 'none';

    const entryPlan = deriveClientStateEntryPlan(newState, this.gameState, this.playerId);
    const screenPlan = deriveClientScreenPlan(
      newState,
      this.gameCode,
      this.inviteLink,
      this.gameCode ? this.getStoredInviteToken(this.gameCode) : null,
      window.location.origin,
    );

    switch (screenPlan.kind) {
      case 'menu':
        this.ui.showMenu();
        break;

      case 'connecting':
        this.ui.showConnecting();
        break;

      case 'waiting':
        this.inviteLink = screenPlan.inviteLink;
        this.ui.showWaiting(screenPlan.code, screenPlan.inviteLink);
        break;

      case 'fleetBuilding':
        this.ui.showFleetBuilding(this.gameState!, this.playerId);
        break;
      case 'hud':
        this.ui.showHUD();
        break;
      case 'none':
        break;
    }

    if (entryPlan.hideTutorial) {
      this.tutorial.hideTip();
    }
    if (entryPlan.resetCamera) {
      this.renderer.resetCamera();
    }
    if (entryPlan.stopTurnTimer) {
      this.stopTurnTimer();
    }
    if (entryPlan.startTurnTimer) {
      this.startTurnTimer();
    }
    if (entryPlan.updateHUD) {
      this.updateHUD();
    }
    if (entryPlan.clearAstrogationPlanning) {
      this.renderer.planningState.selectedShipId = null;
      this.renderer.planningState.burns.clear();
      this.renderer.planningState.overloads.clear();
      this.renderer.planningState.weakGravityChoices.clear();
    }
    if (entryPlan.selectedShipId !== undefined) {
      this.renderer.planningState.selectedShipId = entryPlan.selectedShipId;
    }
    if (entryPlan.resetCombatState) {
      this.resetCombatState();
    }
    if (entryPlan.clearAttackButton) {
      this.ui.showAttackButton(false);
    }
    if (entryPlan.showMovementStatus) {
      this.ui.showMovementStatus();
    }
    if (entryPlan.startCombatTargetWatch) {
      this.startCombatTargetWatch();
    }
    if (entryPlan.tutorialPhase && this.gameState) {
      this.tutorial.onPhaseChange(entryPlan.tutorialPhase, this.gameState.turnNumber);
    }
    if (entryPlan.frameOnShips) {
      this.renderer.frameOnShips();
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
      const data = (await res.json()) as { code: string; playerToken: string; inviteToken: string };
      this.gameCode = data.code;
      this.storePlayerToken(data.code, data.playerToken);
      this.storeInviteToken(data.code, data.inviteToken);
      this.inviteLink = buildInviteLink(window.location.origin, data.code, data.inviteToken);
      // Update URL
      history.replaceState(null, '', buildGameRoute(this.gameCode));
      this.connect(this.gameCode);
      this.setState('waitingForOpponent');
    } catch (err) {
      console.error('Failed to create game:', err);
      this.ui.showToast('Failed to create game. Try again.', 'error');
      this.setState('menu');
    }
  }

  private startLocalGame(scenario: string) {
    this.isLocalGame = true;
    this.playerId = 0;
    this.lastLoggedTurn = -1;
    this.renderer.setPlayerId(0);
    this.input.setPlayerId(0);

    const scenarioDef = SCENARIOS[scenario] ?? SCENARIOS.biplanetary;
    const state = createGame(scenarioDef, this.map, 'LOCAL', findBaseHex);
    this.renderer.clearTrails();
    this.ui.clearLog();
    this.ui.logText(`vs AI (${this.aiDifficulty}) — ${scenarioDef.name}`);
    this.applyGameState(state);
    this.logScenarioBriefing();
    const gameState = this.gameState;
    if (!gameState) return;
    this.setState(deriveGameStartClientState(gameState, this.playerId));
    if (this.state === 'playing_opponentTurn') {
      this.runAITurn();
    }
  }

  private joinGame(code: string, playerToken: string | null = null) {
    if (playerToken) {
      this.storePlayerToken(code, playerToken);
    }
    this.gameCode = code;
    this.inviteLink = null;
    history.replaceState(null, '', buildGameRoute(code));
    this.connect(code);
    this.setState('connecting');
  }

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: number | null = null;

  private getTokenStore(): Record<string, { playerToken?: string; inviteToken?: string; ts: number }> {
    return loadTokenStore(localStorage);
  }

  private saveTokenStore(store: Record<string, { playerToken?: string; inviteToken?: string; ts: number }>): void {
    saveTokenStore(localStorage, store, Date.now());
  }

  private getStoredPlayerToken(code: string): string | null {
    return getStoredPlayerToken(this.getTokenStore(), code);
  }

  private storePlayerToken(code: string, token: string): void {
    const store = setStoredPlayerToken(this.getTokenStore(), code, token, Date.now());
    this.saveTokenStore(store);
  }

  private getStoredInviteToken(code: string): string | null {
    return getStoredInviteToken(this.getTokenStore(), code);
  }

  private storeInviteToken(code: string, token: string): void {
    const store = setStoredInviteToken(this.getTokenStore(), code, token, Date.now());
    this.saveTokenStore(store);
  }

  private connect(code: string) {
    this.ws = new WebSocket(buildWebSocketUrl(location, code, this.getStoredPlayerToken(code)));
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
    const plan = deriveReconnectAttemptPlan(this.gameCode, this.reconnectAttempts, this.maxReconnectAttempts);
    if (plan.giveUp) {
      this.ui.hideReconnecting();
      this.ui.showToast('Could not reconnect to game', 'error');
      this.setState('menu');
      return;
    }
    this.reconnectAttempts = plan.nextAttempt!;
    this.ui.showReconnecting(this.reconnectAttempts, this.maxReconnectAttempts, () => {
      // Cancel reconnection and return to menu
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectAttempts = 0;
      this.setState('menu');
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.connect(this.gameCode!);
    }, plan.delayMs!);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private applyGameState(state: GameState) {
    this.gameState = state;
    this.renderer.setGameState(state);
    this.input.setGameState(state);
  }

  private presentMovementResult(
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) {
    this.applyGameState(state);
    this.setState('playing_movementAnim');
    playThrust();
    if (events.length > 0) {
      this.renderer.showMovementEvents(events);
      this.ui.logMovementEvents(events, state.ships);
      if (events.some((event) => event.damageType === 'eliminated' || event.type === 'crash')) {
        setTimeout(() => playExplosion(), 500);
      }
    }
    this.logLandings(movements);
    this.renderer.animateMovements(movements, ordnanceMovements, onComplete);
  }

  private presentCombatResults(
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat = true,
  ) {
    this.applyGameState(state);
    this.renderer.showCombatResults(results, previousState);
    this.ui.logCombatResults(results, state.ships);
    if (resetCombat) {
      this.resetCombatState();
    }
    playCombat();
    if (results.some((result) => result.damageType === 'eliminated')) {
      setTimeout(() => playExplosion(), 300);
    }
  }

  private showGameOverOutcome(won: boolean, reason: string) {
    this.setState('gameOver');
    const plan = deriveGameOverPlan(this.gameState, this.playerId, won, reason);
    this.ui.logText(plan.logText, plan.logClass);
    const loserShips = this.gameState?.ships.filter((ship) => plan.loserShipIds.includes(ship.id)) ?? [];
    if (loserShips.length === 0) {
      this.ui.showGameOver(won, reason, plan.stats);
      if (plan.resultSound === 'victory') {
        playVictory();
      } else {
        playDefeat();
      }
      return;
    }
    playExplosion();
    const animDuration = this.renderer.triggerGameOverExplosions(loserShips);
    setTimeout(() => {
      this.ui.showGameOver(won, reason, plan.stats);
      if (plan.resultSound === 'victory') {
        playVictory();
      } else {
        playDefeat();
      }
    }, animDuration);
  }

  private handleMessage(msg: S2C) {
    const plan = deriveClientMessagePlan(this.state, this.reconnectAttempts, this.playerId, Date.now(), msg);
    switch (plan.kind) {
      case 'welcome': {
        this.playerId = plan.playerId;
        this.gameCode = plan.code;
        this.storePlayerToken(plan.code, plan.playerToken);
        if (plan.clearInviteLink) {
          this.inviteLink = null;
        }
        if (plan.showReconnectToast) {
          this.ui.hideReconnecting();
          this.ui.showToast('Reconnected!', 'success');
        }
        this.reconnectAttempts = 0;
        this.renderer.setPlayerId(plan.playerId);
        this.input.setPlayerId(plan.playerId);
        this.ui.setPlayerId(plan.playerId);
        if (plan.nextState) {
          this.setState(plan.nextState);
        }
        break;
      }

      case 'matchFound':
        playPhaseChange();
        break;

      case 'gameStart':
        this.applyGameState(this.deserializeState(plan.state));
        this.renderer.clearTrails();
        this.ui.clearLog();
        this.logScenarioBriefing();
        this.setState(plan.nextState);
        break;

      case 'movementResult':
        this.presentMovementResult(
          this.deserializeState(plan.state),
          plan.movements,
          plan.ordnanceMovements,
          plan.events,
          () => {
            this.onAnimationComplete();
          },
        );
        break;

      case 'combatResult': {
        const previousState = this.gameState;
        this.presentCombatResults(previousState!, this.deserializeState(plan.state), plan.results);
        if (plan.shouldTransition) {
          this.transitionToPhase();
        }
        break;
      }

      case 'stateUpdate':
        this.applyGameState(this.deserializeState(plan.state));
        if (plan.shouldTransition) {
          this.transitionToPhase();
        }
        break;

      case 'gameOver':
        this.showGameOverOutcome(plan.won, plan.reason);
        break;

      case 'rematchPending':
        this.ui.showRematchPending();
        break;

      case 'opponentDisconnected':
        this.setState(plan.nextState);
        this.ui.showGameOver(plan.won, plan.reason);
        break;

      case 'error':
        console.error('Server error:', plan.message);
        this.ui.showToast(plan.message, 'error');
        break;

      case 'pong':
        if (plan.latencyMs !== null) {
          this.latencyMs = plan.latencyMs;
          this.ui.updateLatency(this.latencyMs);
        }
        break;
    }
  }

  private handleDisconnect() {
    this.stopPing();
    const handling = deriveDisconnectHandling(this.state, this.gameCode, this.gameState);
    if (handling.attemptReconnect) {
      this.attemptReconnect();
      return;
    }
    if (handling.nextState) {
      this.setState(handling.nextState);
    }
  }

  private handleKeyboardAction(action: KeyboardAction) {
    switch (action.kind) {
      case 'none':
        return;
      case 'cycleShip':
        this.cycleShip(action.direction);
        return;
      case 'clearCombatSelection':
        this.clearCombatSelection();
        this.ui.showAttackButton(false);
        return;
      case 'undoQueuedAttack': {
        this.renderer.planningState.queuedAttacks.pop();
        const count = this.renderer.planningState.queuedAttacks.length;
        this.ui.showFireButton(count > 0, count);
        this.ui.showToast(count > 0 ? `Undid last attack (${count} queued)` : 'Attack queue cleared', 'info');
        return;
      }
      case 'clearTorpedoAcceleration':
        this.renderer.planningState.torpedoAccel = null;
        this.renderer.planningState.torpedoAccelSteps = null;
        return;
      case 'deselectShip':
        this.renderer.planningState.selectedShipId = null;
        this.updateHUD();
        return;
      case 'confirmOrders':
        this.confirmOrders();
        return;
      case 'skipOrdnance':
        this.sendSkipOrdnance();
        return;
      case 'queueAttack':
        this.queueAttack();
        return;
      case 'fireAllAttacks':
        this.fireAllAttacks();
        return;
      case 'skipCombat':
        this.sendSkipCombat();
        return;
      case 'adjustCombatStrength':
        this.adjustCombatStrength(action.delta);
        return;
      case 'launchOrdnance':
        this.sendOrdnanceLaunch(action.ordnanceType);
        return;
      case 'setBurnDirection':
        this.setBurnDirection(action.direction);
        return;
      case 'clearSelectedBurn':
        this.clearSelectedBurn();
        return;
      case 'resetCombatStrength':
        this.resetCombatStrengthToMax();
        return;
      case 'focusNearestEnemy':
        this.focusNearestEnemy();
        return;
      case 'focusOwnFleet':
        this.focusOwnFleet();
        return;
      case 'toggleLog':
        this.ui.toggleLog();
        return;
      case 'panCamera':
        this.renderer.camera.pan(action.dx, action.dy);
        return;
      case 'zoomCamera':
        this.renderer.camera.zoomAt(window.innerWidth / 2, window.innerHeight / 2, action.factor);
        return;
      case 'toggleHelp':
        this.toggleHelp();
        return;
      case 'toggleMute':
        setMuted(!isMuted());
        this.updateSoundButton();
        return;
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
    const orders = buildAstrogationOrders(this.gameState, this.playerId, this.renderer.planningState);

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
    const transition = derivePhaseTransition(this.gameState, this.playerId, this.lastLoggedTurn, this.isLocalGame);
    if (transition.turnLogNumber !== null && transition.turnLogPlayerLabel) {
      this.lastLoggedTurn = transition.turnLogNumber;
      this.ui.logTurn(transition.turnLogNumber, transition.turnLogPlayerLabel);
    }
    if (transition.beginCombatPhase) {
      this.beginCombatPhase();
      return;
    }
    if (!transition.nextState) {
      return;
    }
    this.setState(transition.nextState);
    // Canvas phase banner removed — DOM overlay in ui.ts handles this
    if (transition.playPhaseSound) {
      playPhaseChange();
    }
    if (transition.runLocalAI) {
      setTimeout(() => this.runAITurn(), 500);
    }
  }

  private queueAttack() {
    if (!this.gameState || this.state !== 'playing_combat') return;
    const attack = buildCurrentAttack(this.gameState, this.playerId, this.renderer.planningState, this.map);
    if (!attack) {
      this.ui.showToast('Select an enemy ship or nuke to target', 'info');
      return;
    }

    this.renderer.planningState.queuedAttacks.push(attack);
    this.clearCombatSelection();
    this.ui.showAttackButton(false);

    const remainingAttackers = countRemainingCombatAttackers(
      this.gameState,
      this.playerId,
      this.renderer.planningState.queuedAttacks,
    );
    if (
      remainingAttackers === 0 &&
      !hasSplitFireOptions(this.gameState, this.playerId, this.renderer.planningState.queuedAttacks)
    ) {
      // No more attackers available — auto-fire
      this.fireAllAttacks();
    } else {
      const count = this.renderer.planningState.queuedAttacks.length;
      this.ui.showToast(`Attack queued (${count}). Select next target or press Enter to fire.`, 'info');
      this.ui.showFireButton(true, count);
    }
  }

  private fireAllAttacks() {
    const attacks = [...this.renderer.planningState.queuedAttacks];
    if (attacks.length === 0) {
      this.sendSkipCombat();
      return;
    }
    this.renderer.planningState.queuedAttacks = [];
    this.ui.showFireButton(false, 0);

    if (this.isLocalGame) {
      this.localProcessCombat(attacks);
    } else {
      this.send({ type: 'combat', attacks });
    }
  }

  private beginCombatPhase() {
    if (!this.gameState || this.gameState.phase !== 'combat') return;
    if (this.isLocalGame) {
      this.localBeginCombat();
    } else {
      this.send({ type: 'beginCombat' });
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

  private clearCombatSelection() {
    this.renderer.planningState.combatTargetId = null;
    this.renderer.planningState.combatTargetType = null;
    this.renderer.planningState.combatAttackerIds = [];
    this.renderer.planningState.combatAttackStrength = null;
  }

  private resetCombatState() {
    this.clearCombatSelection();
    this.renderer.planningState.queuedAttacks = [];
    this.ui.showFireButton(false, 0);
  }

  private adjustCombatStrength(delta: number) {
    if (!this.gameState || this.state !== 'playing_combat') return;
    if (this.renderer.planningState.combatTargetType !== 'ship') return;
    const maxStrength = getAttackStrengthForSelection(this.gameState, this.renderer.planningState.combatAttackerIds);
    if (maxStrength <= 0) return;

    const current = this.renderer.planningState.combatAttackStrength ?? maxStrength;
    this.renderer.planningState.combatAttackStrength = Math.max(1, Math.min(maxStrength, current + delta));
  }

  private resetCombatStrengthToMax() {
    if (!this.gameState || this.state !== 'playing_combat') return;
    if (this.renderer.planningState.combatTargetType !== 'ship') return;
    const maxStrength = getAttackStrengthForSelection(this.gameState, this.renderer.planningState.combatAttackerIds);
    if (maxStrength > 0) {
      this.renderer.planningState.combatAttackStrength = maxStrength;
    }
  }

  private sendOrdnanceLaunch(ordType: 'mine' | 'torpedo' | 'nuke') {
    if (!this.gameState || this.state !== 'playing_ordnance') return;
    const plan = resolveOrdnanceLaunchPlan(this.gameState, this.renderer.planningState, ordType);
    if (!plan.ok) {
      if (plan.message) {
        this.ui.showToast(plan.message, plan.level);
      }
      return;
    }
    this.ui.logText(`${plan.shipName} launched ${ordType}`);

    if (this.isLocalGame) {
      this.localProcessOrdnance([plan.launch]);
    } else {
      this.send({ type: 'ordnance', launches: [plan.launch] });
    }
  }

  private sendEmplaceBase() {
    if (!this.gameState || this.state !== 'playing_ordnance') return;
    const plan = resolveBaseEmplacementPlan(this.gameState, this.renderer.planningState.selectedShipId);
    if (!plan.ok) {
      if (plan.message) {
        this.ui.showToast(plan.message, plan.level);
      }
      return;
    }

    if (this.isLocalGame) {
      const result = processEmplacement(this.gameState, this.playerId, plan.emplacements, this.map);
      if ('error' in result) {
        this.ui.showToast(result.error, 'error');
        return;
      }
      this.applyGameState(result.state);
      this.ui.showToast('Orbital base emplaced!', 'success');
      this.updateHUD();
    } else {
      this.send({ type: 'emplaceBase', emplacements: plan.emplacements });
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

  private sendFleetReady(purchases: FleetPurchase[]) {
    if (!this.gameState || this.state !== 'playing_fleetBuilding') return;
    const scenarioDef = SCENARIOS[this.scenario] ?? SCENARIOS.biplanetary;

    if (this.isLocalGame) {
      const result = resolveLocalFleetReady(
        this.gameState,
        this.playerId,
        purchases,
        this.map,
        scenarioDef,
        this.aiDifficulty,
      );
      if (result.kind === 'error') {
        this.ui.showToast(result.error, 'error');
        return;
      }
      this.applyGameState(result.state);
      if (result.aiError) {
        console.error('AI fleet build error:', result.aiError);
      }
      this.logScenarioBriefing();
      this.transitionToPhase();
    } else {
      this.send({ type: 'fleetReady', purchases });
      this.ui.showFleetWaiting();
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
    this.stopTurnTimer();
    this.ws?.close();
    this.ws = null;
    this.gameState = null;
    this.isLocalGame = false;
    history.replaceState(null, '', '/');
    this.setState('menu');
  }

  private playLocalMovementResult(result: MovementResult, onComplete: () => void) {
    this.presentMovementResult(result.state, result.movements, result.ordnanceMovements, result.events, onComplete);
  }

  private handleLocalResolution(resolution: LocalResolution, onContinue: () => void, errorPrefix: string) {
    if (resolution.kind === 'error') {
      console.error(errorPrefix, resolution.error);
      return;
    }

    if (resolution.kind === 'movement') {
      this.playLocalMovementResult(resolution.result, () => {
        this.localCheckGameEnd();
        if (this.gameState?.phase !== 'gameOver') {
          onContinue();
        }
      });
      return;
    }

    if (resolution.kind === 'combat') {
      this.presentCombatResults(resolution.previousState, resolution.state, resolution.results, resolution.resetCombat);
    } else {
      this.applyGameState(resolution.state);
    }

    this.localCheckGameEnd();
    if (this.gameState?.phase !== 'gameOver') {
      onContinue();
    }
  }

  // --- Local game (single player) ---

  private localProcessAstrogation(orders: AstrogationOrder[]) {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveAstrogationStep(this.gameState, this.playerId, orders, this.map),
      () => this.onAnimationComplete(),
      'Local astrogation error:',
    );
  }

  private localProcessOrdnance(launches: OrdnanceLaunch[]) {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveOrdnanceStep(this.gameState, this.playerId, launches, this.map),
      () => this.onAnimationComplete(),
      'Local ordnance error:',
    );
  }

  private localSkipOrdnance() {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveSkipOrdnanceStep(this.gameState, this.playerId, this.map),
      () => this.onAnimationComplete(),
      'Local skip ordnance error:',
    );
  }

  private localBeginCombat() {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveBeginCombatStep(this.gameState, this.playerId, this.map),
      () => this.transitionToPhase(),
      'Local combat start error:',
    );
  }

  private localProcessCombat(attacks: CombatAttack[]) {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveCombatStep(this.gameState, this.playerId, attacks, this.map),
      () => this.transitionToPhase(),
      'Local combat error:',
    );
  }

  private localSkipCombat() {
    if (!this.gameState) return;
    this.handleLocalResolution(
      resolveSkipCombatStep(this.gameState, this.playerId, this.map),
      () => this.transitionToPhase(),
      'Local skip combat error:',
    );
  }

  private localCheckGameEnd() {
    if (!this.gameState || this.gameState.phase !== 'gameOver') return;
    this.showGameOverOutcome(this.gameState.winner === this.playerId, this.gameState.winReason ?? '');
  }

  private runAITurn() {
    this.processAIPhases();
  }

  private processAIPhases() {
    const plan = deriveAIActionPlan(this.gameState, this.playerId, this.map, this.aiDifficulty);

    switch (plan.kind) {
      case 'none':
        return;
      case 'astrogation':
        this.handleLocalResolution(
          resolveAstrogationStep(this.gameState!, plan.aiPlayer, plan.orders, this.map),
          () => this.processAIPhases(),
          plan.errorPrefix,
        );
        return;
      case 'ordnance': {
        for (const entry of plan.logEntries) {
          this.ui.logText(entry);
        }
        const resolution = plan.skip
          ? resolveSkipOrdnanceStep(this.gameState!, plan.aiPlayer, this.map)
          : resolveOrdnanceStep(this.gameState!, plan.aiPlayer, plan.launches, this.map);
        this.handleLocalResolution(resolution, () => this.processAIPhases(), plan.errorPrefix);
        return;
      }
      case 'beginCombat':
        this.handleLocalResolution(
          resolveBeginCombatStep(this.gameState!, plan.aiPlayer, this.map),
          () => this.processAIPhases(),
          plan.errorPrefix,
        );
        return;
      case 'combat': {
        const resolution = plan.skip
          ? resolveSkipCombatStep(this.gameState!, plan.aiPlayer, this.map)
          : resolveCombatStep(this.gameState!, plan.aiPlayer, plan.attacks, this.map, false);
        this.handleLocalResolution(resolution, () => this.transitionToPhase(), plan.errorPrefix);
        return;
      }
      case 'transition':
        this.localCheckGameEnd();
        if (this.gameState) {
          this.transitionToPhase();
        }
        return;
    }
  }

  private cycleShip(direction: number) {
    if (!this.gameState) return;
    const nextShip = getNextSelectedShip(
      this.gameState,
      this.playerId,
      this.renderer.planningState.selectedShipId,
      direction,
    );
    if (!nextShip) return;
    this.renderer.planningState.selectedShipId = nextShip.id;
    this.renderer.centerOnHex(nextShip.position);
    this.updateHUD();
  }

  private focusNearestEnemy() {
    if (!this.gameState) return;
    const position = getNearestEnemyPosition(
      this.gameState,
      this.playerId,
      this.renderer.camera.x,
      this.renderer.camera.y,
      HEX_SIZE,
    );
    if (!position) {
      this.ui.showToast('No detected enemies', 'info');
      return;
    }
    this.renderer.centerOnHex(position);
  }

  private focusOwnFleet() {
    if (!this.gameState) return;
    const position = getOwnFleetFocusPosition(
      this.gameState,
      this.playerId,
      this.renderer.planningState.selectedShipId,
    );
    if (!position) return;
    this.renderer.centerOnHex(position);
  }

  // --- Burn shortcuts ---

  private setBurnDirection(dir: number) {
    if (this.state !== 'playing_astrogation') return;
    const selectedShipId = this.renderer.planningState.selectedShipId;
    const currentBurn = selectedShipId ? (this.renderer.planningState.burns.get(selectedShipId) ?? null) : null;
    const plan = deriveBurnChangePlan(this.gameState, selectedShipId, dir, currentBurn);

    if (plan.kind === 'error') {
      this.ui.showToast(plan.message, plan.level);
      return;
    }
    if (plan.kind === 'noop') {
      return;
    }

    this.renderer.planningState.burns.set(plan.shipId, plan.nextBurn);
    if (plan.clearOverload) {
      this.renderer.planningState.overloads.delete(plan.shipId);
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
    const hud = deriveHudViewModel(this.gameState, this.playerId, this.renderer.planningState);
    this.ui.updateHUD(
      hud.turn,
      hud.phase,
      hud.isMyTurn,
      hud.fuel,
      hud.maxFuel,
      hud.hasBurns,
      hud.cargoFree,
      hud.cargoMax,
      hud.objective,
      hud.canOverload,
      hud.canEmplaceBase,
    );
    this.ui.updateLatency(!this.isLocalGame && this.latencyMs >= 0 ? this.latencyMs : null);
    this.ui.updateFleetStatus(hud.fleetStatus);
    this.ui.updateShipList(hud.myShips, hud.selectedId, this.renderer.planningState.burns);
  }

  private logScenarioBriefing() {
    if (!this.gameState) return;
    for (const entry of deriveScenarioBriefingEntries(this.gameState, this.playerId)) {
      this.ui.logText(entry.text, entry.cssClass);
    }
  }

  private toggleHelp() {
    this.ui.toggleHelpOverlay();
  }

  private updateSoundButton() {
    this.ui.updateSoundButton(isMuted());
  }

  private startTurnTimer() {
    this.stopTurnTimer();
    this.turnStartTime = Date.now();
    this.timerWarningPlayed = false;
    this.turnTimerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.turnStartTime) / 1000);
      const timer = deriveTurnTimer(elapsed, Math.floor(TURN_TIMEOUT_MS / 1000));
      this.ui.setTurnTimer(timer.text, timer.className);
      // Warning at 30s remaining
      if (timer.shouldWarn && !this.timerWarningPlayed) {
        this.timerWarningPlayed = true;
        playWarning();
        this.ui.showToast('30 seconds remaining!', 'error');
      }
    }, 1000);
  }

  private stopTurnTimer() {
    if (this.turnTimerInterval !== null) {
      clearInterval(this.turnTimerInterval);
      this.turnTimerInterval = null;
    }
    this.ui.clearTurnTimer();
  }

  private logLandings(movements: ShipMovement[]) {
    for (const entry of deriveLandingLogEntries(this.gameState, movements)) {
      this.ui.logLanding(entry.shipName, entry.bodyName);
      this.renderer.showLandingEffect(entry.destination);
      if (entry.resupplyText) {
        this.ui.logText(entry.resupplyText);
      }
    }
  }

  private updateTooltip(screenX: number, screenY: number) {
    const gameState = this.gameState;
    const worldPos = this.renderer.camera.screenToWorld(screenX, screenY);
    const hoverHex = pixelToHex(worldPos, HEX_SIZE);
    const ship = getTooltipShip(gameState, this.state, this.playerId, hoverHex);

    if (!ship || !gameState) {
      this.tooltipEl.style.display = 'none';
      return;
    }

    this.tooltipEl.innerHTML = buildShipTooltipHtml(gameState, ship, this.playerId, this.map);
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
