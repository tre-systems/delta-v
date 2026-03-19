// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

import type { AIDifficulty } from '../shared/ai';
import { CODE_LENGTH, SHIP_STATS } from '../shared/constants';
import { createGame, type MovementResult } from '../shared/engine/game-engine';
import { hexKey, pixelToHex } from '../shared/hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../shared/map-data';
import type { CombatResult, FleetPurchase, GameState, S2C } from '../shared/types';
import { initAudio, isMuted, playPhaseChange, playSelect, playWarning, setMuted } from './audio';
import { byId, hide, show } from './dom';
import type { AIActionPlan } from './game/ai-flow';
import {
  type AstrogationActionDeps,
  clearSelectedBurn as clearBurn,
  confirmOrders as confirmAstrogation,
  setBurnDirection as setBurnDir,
  undoSelectedShipBurn as undoBurn,
} from './game/astrogation-actions';
import { deriveScenarioBriefingEntries } from './game/briefing';
import {
  adjustCombatStrength as adjustStrength,
  beginCombatPhase as beginCombat,
  type CombatActionDeps,
  clearCombatSelection as clearCombatSel,
  fireAllAttacks as fireCombatAttacks,
  queueAttack as queueCombatAttack,
  resetCombatState as resetCombat,
  resetCombatStrengthToMax as resetStrength,
  sendSkipCombat,
  startCombatTargetWatch as startCombatWatch,
} from './game/combat-actions';
import { type GameCommand, keyboardActionToCommand } from './game/commands';
import { type ConnectionManager, createConnectionManager } from './game/connection';
import { resolveLocalFleetReady } from './game/fleet';
import { deriveHudViewModel } from './game/helpers';
import { getTooltipShip } from './game/hover';
import { type InputEvent, interpretInput } from './game/input-events';
import { deriveKeyboardAction, type KeyboardAction } from './game/keyboard';
import type { LocalResolution } from './game/local';
import {
  isGameOver as checkGameOver,
  localCheckGameEnd as checkLocalGameEnd,
  handleLocalResolution as handleLocalRes,
  type LocalGameFlowDeps,
  playLocalMovementResult as playLocalMovement,
  resolveAIPlan as resolveAI,
  runAITurn as runAI,
} from './game/local-game-flow';
import {
  buildTransferOrders,
  createLogisticsUIState,
  type LogisticsUIState,
  renderTransferPanel,
} from './game/logistics-ui';
import { handleServerMessage, type MessageHandlerDeps } from './game/message-handler';
import { getNearestEnemyPosition, getNextSelectedShip, getOwnFleetFocusPosition } from './game/navigation';
import { deriveGameStartClientState } from './game/network';
import {
  type OrdnanceActionDeps,
  sendEmplaceBase as sendEmplace,
  sendOrdnanceLaunch,
  sendSkipOrdnance as skipOrdnance,
} from './game/ordnance-actions';
import { type ClientState, derivePhaseTransition } from './game/phase';
import { deriveClientStateEntryPlan } from './game/phase-entry';
import { createInitialPlanningState, type PlanningState } from './game/planning';
import {
  type PresentationDeps,
  presentCombatResults as presentCombat,
  presentMovementResult as presentMovement,
  showGameOverOutcome as showGameOver,
} from './game/presentation';
import { deriveClientScreenPlan } from './game/screen';
import {
  buildGameRoute,
  buildInviteLink,
  getStoredInviteToken,
  getStoredPlayerToken,
  loadTokenStore,
  saveTokenStore,
  setStoredInviteToken,
  setStoredPlayerToken,
} from './game/session';
import { createTurnTimerManager, type TurnTimerManager } from './game/timer';
import { buildShipTooltipHtml } from './game/tooltip';
import { createLocalTransport, type GameTransport } from './game/transport';
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

  private canvas: HTMLCanvasElement;
  renderer: Renderer;
  private input: InputHandler;
  private ui: UIManager;
  private tutorial: Tutorial;
  private readonly map = buildSolarSystemMap();
  private tooltipEl: HTMLElement;
  private logisticsUIState: LogisticsUIState | null = null;
  private connection: ConnectionManager;
  private turnTimer!: TurnTimerManager;

  // Presentation orchestration deps (lazy — renderer/ui available after constructor)
  private _presentationDeps: PresentationDeps | null = null;
  private get presentationDeps(): PresentationDeps {
    if (!this._presentationDeps) {
      this._presentationDeps = {
        applyGameState: (state) => this.applyGameState(state),
        setState: (newState) => this.setState(newState as ClientState),
        resetCombatState: () => this.resetCombatState(),
        getGameState: () => this.ctx.gameState,
        getPlayerId: () => this.ctx.playerId,
        renderer: this.renderer,
        ui: this.ui,
      };
    }
    return this._presentationDeps;
  }

  // Action deps (lazy — wired to live ctx)
  private _astrogationDeps: AstrogationActionDeps | null = null;
  private get astrogationDeps(): AstrogationActionDeps {
    if (!this._astrogationDeps) {
      this._astrogationDeps = {
        getGameState: () => this.ctx.gameState,
        getClientState: () => this.ctx.state,
        getPlayerId: () => this.ctx.playerId,
        getTransport: () => this.ctx.transport,
        planningState: this.ctx.planningState,
        updateHUD: () => this.updateHUD(),
        showToast: (msg, type) => this.ui.showToast(msg, type),
      };
    }
    return this._astrogationDeps;
  }

  private _combatDeps: CombatActionDeps | null = null;
  private get combatDeps(): CombatActionDeps {
    if (!this._combatDeps) {
      this._combatDeps = {
        getGameState: () => this.ctx.gameState,
        getClientState: () => this.ctx.state,
        getPlayerId: () => this.ctx.playerId,
        getTransport: () => this.ctx.transport,
        getMap: () => this.map,
        planningState: this.ctx.planningState,
        showToast: (msg, type) => this.ui.showToast(msg, type),
        showAttackButton: (v) => this.ui.showAttackButton(v),
        showFireButton: (v, c) => this.ui.showFireButton(v, c),
      };
    }
    return this._combatDeps;
  }

  private _ordnanceDeps: OrdnanceActionDeps | null = null;
  private get ordnanceDeps(): OrdnanceActionDeps {
    if (!this._ordnanceDeps) {
      this._ordnanceDeps = {
        getGameState: () => this.ctx.gameState,
        getClientState: () => this.ctx.state,
        getTransport: () => this.ctx.transport,
        planningState: this.ctx.planningState,
        showToast: (msg, type) => this.ui.showToast(msg, type),
        logText: (text) => this.ui.logText(text),
      };
    }
    return this._ordnanceDeps;
  }

  // Local game flow deps (lazy — wired to live ctx)
  private _localGameFlowDeps: LocalGameFlowDeps | null = null;
  private get localGameFlowDeps(): LocalGameFlowDeps {
    if (!this._localGameFlowDeps) {
      this._localGameFlowDeps = {
        getGameState: () => this.ctx.gameState,
        getPlayerId: () => this.ctx.playerId,
        getMap: () => this.map,
        getAIDifficulty: () => this.ctx.aiDifficulty,
        applyGameState: (state) => this.applyGameState(state),
        presentMovementResult: (state, movements, ordnanceMovements, events, onComplete) =>
          this.presentMovementResult(state, movements, ordnanceMovements, events, onComplete),
        presentCombatResults: (prev, state, results, resetCombat) =>
          this.presentCombatResults(prev, state, results, resetCombat),
        showGameOverOutcome: (won, reason) => this.showGameOverOutcome(won, reason),
        transitionToPhase: () => this.transitionToPhase(),
        logText: (text) => this.ui.logText(text),
      };
    }
    return this._localGameFlowDeps;
  }

  constructor() {
    this.canvas = byId<HTMLCanvasElement>('gameCanvas');
    this.renderer = new Renderer(this.canvas, this.ctx.planningState);
    this.input = new InputHandler(this.canvas, this.renderer.camera, (event) => this.handleInput(event));
    this.ui = new UIManager();
    this.tutorial = new Tutorial();
    this.tooltipEl = byId('shipTooltip');

    this.connection = createConnectionManager({
      getGameCode: () => this.ctx.gameCode,
      getGameState: () => this.ctx.gameState,
      getClientState: () => this.ctx.state,
      getStoredPlayerToken: (code) => this.getStoredPlayerToken(code),
      getReconnectAttempts: () => this.ctx.reconnectAttempts,
      setReconnectAttempts: (n) => {
        this.ctx.reconnectAttempts = n;
      },
      setTransport: (t) => {
        this.ctx.transport = t;
      },
      setLatencyMs: (ms) => {
        this.ctx.latencyMs = ms;
      },
      setState: (s) => this.setState(s),
      handleMessage: (msg) => this.handleMessage(msg),
      showReconnecting: (attempt, max, onCancel) => this.ui.showReconnecting(attempt, max, onCancel),
      hideReconnecting: () => this.ui.hideReconnecting(),
      showToast: (msg, type) => this.ui.showToast(msg, type),
    });

    this.turnTimer = createTurnTimerManager({
      setTurnTimer: (text, className) => this.ui.setTurnTimer(text, className),
      clearTurnTimer: () => this.ui.clearTurnTimer(),
      showToast: (msg, type) => this.ui.showToast(msg, type),
      playWarning,
    });

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
      this.turnTimer.stop();
    }
    if (entryPlan.startTurnTimer) {
      this.turnTimer.start();
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

    // Logistics phase: init transfer UI
    if (newState === 'playing_logistics' && this.ctx.gameState) {
      this.logisticsUIState = createLogisticsUIState(this.ctx.gameState, this.ctx.playerId);
      this.renderLogisticsPanel();
    } else {
      this.logisticsUIState = null;
    }
  }

  private renderLogisticsPanel() {
    const panel = byId('transferPanel');
    if (!this.logisticsUIState) return;
    renderTransferPanel(panel, this.logisticsUIState, () => this.renderLogisticsPanel());
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
    this.ui.setChatEnabled(false);
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
    this.connection.connect(code);
  }

  private send(msg: unknown) {
    this.connection.send(msg);
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
    presentMovement(this.presentationDeps, state, movements, ordnanceMovements, events, onComplete);
  }

  private presentCombatResults(
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat = true,
  ) {
    presentCombat(this.presentationDeps, previousState, state, results, resetCombat);
  }

  private showGameOverOutcome(won: boolean, reason: string) {
    showGameOver(this.presentationDeps, won, reason);
  }

  private handleMessage(msg: S2C) {
    const deps: MessageHandlerDeps = {
      ctx: this.ctx,
      setState: (s) => this.setState(s),
      applyGameState: (s) => this.applyGameState(s),
      transitionToPhase: () => this.transitionToPhase(),
      presentMovementResult: (state, movements, ordnanceMovements, events, onComplete) =>
        this.presentMovementResult(state, movements, ordnanceMovements, events, onComplete),
      presentCombatResults: (prev, state, results) => this.presentCombatResults(prev, state, results),
      showGameOverOutcome: (won, reason) => this.showGameOverOutcome(won, reason),
      storePlayerToken: (code, token) => this.storePlayerToken(code, token),
      onAnimationComplete: () => this.onAnimationComplete(),
      logScenarioBriefing: () => this.logScenarioBriefing(),
      deserializeState: (raw) => this.deserializeState(raw),
      renderer: this.renderer,
      ui: this.ui,
    };
    handleServerMessage(deps, msg);
  }

  private handleDisconnect() {
    this.connection.handleDisconnect();
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
      case 'skipLogistics':
        this.dispatch({ type: 'skipLogistics' });
        return;
      case 'confirmTransfers':
        this.dispatch({ type: 'confirmTransfers' });
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
      case 'chat':
        this.ctx.transport?.sendChat(event.text);
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
        confirmAstrogation(this.astrogationDeps);
        return;
      case 'undoBurn':
        undoBurn(this.astrogationDeps);
        return;
      case 'setBurnDirection':
        setBurnDir(this.astrogationDeps, cmd.direction, cmd.shipId);
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
        clearBurn(this.astrogationDeps);
        return;
      case 'queueAttack':
        queueCombatAttack(this.combatDeps);
        return;
      case 'fireAllAttacks':
        fireCombatAttacks(this.combatDeps);
        return;
      case 'skipCombat':
        sendSkipCombat(this.combatDeps);
        return;
      case 'adjustCombatStrength':
        adjustStrength(this.combatDeps, cmd.delta);
        return;
      case 'resetCombatStrength':
        resetStrength(this.combatDeps);
        return;
      case 'setCombatPlan':
        Object.assign(this.ctx.planningState, cmd.plan);
        if (cmd.selectedShipId) this.ctx.planningState.selectedShipId = cmd.selectedShipId;
        this.updateHUD();
        return;
      case 'clearCombatSelection':
        clearCombatSel(this.combatDeps);
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
        sendOrdnanceLaunch(this.ordnanceDeps, cmd.ordType);
        return;
      case 'emplaceBase':
        sendEmplace(this.ordnanceDeps);
        return;
      case 'skipOrdnance':
        skipOrdnance(this.ordnanceDeps);
        return;
      case 'skipLogistics': {
        const transport = this.ctx.transport;
        if (this.ctx.state === 'playing_logistics' && transport) {
          transport.skipLogistics();
        }
        return;
      }
      case 'confirmTransfers': {
        const transport2 = this.ctx.transport;
        if (this.ctx.state === 'playing_logistics' && transport2 && this.logisticsUIState) {
          const orders = buildTransferOrders(this.logisticsUIState);
          if (orders.length > 0) {
            transport2.submitLogistics(orders);
          } else {
            transport2.skipLogistics();
          }
        }
        return;
      }
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
        this.renderer.camera.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, cmd.factor);
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
      beginCombat(this.combatDeps);
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

  private resetCombatState() {
    resetCombat(this.combatDeps);
  }

  private stopCombatWatch: (() => void) | null = null;

  private startCombatTargetWatch() {
    this.stopCombatWatch?.();
    this.stopCombatWatch = startCombatWatch(this.combatDeps);
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
    this.connection.stopPing();
    this.turnTimer.stop();
    this.connection.close();
    this.ctx.gameState = null;
    this.ctx.isLocalGame = false;
    this.ctx.transport = null;
    history.replaceState(null, '', '/');
    this.setState('menu');
  }

  private playLocalMovementResult(result: MovementResult, onComplete: () => void) {
    playLocalMovement(this.localGameFlowDeps, result, onComplete);
  }

  private handleLocalResolution(resolution: LocalResolution, onContinue: () => void, errorPrefix: string) {
    handleLocalRes(this.localGameFlowDeps, resolution, onContinue, errorPrefix);
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
    checkLocalGameEnd(this.localGameFlowDeps);
  }

  private isGameOver(): boolean {
    return checkGameOver(this.localGameFlowDeps);
  }

  private runAITurn = async () => {
    await runAI(this.localGameFlowDeps);
  };

  private resolveAIPlan(plan: AIActionPlan): LocalResolution {
    return resolveAI(this.localGameFlowDeps, plan);
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
