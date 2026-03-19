// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

import type { AIDifficulty } from '../shared/ai';
import { CODE_LENGTH, SHIP_STATS, TURN_TIMEOUT_MS } from '../shared/constants';
import { createGame, type MovementResult } from '../shared/engine/game-engine';
import { hexKey, pixelToHex } from '../shared/hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../shared/map-data';
import type { CombatResult, FleetPurchase, GameState, S2C, Ship, ShipMovement } from '../shared/types';
import { clamp } from '../shared/util';
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
import { byId, hide, show } from './dom';
import { type AIActionPlan, deriveAIActionPlan } from './game/ai-flow';
import { deriveScenarioBriefingEntries } from './game/briefing';
import { deriveBurnChangePlan } from './game/burn';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  getAttackStrengthForSelection,
  hasSplitFireOptions,
} from './game/combat';
import { type GameCommand, keyboardActionToCommand } from './game/commands';
import { deriveGameOverPlan } from './game/endgame';
import { resolveLocalFleetReady } from './game/fleet';
import { buildAstrogationOrders, deriveHudViewModel } from './game/helpers';
import { getTooltipShip } from './game/hover';
import { type InputEvent, interpretInput } from './game/input-events';
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
import { createInitialPlanningState, type PlanningState } from './game/planning';
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
import { createLocalTransport, createWebSocketTransport, type GameTransport } from './game/transport';
import { InputHandler } from './input';
import { HEX_SIZE, Renderer } from './renderer/renderer';
import { Tutorial } from './tutorial';
import type { UIEvent } from './ui/events';
import { UIManager } from './ui/ui';

interface ClientContext {
  state: ClientState;
  playerId: number;
  gameCode: string | null;
  inviteLink: string | null;
  scenario: string;
  gameState: GameState | null;
  isLocalGame: boolean;
  aiDifficulty: AIDifficulty;
  transport: GameTransport | null;
  planningState: PlanningState;
  latencyMs: number;
  reconnectAttempts: number;
}

class GameClient {
  private ctx: ClientContext = {
    state: 'menu',
    playerId: -1,
    gameCode: null,
    inviteLink: null,
    scenario: 'biplanetary',
    gameState: null,
    isLocalGame: false,
    aiDifficulty: 'normal',
    transport: null,
    planningState: createInitialPlanningState(),
    latencyMs: -1,
    reconnectAttempts: 0,
  };

  private ws: WebSocket | null = null;
  private canvas: HTMLCanvasElement;
  renderer: Renderer;
  private input: InputHandler;
  private ui: UIManager;
  private tutorial: Tutorial;
  private readonly map = buildSolarSystemMap();
  private tooltipEl: HTMLElement;

  // Ping/latency tracking
  private pingInterval: number | null = null;
  private lastPingSent = 0;

  // Turn timer
  private turnStartTime = 0;
  private turnTimerInterval: number | null = null;
  private timerWarningPlayed = false;

