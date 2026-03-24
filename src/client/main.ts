import type { AIDifficulty } from '../shared/ai';
import { buildSolarSystemMap, SCENARIOS } from '../shared/map-data';
import type { FleetPurchase, GameState } from '../shared/types/domain';
import type { S2C } from '../shared/types/protocol';
import { initAudio, playWarning } from './audio';
import { byId } from './dom';
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
import type { KeyboardAction } from './game/keyboard';
import { runAITurn as runAI } from './game/local-game-flow';
import {
  type LogisticsUIState,
  renderTransferPanel,
} from './game/logistics-ui';
import {
  autoJoinFromUrl,
  bindMainBrowserEvents,
  setupServiceWorkerReload,
} from './game/main-composition';
import {
  createMainPhaseTransitionDeps,
  createMainStateTransitionDeps,
} from './game/main-deps';
import {
  beginJoinGameFromMain,
  exitToMenuFromMain,
  handleServerMessageFromMain,
  startLocalGameFromMain,
} from './game/main-session-network';
import type { ClientState } from './game/phase';
import { transitionClientPhase } from './game/phase-controller';
import {
  createInitialPlanningState,
  type PlanningState,
} from './game/planning';
import {
  createReplayController,
  type ReplayController,
} from './game/replay-controller';
import { createSessionApi, type SessionApi } from './game/session-api';
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
  private readonly disposeBrowserEvents: () => void;
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
  private replayController!: ReplayController;
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
      trackEvent: (event, props) => track(event, props),
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
      onGameOverShown: () => this.replayController.onGameOverShown(),
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
    this.replayController = createReplayController({
      getClientContext: () => ({
        state: this.ctx.state,
        isLocalGame: this.ctx.isLocalGame,
        gameCode: this.ctx.gameCode,
        gameState: this.ctx.gameState,
      }),
      fetchReplay: (code, gameId) => this.sessionApi.fetchReplay(code, gameId),
      setReplayControls: (view) => this.ui.overlay.setReplayControls(view),
      showToast: (message, type) => this.ui.overlay.showToast(message, type),
      clearTrails: () => this.renderer.clearTrails(),
      applyGameState: (state) => this.applyGameState(state),
      updateHUD: () => this.hud.updateHUD(),
    });
    this.renderer.setMap(this.map);
    this.input.setMap(this.map);
    this.ui.onEvent = (event) => this.handleUIEvent(event);
    const soundBtn = byId('soundBtn');
    this.hud.updateSoundButton();
    this.disposeBrowserEvents = bindMainBrowserEvents({
      canvas: this.canvas,
      helpCloseBtn: byId('helpCloseBtn'),
      helpBtn: byId('helpBtn'),
      soundBtn,
      tooltipEl: this.tooltipEl,
      getState: () => this.ctx.state,
      hasGameState: () => !!this.ctx.gameState,
      getPlanningState: () => this.ctx.planningState,
      updateTooltip: (x, y) => this.hud.updateTooltip(x, y),
      onKeyboardAction: (action) => this.handleKeyboardAction(action),
      onToggleHelp: () => this.toggleHelp(),
      onUpdateSoundButton: () => this.hud.updateSoundButton(),
      showToast: (message, type) => this.showToast(message, type),
    });
    // Start render loop and audio
    initAudio();
    this.renderer.start();
    autoJoinFromUrl(
      (code, playerToken) => this.joinGame(code, playerToken),
      () => this.setState('menu'),
    );
  }

  private setState(newState: ClientState) {
    this.replayController.clearForState(newState);
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
    renderTransferPanel(panel, this.logisticsUIState);
  }

  // --- Network ---
  private startLocalGame(scenario: string) {
    startLocalGameFromMain(this.getMainNetworkDeps(), scenario);
  }

  private joinGame(code: string, playerToken: string | null = null) {
    beginJoinGameFromMain(this.getMainNetworkDeps(), code, playerToken);
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
    handleServerMessageFromMain(this.getMainNetworkDeps(), msg, () =>
      this.replayController.onGameOverMessage(),
    );
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
      case 'selectReplayMatch':
        this.replayController.selectMatch(plan.direction);
        return;
      case 'toggleReplay':
        void this.replayController.toggleReplay();
        return;
      case 'replayNav':
        this.replayController.stepReplay(plan.direction);
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
    exitToMenuFromMain(this.getMainNetworkDeps());
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

  private getMainNetworkDeps() {
    return {
      ctx: this.ctx,
      map: this.map,
      renderer: this.renderer,
      ui: this.ui,
      hud: this.hud,
      actionDeps: this.actionDeps,
      turnTelemetry: this.turnTelemetry,
      sessionApi: this.sessionApi,
      connection: this.connection,
      setMenuState: (state: ClientState) => this.setState(state),
      setState: (state: ClientState) => this.setState(state),
      applyGameState: (state: GameState) => this.applyGameState(state),
      transitionToPhase: () => this.transitionToPhase(),
      onAnimationComplete: () => this.onAnimationComplete(),
      runLocalAI: () => {
        void this.runAITurn();
      },
      track,
      createLocalTransport: () => this.createLocalTransport(),
      stopTurnTimer: () => this.turnTimer.stop(),
    };
  }

  private toggleHelp() {
    this.ui.toggleHelpOverlay();
  }

  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    this.ui.overlay.showToast(message, type);
  }

  dispose() {
    this.stopCombatWatch?.();
    this.connection.close();
    this.turnTimer.stop();
    this.disposeBrowserEvents();
    this.input.dispose();
    this.ui.dispose();
    this.tutorial.dispose();
  }
}

// --- Bootstrap ---
installGlobalErrorHandlers();
installViewportSizing();
setupServiceWorkerReload();

const game = new GameClient();
(window as Window & { game?: GameClient }).game = game;
