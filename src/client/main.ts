// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  let hadServiceWorkerController = navigator.serviceWorker.controller !== null;
  let isReloadingForServiceWorker = false;

  navigator.serviceWorker.register('/sw.js').catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadServiceWorkerController) {
      hadServiceWorkerController = true;

      return;
    }

    if (isReloadingForServiceWorker) {
      return;
    }

    isReloadingForServiceWorker = true;
    window.location.reload();
  });
}

import type { AIDifficulty } from '../shared/ai';
import { CODE_LENGTH } from '../shared/constants';
import { createGame, type MovementResult } from '../shared/engine/game-engine';
import { pixelToHex } from '../shared/hex';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../shared/map-data';
import { computeCourse } from '../shared/movement';
import type {
  CombatResult,
  FleetPurchase,
  GameState,
  S2C,
} from '../shared/types';
import { initAudio, isMuted, playWarning, setMuted } from './audio';
import { byId, hide, show } from './dom';
import type { AstrogationActionDeps } from './game/astrogation-actions';
import { deriveScenarioBriefingEntries } from './game/briefing';
import {
  beginCombatPhase as beginCombat,
  type CombatActionDeps,
  resetCombatState as resetCombat,
  startCombatTargetWatch as startCombatWatch,
} from './game/combat-actions';
import { dispatchGameCommand } from './game/command-router';
import { type GameCommand, keyboardActionToCommand } from './game/commands';
import {
  type ConnectionManager,
  createConnectionManager,
} from './game/connection';
import { resolveLocalFleetReady } from './game/fleet';
import { deriveHudViewModel } from './game/helpers';
import { getTooltipShip } from './game/hover';
import { type InputEvent, interpretInput } from './game/input-events';
import { deriveKeyboardAction, type KeyboardAction } from './game/keyboard';
import {
  handleLocalResolution,
  type LocalGameFlowDeps,
  runAITurn as runAI,
} from './game/local-game-flow';
import {
  type LogisticsUIState,
  renderTransferPanel,
} from './game/logistics-ui';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './game/message-handler';
import {
  getNearestEnemyPosition,
  getNextSelectedShip,
  getOwnFleetFocusPosition,
} from './game/navigation';
import type { OrdnanceActionDeps } from './game/ordnance-actions';
import type { ClientState } from './game/phase';
import { transitionClientPhase } from './game/phase-controller';
import {
  createInitialPlanningState,
  type PlanningState,
} from './game/planning';
import {
  type PresentationDeps,
  presentCombatResults as presentCombat,
  presentMovementResult as presentMovement,
  showGameOverOutcome as showGameOver,
} from './game/presentation';
import {
  buildGameRoute,
  getStoredPlayerToken,
  loadTokenStore,
  saveTokenStore,
  setStoredPlayerToken,
} from './game/session';
import {
  beginJoinGameSession,
  completeCreatedGameSession,
  exitToMenuSession,
  startLocalGameSession,
} from './game/session-controller';
import { applyClientStateTransition } from './game/state-transition';
import { createTurnTimerManager, type TurnTimerManager } from './game/timer';
import { buildShipTooltipHtml } from './game/tooltip';
import { createLocalTransport, type GameTransport } from './game/transport';
import { TurnTelemetryTracker } from './game/turn-telemetry';
import { resolveUIEventPlan } from './game/ui-event-router';
import { InputHandler } from './input';
import { HEX_SIZE, Renderer } from './renderer/renderer';
import { installGlobalErrorHandlers, track } from './telemetry';
import { Tutorial } from './tutorial';
import type { UIEvent } from './ui/events';
import { UIManager } from './ui/ui';
import { installViewportSizing } from './viewport';