  constructor() {
    this.canvas = byId<HTMLCanvasElement>('gameCanvas');
    this.renderer = new Renderer(this.canvas, this.ctx.planningState);
    this.input = new InputHandler(this.canvas, this.renderer.camera, (event) => this.handleInput(event));
    this.ui = new UIManager();
    this.tutorial = new Tutorial();
    this.tooltipEl = byId('shipTooltip');

    this.renderer.setMap(this.map);
    this.input.setMap(this.map);

    // Wire UI events
    this.ui.onEvent = (event) => this.handleUIEvent(event);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const action = deriveKeyboardAction(
        {
          state: this.ctx.state,
          hasGameState: !!this.ctx.gameState,
          typingInInput: e.target instanceof HTMLInputElement,
          combatTargetId: this.ctx.planningState.combatTargetId,
          queuedAttackCount: this.ctx.planningState.queuedAttacks.length,
          torpedoAccelActive: this.ctx.planningState.torpedoAccel !== null,
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
    byId('helpCloseBtn').addEventListener('click', () => this.toggleHelp());
    byId('helpBtn').addEventListener('click', () => this.toggleHelp());

    // Sound toggle
    const soundBtn = byId('soundBtn');
    this.updateSoundButton();
    soundBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      this.updateSoundButton();
    });

    // Ship hover tooltip
    this.canvas.addEventListener('mousemove', (e) => this.updateTooltip(e.clientX, e.clientY));
    this.canvas.addEventListener('mouseleave', () => {
      hide(this.tooltipEl);
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
    this.ctx.state = newState;
    // Hide tooltip on state changes
    hide(this.tooltipEl);

    const entryPlan = deriveClientStateEntryPlan(newState, this.ctx.gameState, this.ctx.playerId);
    const screenPlan = deriveClientScreenPlan(
      newState,
      this.ctx.gameCode,
      this.ctx.inviteLink,
      this.ctx.gameCode ? this.getStoredInviteToken(this.ctx.gameCode) : null,
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
        this.ctx.inviteLink = screenPlan.inviteLink;
        this.ui.showWaiting(screenPlan.code, screenPlan.inviteLink);
        break;

      case 'fleetBuilding':
        this.ui.showFleetBuilding(this.ctx.gameState!, this.ctx.playerId);
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
      this.ctx.planningState.selectedShipId = null;
      this.ctx.planningState.lastSelectedHex = null;
      this.ctx.planningState.burns.clear();
      this.ctx.planningState.overloads.clear();
      this.ctx.planningState.weakGravityChoices.clear();
    }
    if (entryPlan.selectedShipId !== undefined) {
      this.ctx.planningState.selectedShipId = entryPlan.selectedShipId;
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
    if (entryPlan.tutorialPhase && this.ctx.gameState) {
      this.tutorial.onPhaseChange(entryPlan.tutorialPhase, this.ctx.gameState.turnNumber);
    }
    if (entryPlan.frameOnShips) {
      this.renderer.frameOnShips();
    }
  }

  // --- Network ---

  private async createGame(scenario: string) {
    try {
      this.ctx.scenario = scenario;
      const res = await fetch('/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = (await res.json()) as { code: string; playerToken: string; inviteToken: string };
      this.ctx.gameCode = data.code;
      this.storePlayerToken(data.code, data.playerToken);
      this.storeInviteToken(data.code, data.inviteToken);
      this.ctx.inviteLink = buildInviteLink(window.location.origin, data.code, data.inviteToken);
      // Update URL
      history.replaceState(null, '', buildGameRoute(this.ctx.gameCode));
      this.connect(this.ctx.gameCode);
      this.setState('waitingForOpponent');
    } catch (err) {
      console.error('Failed to create game:', err);
      this.ui.showToast('Failed to create game. Try again.', 'error');
      this.setState('menu');
    }
  }

  private startLocalGame(scenario: string) {
    this.ctx.isLocalGame = true;
    this.ctx.playerId = 0;
    this.lastLoggedTurn = -1;
    this.renderer.setPlayerId(0);
    this.ctx.transport = this.createLocalTransport();

    const scenarioDef = SCENARIOS[scenario] ?? SCENARIOS.biplanetary;
    const state = createGame(scenarioDef, this.map, 'LOCAL', findBaseHex);
    this.renderer.clearTrails();
    this.ui.clearLog();
    this.ui.logText(`vs AI (${this.ctx.aiDifficulty}) — ${scenarioDef.name}`);
    this.applyGameState(state);
    this.logScenarioBriefing();
    const gameState = this.ctx.gameState;
    if (!gameState) return;
    this.setState(deriveGameStartClientState(gameState, this.ctx.playerId));
    if (this.ctx.state === 'playing_opponentTurn') {
      this.runAITurn();
    }
  }

  private joinGame(code: string, playerToken: string | null = null) {
    if (playerToken) {
      this.storePlayerToken(code, playerToken);
    }
    this.ctx.gameCode = code;
    this.ctx.inviteLink = null;
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
    this.ctx.transport = createWebSocketTransport((msg) => this.send(msg));
    this.startPing();
  }

  private startPing() {
    this.stopPing();
    this.ctx.latencyMs = -1;
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
    this.ctx.latencyMs = -1;
  }

  private attemptReconnect() {
    const plan = deriveReconnectAttemptPlan(this.ctx.gameCode, this.ctx.reconnectAttempts, this.maxReconnectAttempts);
    if (plan.giveUp) {
      this.ui.hideReconnecting();
      this.ui.showToast('Could not reconnect to game', 'error');
      this.setState('menu');
      return;
    }
    this.ctx.reconnectAttempts = plan.nextAttempt!;
    this.ui.showReconnecting(this.ctx.reconnectAttempts, this.maxReconnectAttempts, () => {
      // Cancel reconnection and return to menu
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.ctx.reconnectAttempts = 0;
      this.setState('menu');
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.connect(this.ctx.gameCode!);
    }, plan.delayMs!);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private applyGameState(state: GameState) {
    this.ctx.gameState = state;
    this.renderer.setGameState(state);
    // Clear selection if the selected ship was destroyed
    const selectedId = this.ctx.planningState.selectedShipId;
    if (selectedId) {
      const ship = state.ships.find((s) => s.id === selectedId);
      if (!ship || ship.destroyed) {
        this.ctx.planningState.selectedShipId = null;
      }
    }
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
    for (const [i, result] of results.entries()) {
      const target = result.targetType === 'ship' ? state.ships.find((s) => s.id === result.targetId) : null;
      const targetName = target ? (SHIP_STATS[target.type]?.name ?? target.type) : 'nuke';
      const outcome =
        result.damageType === 'eliminated'
          ? 'DESTROYED'
          : result.damageType === 'disabled'
            ? `Disabled ${result.disabledTurns}T`
            : 'Miss';
      const toastType =
        result.damageType === 'eliminated' ? 'error' : result.damageType === 'disabled' ? 'info' : 'info';
      setTimeout(() => this.ui.showToast(`${targetName}: ${outcome}`, toastType), i * 400);
    }
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
    const plan = deriveGameOverPlan(this.ctx.gameState, this.ctx.playerId, won, reason);
    this.ui.logText(plan.logText, plan.logClass);
    const loserShips = this.ctx.gameState?.ships.filter((ship: Ship) => plan.loserShipIds.includes(ship.id)) ?? [];
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
    const plan = deriveClientMessagePlan(
      this.ctx.state,
      this.ctx.reconnectAttempts,
      this.ctx.playerId,
      Date.now(),
      msg,
    );
    switch (plan.kind) {
      case 'welcome': {
        this.ctx.playerId = plan.playerId;
        this.ctx.gameCode = plan.code;
        this.storePlayerToken(plan.code, plan.playerToken);
        if (plan.clearInviteLink) {
          this.ctx.inviteLink = null;
        }
        if (plan.showReconnectToast) {
          this.ui.hideReconnecting();
          this.ui.showToast('Reconnected!', 'success');
        }
        this.ctx.reconnectAttempts = 0;
        this.renderer.setPlayerId(plan.playerId);
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
        const previousState = this.ctx.gameState;
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
          this.ctx.latencyMs = plan.latencyMs;
          this.ui.updateLatency(this.ctx.latencyMs);
        }
        break;
    }
  }

  private handleDisconnect() {
    this.stopPing();
    const handling = deriveDisconnectHandling(this.ctx.state, this.ctx.gameCode, this.ctx.gameState);
    if (handling.attemptReconnect) {
      this.attemptReconnect();
      return;
    }
    if (handling.nextState) {
      this.setState(handling.nextState);
    }
  }

  private handleKeyboardAction(action: KeyboardAction) {
    const cmd = keyboardActionToCommand(action);
    if (cmd) this.dispatch(cmd);
  }

  private handleUIEvent(event: UIEvent) {
    switch (event.type) {
      // Menu / lobby events — not game commands
      case 'selectScenario':
        this.createGame(event.scenario);
        return;
      case 'startSinglePlayer':
        this.ctx.aiDifficulty = event.difficulty;
        this.startLocalGame(event.scenario);
        return;
      case 'join':
        this.joinGame(event.code, event.playerToken ?? null);
        return;
      // In-game events → dispatch as GameCommands
      case 'undo':
        this.dispatch({ type: 'undoBurn' });
        return;
      case 'confirm':
        this.dispatch({ type: 'confirmOrders' });
        return;
      case 'launchOrdnance':
        this.dispatch({ type: 'launchOrdnance', ordType: event.ordType });
        return;
      case 'emplaceBase':
        this.dispatch({ type: 'emplaceBase' });
        return;
      case 'skipOrdnance':
        this.dispatch({ type: 'skipOrdnance' });
        return;
      case 'attack':
        this.dispatch({ type: 'queueAttack' });
        return;
      case 'fireAll':
        this.dispatch({ type: 'fireAllAttacks' });
        return;
      case 'skipCombat':
        this.dispatch({ type: 'skipCombat' });
        return;
      case 'fleetReady':
        this.dispatch({ type: 'fleetReady', purchases: event.purchases });
        return;
      case 'rematch':
        this.dispatch({ type: 'requestRematch' });
        return;
      case 'exit':
        this.dispatch({ type: 'exitToMenu' });
        return;
      case 'selectShip':
        this.dispatch({ type: 'selectShip', shipId: event.shipId });
        return;
    }
  }

  private handleInput(event: InputEvent) {
    if (this.ctx.state === 'playing_movementAnim') return;
    const commands = interpretInput(event, this.ctx.gameState, this.map, this.ctx.playerId, this.ctx.planningState);
    for (const cmd of commands) {
      this.dispatch(cmd);
    }
  }

  private dispatch(cmd: GameCommand) {
    switch (cmd.type) {
      case 'confirmOrders':
        this.confirmOrders();
        return;
      case 'undoBurn':
        this.undoSelectedShipBurn();
        return;
      case 'setBurnDirection':
        this.setBurnDirection(cmd.direction, cmd.shipId);
        return;
      case 'setOverloadDirection':
        this.ctx.planningState.overloads.set(cmd.shipId, cmd.direction);
        playSelect();
        this.updateHUD();
        return;
      case 'setWeakGravityChoices':
        this.ctx.planningState.weakGravityChoices.set(cmd.shipId, cmd.choices);
        this.updateHUD();
        return;
      case 'clearSelectedBurn':
        this.clearSelectedBurn();
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
        this.adjustCombatStrength(cmd.delta);
        return;
      case 'resetCombatStrength':
        this.resetCombatStrengthToMax();
        return;
      case 'setCombatPlan':
        Object.assign(this.ctx.planningState, cmd.plan);
        if (cmd.selectedShipId) this.ctx.planningState.selectedShipId = cmd.selectedShipId;
        this.updateHUD();
        return;
      case 'clearCombatSelection':
        this.clearCombatSelection();
        this.ui.showAttackButton(false);
        return;
      case 'undoQueuedAttack': {
        this.ctx.planningState.queuedAttacks.pop();
        const count = this.ctx.planningState.queuedAttacks.length;
        this.ui.showFireButton(count > 0, count);
        this.ui.showToast(count > 0 ? `Undid last attack (${count} queued)` : 'Attack queue cleared', 'info');
        return;
      }
      case 'launchOrdnance':
        this.sendOrdnanceLaunch(cmd.ordType);
        return;
      case 'emplaceBase':
        this.sendEmplaceBase();
        return;
      case 'skipOrdnance':
        this.sendSkipOrdnance();
        return;
      case 'fleetReady':
        this.sendFleetReady(cmd.purchases);
        return;
      case 'selectShip': {
        this.ctx.planningState.selectedShipId = cmd.shipId;
        const ship = this.ctx.gameState?.ships.find((s) => s.id === cmd.shipId);
        if (ship) {
          this.ctx.planningState.lastSelectedHex = hexKey(ship.position);
          this.renderer.centerOnHex(ship.position);
          const myAlive = this.ctx.gameState?.ships.filter((s) => s.owner === this.ctx.playerId && !s.destroyed);
          if (myAlive && myAlive.length > 1) {
            const name = SHIP_STATS[ship.type]?.name ?? ship.type;
            this.ui.showToast(`Selected: ${name}`, 'info');
          }
        }
        this.updateHUD();
        return;
      }
      case 'deselectShip':
        this.ctx.planningState.selectedShipId = null;
        this.updateHUD();
        return;
      case 'cycleShip':
        this.cycleShip(cmd.direction);
        return;
      case 'focusNearestEnemy':
        this.focusNearestEnemy();
        return;
      case 'focusOwnFleet':
        this.focusOwnFleet();
        return;
      case 'panCamera':
        this.renderer.camera.pan(cmd.dx, cmd.dy);
        return;
      case 'zoomCamera':
        this.renderer.camera.zoomAt(window.innerWidth / 2, window.innerHeight / 2, cmd.factor);
        return;
      case 'toggleLog':
        this.ui.toggleLog();
        return;
      case 'toggleHelp':
        this.toggleHelp();
        return;
      case 'toggleMute':
        setMuted(!isMuted());
        this.updateSoundButton();
        return;
      case 'setTorpedoAccel':
        this.ctx.planningState.torpedoAccel = cmd.direction;
        this.ctx.planningState.torpedoAccelSteps = cmd.steps;
        this.updateHUD();
        return;
      case 'clearTorpedoAcceleration':
        this.ctx.planningState.torpedoAccel = null;
        this.ctx.planningState.torpedoAccelSteps = null;
        this.updateHUD();
        return;
      case 'setHoverHex':
        this.ctx.planningState.hoverHex = cmd.hex;
        return;
      case 'requestRematch':
        this.sendRematch();
        return;
      case 'exitToMenu':
        this.exitToMenu();
        return;
    }
  }

  // --- Game actions ---

  private undoSelectedShipBurn() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_astrogation') return;
    const shipId = this.ctx.planningState.selectedShipId;
    if (shipId) {
      this.ctx.planningState.burns.delete(shipId);
      this.ctx.planningState.overloads.delete(shipId);
      this.ctx.planningState.weakGravityChoices.delete(shipId);
    }
    this.updateHUD();
  }

  private confirmOrders() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_astrogation' || !this.ctx.transport) return;
    const orders = buildAstrogationOrders(this.ctx.gameState, this.ctx.playerId, this.ctx.planningState);

    playConfirm();
    this.ctx.transport.submitAstrogation(orders);
  }

  private onAnimationComplete() {
    if (!this.ctx.gameState) return;
    this.transitionToPhase();
  }

  private lastLoggedTurn = -1;

  private transitionToPhase() {
    if (!this.ctx.gameState) return;
    if (this.ctx.gameState.phase === 'gameOver') return;
    const transition = derivePhaseTransition(
      this.ctx.gameState,
      this.ctx.playerId,
      this.lastLoggedTurn,
      this.ctx.isLocalGame,
    );
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
      this.runAITurn();
    }
  }

  private queueAttack() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_combat') return;
    const attack = buildCurrentAttack(this.ctx.gameState, this.ctx.playerId, this.ctx.planningState, this.map);
    if (!attack) {
      this.ui.showToast('Select an enemy ship or nuke to target', 'info');
      return;
    }

    this.ctx.planningState.queuedAttacks.push(attack);
    this.clearCombatSelection();
    this.ui.showAttackButton(false);

    const remainingAttackers = countRemainingCombatAttackers(
      this.ctx.gameState,
      this.ctx.playerId,
      this.ctx.planningState.queuedAttacks,
    );
    if (
      remainingAttackers === 0 &&
      !hasSplitFireOptions(this.ctx.gameState, this.ctx.playerId, this.ctx.planningState.queuedAttacks)
    ) {
      // No more attackers available — auto-fire
      this.fireAllAttacks();
    } else {
      const count = this.ctx.planningState.queuedAttacks.length;
      this.ui.showToast(`Attack queued (${count}). Select next target or press Enter to fire.`, 'info');
      this.ui.showFireButton(true, count);
    }
  }

  private fireAllAttacks() {
    if (!this.ctx.transport) return;
    const attacks = [...this.ctx.planningState.queuedAttacks];
    if (attacks.length === 0) {
      this.sendSkipCombat();
      return;
    }
    this.ctx.planningState.queuedAttacks = [];
    this.ui.showFireButton(false, 0);
    this.ctx.transport.submitCombat(attacks);
  }

  private beginCombatPhase() {
    if (!this.ctx.gameState || this.ctx.gameState.phase !== 'combat' || !this.ctx.transport) return;
    this.ctx.transport.beginCombat();
  }

  private combatWatchInterval: number | null = null;

  private startCombatTargetWatch() {
    if (this.combatWatchInterval) clearInterval(this.combatWatchInterval);
    this.combatWatchInterval = window.setInterval(() => {
      if (this.ctx.state !== 'playing_combat') {
        if (this.combatWatchInterval) clearInterval(this.combatWatchInterval);
        this.combatWatchInterval = null;
        return;
      }
      const hasTarget = this.ctx.planningState.combatTargetId !== null;
      this.ui.showAttackButton(hasTarget);
    }, 100);
  }

  private clearCombatSelection() {
    this.ctx.planningState.combatTargetId = null;
    this.ctx.planningState.combatTargetType = null;
    this.ctx.planningState.combatAttackerIds = [];
    this.ctx.planningState.combatAttackStrength = null;
  }

  private resetCombatState() {
    this.clearCombatSelection();
    this.ctx.planningState.queuedAttacks = [];
    this.ui.showFireButton(false, 0);
  }

  private adjustCombatStrength(delta: number) {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_combat') return;
    if (this.ctx.planningState.combatTargetType !== 'ship') return;
    const maxStrength = getAttackStrengthForSelection(this.ctx.gameState, this.ctx.planningState.combatAttackerIds);
    if (maxStrength <= 0) return;

    const current = this.ctx.planningState.combatAttackStrength ?? maxStrength;
    this.ctx.planningState.combatAttackStrength = clamp(current + delta, 1, maxStrength);
  }

  private resetCombatStrengthToMax() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_combat') return;
    if (this.ctx.planningState.combatTargetType !== 'ship') return;
    const maxStrength = getAttackStrengthForSelection(this.ctx.gameState, this.ctx.planningState.combatAttackerIds);
    if (maxStrength > 0) {
      this.ctx.planningState.combatAttackStrength = maxStrength;
    }
  }

