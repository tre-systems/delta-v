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
import { createGame } from '../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../shared/map-data';
import type { FleetPurchase, GameState } from '../shared/types/domain';
import type { S2C } from '../shared/types/protocol';
import { initAudio, isMuted, playWarning, setMuted } from './audio';
import { byId, hide } from './dom';
import { type ActionDeps, createActionDeps } from './game/action-deps';
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
  resetCombatState as resetCombat,
  startCombatTargetWatch as startCombatWatch,
} from './game/combat-actions';
import { dispatchGameCommand } from './game/command-router';
import { type GameCommand, keyboardActionToCommand } from './game/commands';
import {
  type ConnectionManager,
  createConnectionManager,
} from './game/connection';
import { applyClientGameState } from './game/game-state-store';
import { createHudController, type HudController } from './game/hud-controller';
import { type InputEvent, interpretInput } from './game/input-events';
import { deriveKeyboardAction, type KeyboardAction } from './game/keyboard';
import { runAITurn as runAI } from './game/local-game-flow';
import {
  type LogisticsUIState,
  renderTransferPanel,
} from './game/logistics-ui';
import {
  createMainMessageHandlerDeps,
  createMainPhaseTransitionDeps,
  createMainStateTransitionDeps,
} from './game/main-deps';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './game/message-handler';
import type { ClientState } from './game/phase';
import { transitionClientPhase } from './game/phase-controller';
import {
  createInitialPlanningState,
  type PlanningState,
} from './game/planning';
import { buildGameRoute } from './game/session';
import { createSessionApi, type SessionApi } from './game/session-api';
import {
  beginJoinGameSession,
  exitToMenuSession,
  startLocalGameSession,
} from './game/session-controller';
import { applyClientStateTransition } from './game/state-transition';
import { createTurnTimerManager, type TurnTimerManager } from './game/timer';
import { createLocalGameTransport, type GameTransport } from './game/transport';
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
  private actionDeps!: ActionDeps;
  private sessionApi!: SessionApi;
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
      getStoredPlayerToken: (code) =>
        this.sessionApi.getStoredPlayerToken(code),
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
    this.actionDeps = createActionDeps({
      getGameState: () => this.ctx.gameState,
      getClientState: () => this.ctx.state,
      getPlayerId: () => this.ctx.playerId,
      getTransport: () => this.ctx.transport,
      getMap: () => this.map,
      getAIDifficulty: () => this.ctx.aiDifficulty,
      getScenario: () => this.ctx.scenario,
      getIsLocalGame: () => this.ctx.isLocalGame,
      planningState: this.ctx.planningState,
      hud: this.hud,
      ui: this.ui,
      renderer: this.renderer,
      setState: (s) => this.setState(s),
      applyGameState: (s) => this.applyGameState(s),
      resetCombatState: () => this.resetCombatState(),
      transitionToPhase: () => this.transitionToPhase(),
      track,
    });
    this.sessionApi = createSessionApi({
      ctx: this.ctx,
      showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
      setMenuLoading: (loading) => this.ui.setMenuLoading(loading),
      setState: (s) => this.setState(s),
      setScenario: (scenario) => setScenario(this.ctx, scenario),
      connect: (code) => this.connect(code),
      track,
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
      createMainStateTransitionDeps({
        ctx: this.ctx,
        renderer: this.renderer,
        ui: this.ui,
        hud: this.hud,
        actionDeps: this.actionDeps,
        turnTelemetry: this.turnTelemetry,
        tutorial: this.tutorial,
        turnTimer: this.turnTimer,
        tooltipEl: this.tooltipEl,
        resetCombatState: () => this.resetCombatState(),
        startCombatTargetWatch: () => this.startCombatTargetWatch(),
        setLogisticsUIState: (state) => {
          this.logisticsUIState = state;
        },
        renderLogisticsPanel: () => this.renderLogisticsPanel(),
      }),
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
          this.sessionApi.storePlayerToken(gameCode, token),
        resetTurnTelemetry: () => this.turnTelemetry.reset(),
        replaceRoute: (route) => history.replaceState(null, '', route),
        buildGameRoute,
        connect: (gameCode) => this.connect(gameCode),
        setState: (state) => this.setState(state),
        validateJoin: (gameCode, token) =>
          this.sessionApi.validateJoin(gameCode, token),
        showToast: (message, type) => this.ui.overlay.showToast(message, type),
        exitToMenu: () => this.exitToMenu(),
      },
      code,
      playerToken,
    );
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

  private handleMessage(msg: S2C) {
    const deps: MessageHandlerDeps = createMainMessageHandlerDeps({
      ctx: this.ctx,
      renderer: this.renderer,
      ui: this.ui,
      hud: this.hud,
      actionDeps: this.actionDeps,
      turnTelemetry: this.turnTelemetry,
      sessionApi: this.sessionApi,
      setState: (state) => this.setState(state),
      applyGameState: (state) => this.applyGameState(state),
      transitionToPhase: () => this.transitionToPhase(),
      onAnimationComplete: () => this.onAnimationComplete(),
      logScenarioBriefing: () => this.hud.logScenarioBriefing(),
    });
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
        this.sessionApi.createGame(plan.scenario);
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
        astrogationDeps: this.actionDeps.astrogationDeps,
        combatDeps: this.actionDeps.combatDeps,
        ordnanceDeps: this.actionDeps.ordnanceDeps,
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
    transitionClientPhase(
      createMainPhaseTransitionDeps({
        ctx: this.ctx,
        renderer: this.renderer,
        ui: this.ui,
        hud: this.hud,
        actionDeps: this.actionDeps,
        turnTelemetry: this.turnTelemetry,
        setState: (state) => this.setState(state),
        runLocalAI: () => this.runAITurn(),
        beginCombat: () => beginCombat(this.actionDeps.combatDeps),
      }),
    );
  }

  private resetCombatState() {
    resetCombat(this.actionDeps.combatDeps);
  }

  private stopCombatWatch: (() => void) | null = null;
  private startCombatTargetWatch() {
    this.stopCombatWatch?.();
    this.stopCombatWatch = startCombatWatch(this.actionDeps.combatDeps);
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
    return createLocalGameTransport({
      getGameState: () => this.ctx.gameState,
      getPlayerId: () => this.ctx.playerId,
      getMap: () => this.map,
      getScenario: () => this.ctx.scenario,
      getScenarioDef: () =>
        SCENARIOS[this.ctx.scenario] ?? SCENARIOS.biplanetary,
      getAIDifficulty: () => this.ctx.aiDifficulty,
      localGameFlowDeps: this.actionDeps.localGameFlowDeps,
      applyGameState: (s) => this.applyGameState(s),
      showToast: (msg, type) => this.ui.overlay.showToast(msg, type),
      updateHUD: () => this.hud.updateHUD(),
      logScenarioBriefing: () => this.hud.logScenarioBriefing(),
      transitionToPhase: () => this.transitionToPhase(),
      onAnimationComplete: () => this.onAnimationComplete(),
      startLocalGame: (scenario) => this.startLocalGame(scenario),
    });
  }

  private runAITurn = async () => {
    await runAI(this.actionDeps.localGameFlowDeps);
  };
  private toggleHelp() {
    this.ui.toggleHelpOverlay();
  }

  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    this.ui.overlay.showToast(message, type);
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