interface ClientContext {
  state: ClientState;
  playerId: number;
  gameCode: string | null;
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
  private readonly turnTelemetry = new TurnTelemetryTracker();
  // Presentation orchestration deps
  // (lazy — renderer/ui available after constructor)
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
        presentMovementResult: (
          state,
          movements,
          ordnanceMovements,
          events,
          onComplete,
        ) =>
          this.presentMovementResult(
            state,
            movements,
            ordnanceMovements,
            events,
            onComplete,
          ),
        presentCombatResults: (prev, state, results, resetCombat) =>
          this.presentCombatResults(prev, state, results, resetCombat),
        showGameOverOutcome: (won, reason) =>
          this.showGameOverOutcome(won, reason),
        transitionToPhase: () => this.transitionToPhase(),
        logText: (text) => this.ui.logText(text),
      };
    }
    return this._localGameFlowDeps;
  }
  constructor() {
    this.canvas = byId<HTMLCanvasElement>('gameCanvas');
    this.renderer = new Renderer(this.canvas, this.ctx.planningState);
    this.input = new InputHandler(this.canvas, this.renderer.camera, (event) =>
      this.handleInput(event),
    );
    this.ui = new UIManager();
    this.tutorial = new Tutorial();
    this.tutorial.onTelemetry = (evt) => track(evt);
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
      showReconnecting: (attempt, max, onCancel) =>
        this.ui.showReconnecting(attempt, max, onCancel),
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
    // Keyboard shortcuts — capture phase so events
    // arrive before any child stopPropagation (e.g.
    // chat input)
    document.addEventListener(
      'keydown',
      (e) => {
        // Escape blurs focused inputs so shortcuts
        // resume working
        if (e.key === 'Escape' && e.target instanceof HTMLInputElement) {
          (e.target as HTMLInputElement).blur();
          return;
        }
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
      },
      true,
    );
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
    this.canvas.addEventListener('mousemove', (e) =>
      this.updateTooltip(e.clientX, e.clientY),
    );
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
      // Strip token from URL to avoid leaking it
      history.replaceState(null, '', buildGameRoute(normalizedCode));
      this.joinGame(normalizedCode);
    } else {
      this.setState('menu');
    }
  }
  private setState(newState: ClientState) {
    applyClientStateTransition(
      {
        ctx: this.ctx,
        ui: this.ui,
        tutorial: this.tutorial,
        renderer: this.renderer,
        turnTimer: this.turnTimer,
        onStateChanged: (prevState, nextState) =>
          this.turnTelemetry.onStateChanged(prevState, nextState),
        hideTooltip: () => hide(this.tooltipEl),
        updateHUD: () => this.updateHUD(),
        resetCombatState: () => this.resetCombatState(),
        startCombatTargetWatch: () => this.startCombatTargetWatch(),
        setLogisticsUIState: (state) => {
          this.logisticsUIState = state;
        },
        renderLogisticsPanel: () => this.renderLogisticsPanel(),
      },
      newState,
    );
  }
  private renderLogisticsPanel() {
    const panel = byId('transferPanel');
    if (!this.logisticsUIState) return;
    renderTransferPanel(panel, this.logisticsUIState, () =>
      this.renderLogisticsPanel(),
    );
  }
  // --- Network ---
  private async createGame(scenario: string) {
    this.ui.setMenuLoading(true);
    try {
      this.ctx.scenario = scenario;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10000);
      const res = await fetch('/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario }),
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.ui.showToast(
          'Server error \u2014 try again in a moment.',
          'error',
        );
        this.setState('menu');
        return;
      }
      const data = (await res.json()) as {
        code: string;
        playerToken: string;
      };
      completeCreatedGameSession(
        {
          ctx: this.ctx,
          storePlayerToken: (code, token) => this.storePlayerToken(code, token),
          replaceRoute: (route) => history.replaceState(null, '', route),
          buildGameRoute,
          connect: (code) => this.connect(code),
          setState: (state) => this.setState(state),
          trackGameCreated: (details) => track('game_created', details),
        },
        scenario,
        data.code,
        data.playerToken,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.ui.showToast('Game creation timed out. Try again.', 'error');
      } else if (err instanceof TypeError) {
        this.ui.showToast(
          'Network error \u2014 check your connection.',
          'error',
        );
      } else {
        this.ui.showToast('Failed to create game. Try again.', 'error');
      }
      console.error('Failed to create game:', err);
      this.setState('menu');
    } finally {
      this.ui.setMenuLoading(false);
    }
  }
  private startLocalGame(scenario: string) {
    startLocalGameSession(
      {
        ctx: this.ctx,
        createLocalTransport: () => this.createLocalTransport(),
        createLocalGameState: (selectedScenario) => {
          const scenarioDef =
            SCENARIOS[selectedScenario] ?? SCENARIOS.biplanetary;
          return createGame(scenarioDef, this.map, 'LOCAL', findBaseHex);
        },
        getScenarioName: (selectedScenario) =>
          (SCENARIOS[selectedScenario] ?? SCENARIOS.biplanetary).name,
        resetTurnTelemetry: () => this.turnTelemetry.reset(),
        setRendererPlayerId: (playerId) => this.renderer.setPlayerId(playerId),
        clearTrails: () => this.renderer.clearTrails(),
        clearLog: () => this.ui.clearLog(),
        setChatEnabled: (enabled) => this.ui.setChatEnabled(enabled),
        logText: (text) => this.ui.logText(text),
        trackGameCreated: (details) => track('game_created', details),
        applyGameState: (state) => this.applyGameState(state),
        logScenarioBriefing: () => this.logScenarioBriefing(),
        setState: (state) => this.setState(state),
        runLocalAI: () => this.runAITurn(),
      },
      scenario,
    );
  }
  private joinGame(code: string, playerToken: string | null = null) {
    beginJoinGameSession(
      {
        ctx: this.ctx,
        storePlayerToken: (gameCode, token) =>
          this.storePlayerToken(gameCode, token),
        resetTurnTelemetry: () => this.turnTelemetry.reset(),
        replaceRoute: (route) => history.replaceState(null, '', route),
        buildGameRoute,
        connect: (gameCode) => this.connect(gameCode),
        setState: (state) => this.setState(state),
      },
      code,
      playerToken,
    );
  }
  private getTokenStore(): Record<
    string,
    {
      playerToken?: string;
      inviteToken?: string;
      ts: number;
    }
  > {
    return loadTokenStore(localStorage);
  }
  private saveTokenStore(
    store: Record<
      string,
      {
        playerToken?: string;
        inviteToken?: string;
        ts: number;
      }
    >,
  ): void {
    saveTokenStore(localStorage, store, Date.now());
  }
  private getStoredPlayerToken(code: string): string | null {
    return getStoredPlayerToken(this.getTokenStore(), code);
  }
  private storePlayerToken(code: string, token: string): void {
    const store = setStoredPlayerToken(
      this.getTokenStore(),
      code,
      token,
      Date.now(),
    );
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
    presentMovement(
      this.presentationDeps,
      state,
      movements,
      ordnanceMovements,
      events,
      onComplete,
    );
  }
  private presentCombatResults(
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat = true,
  ) {
    presentCombat(
      this.presentationDeps,
      previousState,
      state,
      results,
      resetCombat,
    );
  }
  private showGameOverOutcome(won: boolean, reason: string) {
    track('game_over', {
      won,
      reason,
      scenario: this.ctx.scenario,
      mode: this.ctx.isLocalGame ? 'local' : 'multiplayer',
      turn: this.ctx.gameState?.turnNumber,
    });
    showGameOver(this.presentationDeps, won, reason);
  }
  private handleMessage(msg: S2C) {
    const deps: MessageHandlerDeps = {
      ctx: this.ctx,
      setState: (s) => this.setState(s),
      applyGameState: (s) => this.applyGameState(s),
      transitionToPhase: () => this.transitionToPhase(),
      presentMovementResult: (
        state,
        movements,
        ordnanceMovements,
        events,
        onComplete,
      ) =>
        this.presentMovementResult(
          state,
          movements,
          ordnanceMovements,
          events,
          onComplete,
        ),
      presentCombatResults: (prev, state, results) =>
        this.presentCombatResults(prev, state, results),
      showGameOverOutcome: (won, reason) =>
        this.showGameOverOutcome(won, reason),
      storePlayerToken: (code, token) => this.storePlayerToken(code, token),
      resetTurnTelemetry: () => this.turnTelemetry.reset(),
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
    const plan = resolveUIEventPlan(event);

    switch (plan.kind) {
      case 'createGame':
        this.createGame(plan.scenario);
        return;
      case 'startSinglePlayer':
        this.ctx.aiDifficulty = plan.difficulty;
        this.startLocalGame(plan.scenario);
        return;
      case 'joinGame':
        this.joinGame(plan.code, plan.playerToken);
        return;
      case 'command':
        this.dispatch(plan.command);
        return;
      case 'sendChat':
        this.ctx.transport?.sendChat(plan.text);
        return;
      case 'trackOnly':
        track(plan.event);
        return;
    }
  }
  private handleInput(event: InputEvent) {
    if (this.ctx.state === 'playing_movementAnim') return;
    const commands = interpretInput(
      event,
      this.ctx.gameState,
      this.map,
      this.ctx.playerId,
      this.ctx.planningState,
    );
    for (const cmd of commands) {
      this.dispatch(cmd);
    }
  }
  private dispatch(cmd: GameCommand) {
    dispatchGameCommand(
      {
        ctx: this.ctx,
        astrogationDeps: this.astrogationDeps,
        combatDeps: this.combatDeps,
        ordnanceDeps: this.ordnanceDeps,
        logisticsUIState: this.logisticsUIState,
        ui: this.ui,
        renderer: this.renderer,
        getCanvasCenter: () => ({
          x: this.canvas.clientWidth / 2,
          y: this.canvas.clientHeight / 2,
        }),
        updateHUD: () => this.updateHUD(),
        cycleShip: (direction) => this.cycleShip(direction),
        focusNearestEnemy: () => this.focusNearestEnemy(),
        focusOwnFleet: () => this.focusOwnFleet(),
        sendFleetReady: (purchases) => this.sendFleetReady(purchases),
        sendRematch: () => this.sendRematch(),
        exitToMenu: () => this.exitToMenu(),
        toggleHelp: () => this.toggleHelp(),
        updateSoundButton: () => this.updateSoundButton(),
      },
      cmd,
    );
  }
  // --- Game actions ---
  private onAnimationComplete() {
    this.transitionToPhase();
  }
  private transitionToPhase() {
    transitionClientPhase({
      gameState: this.ctx.gameState,
      playerId: this.ctx.playerId,
      lastLoggedTurn: this.turnTelemetry.getLastLoggedTurn(),
      isLocalGame: this.ctx.isLocalGame,
      scenario: this.ctx.scenario,
      onTurnLogged: (turnNumber, context) =>
        this.turnTelemetry.onTurnLogged(turnNumber, context),
      logTurn: (turnNumber, playerLabel) =>
        this.ui.logTurn(turnNumber, playerLabel),
      beginCombat: () => beginCombat(this.combatDeps),
      setState: (state) => this.setState(state),
      runLocalAI: () => this.runAITurn(),
    });
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
    if (
      !this.ctx.gameState ||
      this.ctx.state !== 'playing_fleetBuilding' ||
      !this.ctx.transport
    ) {
      return;
    }
    this.ctx.transport.submitFleetReady(purchases);
    if (!this.ctx.isLocalGame) {
      this.ui.showFleetWaiting();
    }
  }
  private sendRematch() {
    this.ctx.transport?.requestRematch();
  }
  private exitToMenu() {
    exitToMenuSession({
      ctx: this.ctx,
      stopPing: () => this.connection.stopPing(),
      stopTurnTimer: () => this.turnTimer.stop(),
      closeConnection: () => this.connection.close(),
      resetTurnTelemetry: () => this.turnTelemetry.reset(),
      replaceRoute: (route) => history.replaceState(null, '', route),
      setState: (state) => this.setState(state),
    });
  }
  // --- Local game (single player) ---
  private createLocalTransport(): GameTransport {
    return createLocalTransport({
      getState: () => this.ctx.gameState,
      getPlayerId: () => this.ctx.playerId,
      getMap: () => this.map,
      onResolution: (resolution, onContinue, errorPrefix) =>
        handleLocalResolution(
          this.localGameFlowDeps,
          resolution,
          onContinue,
          errorPrefix,
        ),
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
        const scenarioDef =
          SCENARIOS[this.ctx.scenario] ?? SCENARIOS.biplanetary;
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
  private runAITurn = async () => {
    await runAI(this.localGameFlowDeps);
  };
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
    const hud = deriveHudViewModel(
      this.ctx.gameState,
      this.ctx.playerId,
      this.ctx.planningState,
    );
    // Sync auto-selected ship back to planning state
    if (
      hud.selectedId !== null &&
      this.ctx.planningState.selectedShipId !== hud.selectedId
    ) {
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
      canEmplaceBase: hud.canEmplaceBase,
      launchMineState: hud.launchMineState,
      launchTorpedoState: hud.launchTorpedoState,
      launchNukeState: hud.launchNukeState,
      speed: hud.speed,
      fuelToStop: hud.fuelToStop,
      astrogationCtx: {
        selectedShipLanded: hud.selectedShipLanded,
        selectedShipDisabled: hud.selectedShipDisabled,
        selectedShipHasBurn: hud.selectedShipHasBurn,
        allShipsHaveBurns: hud.allShipsHaveBurns,
        multipleShipsAlive: hud.multipleShipsAlive,
        hasSelection: hud.selectedId !== null,
        ...this.computeCrashWarning(),
      },
    });
    this.ui.updateLatency(
      !this.ctx.isLocalGame && this.ctx.latencyMs >= 0
        ? this.ctx.latencyMs
        : null,
    );
    this.ui.updateFleetStatus(hud.fleetStatus);
    this.ui.updateShipList(
      hud.myShips,
      hud.selectedId,
      this.ctx.planningState.burns,
    );
  }
  private computeCrashWarning(): {
    anyCrashed: boolean;
    crashBody: string | null;
  } {
    if (!this.ctx.gameState || !this.map) {
      return { anyCrashed: false, crashBody: null };
    }
    const state = this.ctx.gameState;
    if (state.phase !== 'astrogation') {
      return { anyCrashed: false, crashBody: null };
    }
    for (const ship of state.ships) {
      if (ship.owner !== this.ctx.playerId || ship.destroyed) {
        continue;
      }
      const burn = this.ctx.planningState.burns.get(ship.id) ?? null;
      if (burn === null) continue;
      const overload = this.ctx.planningState.overloads.get(ship.id) ?? null;
      const weakGravityChoices =
        this.ctx.planningState.weakGravityChoices.get(ship.id) ?? {};
      const course = computeCourse(ship, burn, this.map, {
        overload,
        weakGravityChoices,
        destroyedBases: state.destroyedBases,
      });
      if (course.crashed) {
        return {
          anyCrashed: true,
          crashBody: course.crashBody,
        };
      }
    }
    return { anyCrashed: false, crashBody: null };
  }
  private logScenarioBriefing() {
    if (!this.ctx.gameState) return;
    for (const entry of deriveScenarioBriefingEntries(
      this.ctx.gameState,
      this.ctx.playerId,
    )) {
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
    const ship = getTooltipShip(
      gameState,
      this.ctx.state,
      this.ctx.playerId,
      hoverHex,
    );
    if (!ship || !gameState) {
      hide(this.tooltipEl);
      return;
    }
    this.tooltipEl.innerHTML = buildShipTooltipHtml(
      gameState,
      ship,
      this.ctx.playerId,
      this.map,
    );
    show(this.tooltipEl, 'block');
    // Position tooltip offset from cursor
    this.tooltipEl.style.left = `${screenX + 12}px`;
    this.tooltipEl.style.top = `${screenY - 10}px`;
  }
  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    this.ui.showToast(message, type);
  }
  // Deserialize state from server
  private deserializeState(raw: GameState): GameState {
    return raw; // JSON types are already compatible
  }
}
// --- Bootstrap ---
installGlobalErrorHandlers();
installViewportSizing();
const __game = new GameClient();
(window as Window & { __game?: GameClient }).__game = __game;
window.addEventListener('offline', () => {
  __game.showToast("You're offline \u2014 check your connection", 'error');
});
window.addEventListener('online', () => {
  __game.showToast('Back online', 'success');
});
