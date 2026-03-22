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
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../shared/map-data';
import type {
  CombatResult,
  FleetPurchase,
  GameState,
} from '../shared/types/domain';
import type { S2C } from '../shared/types/protocol';
import { initAudio, isMuted, playWarning, setMuted } from './audio';
import { byId, hide } from './dom';
import type { AstrogationActionDeps } from './game/astrogation-actions';
import {
  type CameraController,
  createCameraController,
} from './game/camera-controller';
import {
  setAIDifficulty,
  setLatencyMs,
  setReconnectAttempts,
  setScenario,
  setTransport,
} from './game/client-context-store';
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
import { applyClientGameState } from './game/game-state-store';
import { createHudController, type HudController } from './game/hud-controller';
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
  buildJoinCheckUrl,
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
import { createLocalTransport, type GameTransport } from './game/transport';
import {
  createTurnTelemetryTracker,
  type TurnTelemetryTracker,
} from './game/turn-telemetry';
import { resolveUIEventPlan } from './game/ui-event-router';
import { InputHandler } from './input';
import { Renderer } from './renderer/renderer';
import { installGlobalErrorHandlers, track } from './telemetry';
import { createTutorial, type Tutorial } from './tutorial';
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
  private readonly turnTelemetry: TurnTelemetryTracker =
    createTurnTelemetryTracker();
  private hud!: HudController;
  private camera!: CameraController;
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
        updateHUD: () => this.hud.updateHUD(),
        showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
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
        showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
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
        showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
        logText: (text) => this.ui.log.logText(text),
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
        logText: (text) => this.ui.log.logText(text),
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
    this.tutorial = createTutorial();
    this.tutorial.onTelemetry = (evt) => track(evt);
    this.tooltipEl = byId('shipTooltip');
    this.connection = createConnectionManager({
      getGameCode: () => this.ctx.gameCode,
      getGameState: () => this.ctx.gameState,
      getClientState: () => this.ctx.state,
      getStoredPlayerToken: (code) => this.getStoredPlayerToken(code),
      getReconnectAttempts: () => this.ctx.reconnectAttempts,
      setReconnectAttempts: (n) => {
        setReconnectAttempts(this.ctx, n);
      },
      setTransport: (t) => {
        setTransport(this.ctx, t);
      },
      setLatencyMs: (ms) => {
        setLatencyMs(this.ctx, ms);
      },
      setState: (s) => this.setState(s),
      handleMessage: (msg) => this.handleMessage(msg),
      showReconnecting: (attempt, max, onCancel) =>
        this.ui.overlay.showReconnecting(attempt, max, onCancel),
      hideReconnecting: () => this.ui.overlay.hideReconnecting(),
      showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
      exitToMenu: () => this.exitToMenu(),
    });
    this.turnTimer = createTurnTimerManager({
      setTurnTimer: (text, className) => this.ui.setTurnTimer(text, className),
      clearTurnTimer: () => this.ui.clearTurnTimer(),
      showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
      playWarning,
    });
    this.hud = createHudController({
      getGameState: () => this.ctx.gameState,
      getPlayerId: () => this.ctx.playerId,
      getClientState: () => this.ctx.state,
      getPlanningState: () => this.ctx.planningState,
      getMap: () => this.map,
      getLatencyMs: () => this.ctx.latencyMs,
      getIsLocalGame: () => this.ctx.isLocalGame,
      ui: this.ui,
      renderer: this.renderer,
      tooltipEl: this.tooltipEl,
    });
    this.camera = createCameraController({
      getGameState: () => this.ctx.gameState,
      getPlayerId: () => this.ctx.playerId,
      getPlanningState: () => this.ctx.planningState,
      renderer: this.renderer,
      overlay: this.ui.overlay,
      onShipSelected: () => this.hud.updateHUD(),
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
    this.hud.updateSoundButton();
    soundBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      this.hud.updateSoundButton();
    });
    // Ship hover tooltip
    this.canvas.addEventListener('mousemove', (e) =>
      this.hud.updateTooltip(e.clientX, e.clientY),
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
      // Strip token from URL to avoid leaking it
      history.replaceState(null, '', buildGameRoute(normalizedCode));
      this.joinGame(normalizedCode, playerToken);
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
        updateHUD: () => this.hud.updateHUD(),
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
      setScenario(this.ctx, scenario);
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
        this.ui.overlay.showToast(
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
        this.ui.overlay.showToast(
          'Game creation timed out. Try again.',
          'error',
        );
      } else if (err instanceof TypeError) {
        this.ui.overlay.showToast(
          'Network error \u2014 check your connection.',
          'error',
        );
      } else {
        this.ui.overlay.showToast('Failed to create game. Try again.', 'error');
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
        clearLog: () => this.ui.log.clear(),
        setChatEnabled: (enabled) => this.ui.log.setChatEnabled(enabled),
        logText: (text) => this.ui.log.logText(text),
        trackGameCreated: (details) => track('game_created', details),
        applyGameState: (state) => this.applyGameState(state),
        logScenarioBriefing: () => this.hud.logScenarioBriefing(),
        setState: (state) => this.setState(state),
        runLocalAI: () => this.runAITurn(),
      },
      scenario,
    );
  }
  private joinGame(code: string, playerToken: string | null = null) {
    void beginJoinGameSession(
      {
        ctx: this.ctx,
        storePlayerToken: (gameCode, token) =>
          this.storePlayerToken(gameCode, token),
        resetTurnTelemetry: () => this.turnTelemetry.reset(),
        replaceRoute: (route) => history.replaceState(null, '', route),
        buildGameRoute,
        connect: (gameCode) => this.connect(gameCode),
        setState: (state) => this.setState(state),
        validateJoin: (gameCode, token) => this.validateJoin(gameCode, token),
        showToast: (message, type) => this.ui.overlay.showToast(message, type),
        exitToMenu: () => this.exitToMenu(),
      },
      code,
      playerToken,
    );
  }
  private async validateJoin(
    code: string,
    playerToken: string | null,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(
        buildJoinCheckUrl(window.location, code, playerToken),
        {
          signal: abort.signal,
        },
      );
      clearTimeout(timer);
      if (response.ok) {
        return { ok: true };
      }
      const message = (await response.text()) || 'Could not join game';
      return { ok: false, message };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          ok: false,
          message: 'Join check timed out. Try again.',
        };
      }
      if (err instanceof TypeError) {
        return {
          ok: false,
          message: 'Network error — check your connection.',
        };
      }
      return {
        ok: false,
        message: 'Could not join game',
      };
    }
  }
  private getTokenStore(): Record<
    string,
    {
      playerToken?: string;
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
    applyClientGameState(
      {
        ctx: this.ctx,
        renderer: this.renderer,
      },
      state,
    );
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
      logScenarioBriefing: () => this.hud.logScenarioBriefing(),
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
        setAIDifficulty(this.ctx, plan.difficulty);
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
        updateHUD: () => this.hud.updateHUD(),
        cycleShip: (direction) => this.camera.cycleShip(direction),
        focusNearestEnemy: () => this.camera.focusNearestEnemy(),
        focusOwnFleet: () => this.camera.focusOwnFleet(),
        sendFleetReady: (purchases) => this.sendFleetReady(purchases),
        sendRematch: () => this.sendRematch(),
        exitToMenu: () => this.exitToMenu(),
        toggleHelp: () => this.toggleHelp(),
        updateSoundButton: () => this.hud.updateSoundButton(),
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
        this.ui.log.logTurn(turnNumber, playerLabel),
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
          this.ui.overlay.showToast(result.error, 'error');
          return;
        }
        this.applyGameState(result.state);
        this.ui.overlay.showToast('Orbital base emplaced!', 'success');
        this.hud.updateHUD();
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
          this.ui.overlay.showToast(result.error, 'error');
          return;
        }
        this.applyGameState(result.state);
        if (result.aiError) {
          console.error('AI fleet build error:', result.aiError);
        }
        this.hud.logScenarioBriefing();
        this.transitionToPhase();
      },
      onRematch: () => this.startLocalGame(this.ctx.scenario),
    });
  }
  private runAITurn = async () => {
    await runAI(this.localGameFlowDeps);
  };
  private toggleHelp() {
    this.ui.toggleHelpOverlay();
  }
  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    this.ui.overlay.showToast(message, type);
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