  private sendOrdnanceLaunch(ordType: 'mine' | 'torpedo' | 'nuke') {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_ordnance' || !this.ctx.transport) return;
    const plan = resolveOrdnanceLaunchPlan(this.ctx.gameState, this.ctx.planningState, ordType);
    if (!plan.ok) {
      if (plan.message) {
        this.ui.showToast(plan.message, plan.level!);
      }
      return;
    }
    this.ui.logText(`${plan.shipName} launched ${ordType}`);
    this.ctx.transport.submitOrdnance([plan.launch!]);
  }

  private sendEmplaceBase() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_ordnance' || !this.ctx.transport) return;
    const plan = resolveBaseEmplacementPlan(this.ctx.gameState, this.ctx.planningState.selectedShipId!);
    if (!plan.ok) {
      if (plan.message) {
        this.ui.showToast(plan.message, plan.level!);
      }
      return;
    }
    this.ctx.transport.submitEmplacement(plan.emplacements!);
  }

  private sendSkipOrdnance() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_ordnance' || !this.ctx.transport) return;
    this.ctx.transport.skipOrdnance();
  }

  private sendSkipCombat() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_combat' || !this.ctx.transport) return;
    this.ctx.transport.skipCombat();
  }

  private sendFleetReady(purchases: FleetPurchase[]) {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_fleetBuilding' || !this.ctx.transport) return;
    this.ctx.transport.submitFleetReady(purchases);
    if (!this.ctx.isLocalGame) {
      this.ui.showFleetWaiting();
    }
  }

  private sendRematch() {
    this.ctx.transport?.requestRematch();
  }

  private exitToMenu() {
    this.stopPing();
    this.stopTurnTimer();
    this.ws?.close();
    this.ws = null;
    this.ctx.gameState = null;
    this.ctx.isLocalGame = false;
    this.ctx.transport = null;
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
        if (this.ctx.gameState?.phase !== 'gameOver') {
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
    if (this.ctx.gameState?.phase !== 'gameOver') {
      onContinue();
    }
  }

  // --- Local game (single player) ---

  private createLocalTransport(): GameTransport {
    return createLocalTransport({
      getState: () => this.ctx.gameState,
      getPlayerId: () => this.ctx.playerId,
      getMap: () => this.map,
      onResolution: (resolution, onContinue, errorPrefix) =>
        this.handleLocalResolution(resolution, onContinue, errorPrefix),
      onAnimationComplete: () => this.onAnimationComplete(),
      onTransitionToPhase: () => this.transitionToPhase(),
      onEmplacementResult: (result) => {
        if ('error' in result) {
          this.ui.showToast(result.error, 'error');
          return;
        }
        this.applyGameState(result.state);
        this.ui.showToast('Orbital base emplaced!', 'success');
        this.updateHUD();
      },
      onFleetReady: (purchases) => {
        if (!this.ctx.gameState) return;
        const scenarioDef = SCENARIOS[this.ctx.scenario] ?? SCENARIOS.biplanetary;
        const result = resolveLocalFleetReady(
          this.ctx.gameState,
          this.ctx.playerId,
          purchases,
          this.map,
          scenarioDef,
          this.ctx.aiDifficulty,
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
      },
      onRematch: () => this.startLocalGame(this.ctx.scenario),
    });
  }

  private localCheckGameEnd() {
    if (!this.ctx.gameState || this.ctx.gameState.phase !== 'gameOver') return;
    this.showGameOverOutcome(this.ctx.gameState.winner === this.ctx.playerId, this.ctx.gameState.winReason ?? '');
  }

  private isGameOver(): boolean {
    return !this.ctx.gameState || this.ctx.gameState.phase === 'gameOver';
  }

  private runAITurn = async () => {
    await new Promise((r) => setTimeout(r, 500));

    while (!this.isGameOver()) {
      const plan = deriveAIActionPlan(this.ctx.gameState!, this.ctx.playerId, this.map, this.ctx.aiDifficulty);

      if (plan.kind === 'none') {
        // AI is done — if it's now the human player's turn, transition the UI
        this.transitionToPhase();
        return;
      }

      if (plan.kind === 'transition') {
        this.localCheckGameEnd();
        if (!this.isGameOver()) {
          this.transitionToPhase();
        }
        return;
      }

      if (plan.kind === 'ordnance') {
        for (const entry of plan.logEntries) {
          this.ui.logText(entry);
        }
      }

      const resolution = this.resolveAIPlan(plan);
      const isCombatEnd = plan.kind === 'combat';

      await new Promise<void>((resolve) => {
        this.handleLocalResolution(
          resolution,
          () => {
            if (isCombatEnd) {
              this.transitionToPhase();
            }
            resolve();
          },
          plan.errorPrefix,
        );
      });

      if (this.isGameOver()) return;
      if (isCombatEnd) return; // transitionToPhase may schedule another runAITurn
    }
  };

  private resolveAIPlan(plan: AIActionPlan): LocalResolution {
    switch (plan.kind) {
      case 'astrogation':
        return resolveAstrogationStep(this.ctx.gameState!, plan.aiPlayer, plan.orders, this.map);
      case 'ordnance':
        return plan.skip
          ? resolveSkipOrdnanceStep(this.ctx.gameState!, plan.aiPlayer, this.map)
          : resolveOrdnanceStep(this.ctx.gameState!, plan.aiPlayer, plan.launches, this.map);
      case 'beginCombat':
        return resolveBeginCombatStep(this.ctx.gameState!, plan.aiPlayer, this.map);
      case 'combat':
        return plan.skip
          ? resolveSkipCombatStep(this.ctx.gameState!, plan.aiPlayer, this.map)
          : resolveCombatStep(this.ctx.gameState!, plan.aiPlayer, plan.attacks, this.map, false);
      default:
        return { kind: 'error', error: `Unexpected AI plan kind` };
    }
  }

  private cycleShip(direction: number) {
    if (!this.ctx.gameState) return;
    const nextShip = getNextSelectedShip(
      this.ctx.gameState,
      this.ctx.playerId,
      this.ctx.planningState.selectedShipId,
      direction,
    );
    if (!nextShip) return;
    this.ctx.planningState.selectedShipId = nextShip.id;
    this.renderer.centerOnHex(nextShip.position);
    this.updateHUD();
  }

  private focusNearestEnemy() {
    if (!this.ctx.gameState) return;
    const position = getNearestEnemyPosition(
      this.ctx.gameState,
      this.ctx.playerId,
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
    if (!this.ctx.gameState) return;
    const position = getOwnFleetFocusPosition(
      this.ctx.gameState,
      this.ctx.playerId,
      this.ctx.planningState.selectedShipId,
    );
    if (!position) return;
    this.renderer.centerOnHex(position);
  }

  // --- Burn shortcuts ---

  private setBurnDirection(dir: number | null, shipId?: string) {
    if (this.ctx.state !== 'playing_astrogation') return;
    const targetId = shipId ?? this.ctx.planningState.selectedShipId;
    if (!targetId) return;

    if (dir === null) {
      this.ctx.planningState.burns.delete(targetId);
      this.ctx.planningState.overloads.delete(targetId);
      this.ctx.planningState.weakGravityChoices.delete(targetId);
      this.updateHUD();
      return;
    }

    const currentBurn = this.ctx.planningState.burns.get(targetId) ?? null;
    const plan = deriveBurnChangePlan(this.ctx.gameState, targetId, dir, currentBurn);

    if (plan.kind === 'error') {
      this.ui.showToast(plan.message, plan.level!);
      return;
    }
    if (plan.kind === 'noop') {
      return;
    }

    this.ctx.planningState.burns.set(plan.shipId, plan.nextBurn);
    if (plan.clearOverload) {
      this.ctx.planningState.overloads.delete(plan.shipId);
    }
    playSelect();
    this.updateHUD();
  }

  private clearSelectedBurn() {
    if (!this.ctx.gameState || this.ctx.state !== 'playing_astrogation') return;
    const shipId = this.ctx.planningState.selectedShipId;
    if (!shipId) return;
    this.ctx.planningState.burns.delete(shipId);
    this.ctx.planningState.overloads.delete(shipId);
    this.ctx.planningState.weakGravityChoices.delete(shipId);
    this.updateHUD();
  }

  // --- Helpers ---

  private updateHUD() {
    if (!this.ctx.gameState) return;
    const hud = deriveHudViewModel(this.ctx.gameState, this.ctx.playerId, this.ctx.planningState);
    // Sync auto-selected ship back to planning state so keyboard shortcuts work
    if (hud.selectedId !== null && this.ctx.planningState.selectedShipId !== hud.selectedId) {
      this.ctx.planningState.selectedShipId = hud.selectedId;
    }
    this.ui.updateHUD({
      turn: hud.turn,
      phase: hud.phase,
      isMyTurn: hud.isMyTurn,
      fuel: hud.fuel,
      maxFuel: hud.maxFuel,
      hasBurns: hud.hasBurns,
      cargoFree: hud.cargoFree,
      cargoMax: hud.cargoMax,
      objective: hud.objective,
      isWarship: hud.canOverload,
      canEmplaceBase: hud.canEmplaceBase,
      speed: hud.speed,
      fuelToStop: hud.fuelToStop,
      astrogationCtx: {
        selectedShipLanded: hud.selectedShipLanded,
        selectedShipDisabled: hud.selectedShipDisabled,
        selectedShipHasBurn: hud.selectedShipHasBurn,
        allShipsHaveBurns: hud.allShipsHaveBurns,
        multipleShipsAlive: hud.multipleShipsAlive,
        hasSelection: hud.selectedId !== null,
      },
    });
    this.ui.updateLatency(!this.ctx.isLocalGame && this.ctx.latencyMs >= 0 ? this.ctx.latencyMs : null);
    this.ui.updateFleetStatus(hud.fleetStatus);
    this.ui.updateShipList(hud.myShips, hud.selectedId, this.ctx.planningState.burns);
  }

  private logScenarioBriefing() {
    if (!this.ctx.gameState) return;
    for (const entry of deriveScenarioBriefingEntries(this.ctx.gameState, this.ctx.playerId)) {
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
    if (!this.ctx.gameState) return;
    for (const entry of deriveLandingLogEntries(this.ctx.gameState, movements)) {
      this.ui.logLanding(entry.shipName, entry.bodyName);
      this.renderer.showLandingEffect(entry.destination);
      if (entry.resupplyText) {
        this.ui.logText(entry.resupplyText);
      }
    }
  }

  private updateTooltip(screenX: number, screenY: number) {
    const gameState = this.ctx.gameState;
    const worldPos = this.renderer.camera.screenToWorld(screenX, screenY);
    const hoverHex = pixelToHex(worldPos, HEX_SIZE);
    const ship = getTooltipShip(gameState, this.ctx.state, this.ctx.playerId, hoverHex);

    if (!ship || !gameState) {
      hide(this.tooltipEl);
      return;
    }

    this.tooltipEl.innerHTML = buildShipTooltipHtml(gameState, ship, this.ctx.playerId, this.map);
    show(this.tooltipEl, 'block');
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
