import { buildSolarSystemMap, SCENARIOS } from '../../shared/map-data';
import type { FleetPurchase, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playWarning } from '../audio';
import { byId } from '../dom';
import { createInputHandler } from '../input';
import type { Dispose } from '../reactive';
import { createRenderer } from '../renderer/renderer';
import { track } from '../telemetry';
import { createTutorial } from '../tutorial';
import type { UIEvent } from '../ui/events';
import { createUIManager } from '../ui/ui';
import { type ActionDeps, createActionDeps } from './action-deps';
import { createCameraController } from './camera-controller';
import {
  setAIDifficulty,
  setLatencyMs,
  setReconnectAttempts,
  setScenario,
  setTransport,
} from './client-context-store';
import { setupClientRuntime } from './client-runtime';
import {
  beginCombatPhase as beginCombat,
  resetCombatState as resetCombat,
  startCombatTargetWatch as startCombatWatch,
} from './combat-actions';
import {
  type CommandRouterSessionRead,
  dispatchGameCommand,
} from './command-router';
import { type GameCommand, keyboardActionToCommand } from './commands';
import { createConnectionManager } from './connection';
import { applyClientGameState } from './game-state-store';
import { createHudController } from './hud-controller';
import { type InputEvent, interpretInput } from './input-events';
import type { KeyboardAction } from './keyboard';
import { runAITurn as runAI } from './local-game-flow';
import { type LogisticsUIState, renderTransferPanel } from './logistics-ui';
import {
  createMainMessageHandlerDeps,
  createMainPhaseTransitionDeps,
  createMainStateTransitionDeps,
} from './main-deps';
import {
  beginJoinGameFromMain,
  exitToMenuFromMain,
  handleServerMessageFromMain,
  type MainNetworkDeps,
  startLocalGameFromMain,
} from './main-session-network';
import type { MessageHandlerDeps } from './message-handler';
import type { ClientState } from './phase';
import { transitionClientPhase } from './phase-controller';
import { setPlanningHudBump } from './planning-hud-sync';
import {
  createReplayController,
  type ReplayController,
} from './replay-controller';
import { createSessionApi, type SessionApi } from './session-api';
import {
  type ClientSession,
  createInitialClientSession,
} from './session-model';
import {
  attachSessionMirrorHudEffect,
  createSessionReactiveMirror,
} from './session-signals';
import { applyClientStateTransition } from './state-transition';
import { createTurnTimerManager } from './timer';
import { createLocalGameTransport, type GameTransport } from './transport';
import { createTurnTelemetryTracker } from './turn-telemetry';
import { resolveUIEventPlan } from './ui-event-router';

export type { ClientSession, MainNetworkDeps };

/**
 * Composition root: wires session `ctx`, reactive mirrors (`session-signals`),
 * network, HUD, and input. Prefer changing behavior in `game/*` modules rather
 * than growing this closure.
 *
 * **Effect ownership (see also `game-state-store.ts`):**
 * - `setState` — only here (drives `applyClientStateTransition` + `clientState` mirror).
 * - `applyGameState` — wrapper here (`applyClientGameState` + `gameState` mirror).
 * - `exitToMenuSession` — clears game state via `clearClientGameState` + mirror hook.
 * - `hud.updateHUD` — invoked from `attachSessionMirrorHudEffect` when `gameState`,
 *   `clientState`, or `planningRevision` change; also from `hud-controller` internals
 *   (e.g. syncing selection from the derived view model).
 * - `renderer.setGameState` / `clearTrails` — presentation, replay, session lifecycle.
 */
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();

  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const mirror = createSessionReactiveMirror({
    gameState: ctx.gameState,
    state: ctx.state,
  });
  setPlanningHudBump(() => {
    mirror.planningRevision.update((n) => n + 1);
  });
  const ui = createUIManager();
  const tutorial = createTutorial();
  tutorial.onTelemetry = (evt) => track(evt);
  const tooltipEl = byId('shipTooltip');
  const map = buildSolarSystemMap();
  const turnTelemetry = createTurnTelemetryTracker();

  let logisticsUIState: LogisticsUIState | null = null;

  const sessionHolder: { api: SessionApi | null } = { api: null };
  const networkHolder: { deps: MainNetworkDeps | null } = { deps: null };
  const messageHandlerHolder: { deps: MessageHandlerDeps | null } = {
    deps: null,
  };

  let actionDeps: ActionDeps;
  let replayController: ReplayController;

  let stopCombatWatch: (() => void) | null = null;
  let setState: (newState: ClientState) => void;
  let transitionToPhase: () => void;
  let disposeHudMirror: Dispose | undefined;

  const applyGameState = (state: GameState) => {
    applyClientGameState(
      {
        ctx,
        renderer,
        afterApply: (s) => {
          mirror.gameState.value = s;
        },
      },
      state,
    );
  };

  const resetCombatState = () => {
    resetCombat(actionDeps.combatDeps);
  };

  const startCombatTargetWatch = () => {
    stopCombatWatch?.();
    stopCombatWatch = startCombatWatch(actionDeps.combatDeps);
  };

  const renderLogisticsPanel = () => {
    const panel = byId('transferPanel');
    if (!logisticsUIState) return;
    renderTransferPanel(panel, logisticsUIState);
  };

  const runAITurn = async () => {
    await runAI(actionDeps.localGameFlowDeps);
  };

  const onAnimationComplete = () => {
    transitionToPhase();
  };

  const handleMessage = (msg: S2C) => {
    const deps = messageHandlerHolder.deps;
    if (!deps) return;
    handleServerMessageFromMain(deps, msg, () =>
      replayController.onGameOverMessage(),
    );
  };

  const exitToMenu = () => {
    const d = networkHolder.deps;
    if (d) exitToMenuFromMain(d);
  };

  const connection = createConnectionManager({
    getGameCode: () => ctx.gameCode,
    getGameState: () => mirror.gameState.peek(),
    getClientState: () => mirror.clientState.peek(),
    getStoredPlayerToken: (code) =>
      sessionHolder.api?.getStoredPlayerToken(code) ?? null,
    getReconnectAttempts: () => ctx.reconnectAttempts,
    setReconnectAttempts: (n) => {
      setReconnectAttempts(ctx, n);
    },
    setTransport: (t) => {
      setTransport(ctx, t);
    },
    setLatencyMs: (ms) => {
      setLatencyMs(ctx, ms);
    },
    setState: (s) => setState(s),
    handleMessage,
    showReconnecting: (attempt, max, onCancel) =>
      ui.overlay.showReconnecting(attempt, max, onCancel),
    hideReconnecting: () => ui.overlay.hideReconnecting(),
    showToast: (msg, type) => ui.overlay.showToast(msg, type),
    exitToMenu,
    trackEvent: (event, props) => track(event, props),
  });

  const turnTimer = createTurnTimerManager({
    setTurnTimer: (text, className) => ui.setTurnTimer(text, className),
    clearTurnTimer: () => ui.clearTurnTimer(),
    showToast: (msg, type) => ui.overlay.showToast(msg, type),
    playWarning,
  });

  const hud = createHudController({
    getGameState: () => mirror.gameState.peek(),
    getPlayerId: () => ctx.playerId,
    getClientState: () => mirror.clientState.peek(),
    getPlanningState: () => ctx.planningState,
    getMap: () => map,
    getLatencyMs: () => ctx.latencyMs,
    getIsLocalGame: () => ctx.isLocalGame,
    ui,
    renderer,
    tooltipEl,
  });

  disposeHudMirror = attachSessionMirrorHudEffect(mirror, hud);

  const camera = createCameraController({
    getGameState: () => mirror.gameState.peek(),
    getPlayerId: () => ctx.playerId,
    getPlanningState: () => ctx.planningState,
    renderer,
    overlay: ui.overlay,
  });

  actionDeps = createActionDeps({
    getGameState: () => mirror.gameState.peek(),
    getClientState: () => mirror.clientState.peek(),
    getPlayerId: () => ctx.playerId,
    getTransport: () => ctx.transport,
    getMap: () => map,
    getAIDifficulty: () => ctx.aiDifficulty,
    getScenario: () => ctx.scenario,
    getIsLocalGame: () => ctx.isLocalGame,
    planningState: ctx.planningState,
    hud,
    ui,
    renderer,
    setState: (s) => setState(s),
    applyGameState: (s) => applyGameState(s),
    resetCombatState,
    transitionToPhase: () => transitionToPhase(),
    onGameOverShown: () => replayController.onGameOverShown(),
    track,
  });

  const sessionApi = createSessionApi({
    ctx,
    showToast: (msg, type) => ui.overlay.showToast(msg, type),
    setMenuLoading: (loading) => ui.setMenuLoading(loading),
    setState: (s) => setState(s),
    setScenario: (scenario) => setScenario(ctx, scenario),
    connect: (code) => connection.connect(code),
    track,
  });
  sessionHolder.api = sessionApi;

  replayController = createReplayController({
    getClientContext: () => ({
      state: ctx.state,
      isLocalGame: ctx.isLocalGame,
      gameCode: ctx.gameCode,
      gameState: ctx.gameState,
    }),
    fetchReplay: (code, gameId) => sessionApi.fetchReplay(code, gameId),
    setReplayControls: (view) => ui.overlay.setReplayControls(view),
    showToast: (message, type) => ui.overlay.showToast(message, type),
    clearTrails: () => renderer.clearTrails(),
    applyGameState: (state) => applyGameState(state),
  });

  const stateTransitionDeps = createMainStateTransitionDeps({
    ctx,
    renderer,
    ui,
    hud,
    actionDeps,
    turnTelemetry,
    tutorial,
    turnTimer,
    tooltipEl,
    resetCombatState,
    startCombatTargetWatch,
    setLogisticsUIState: (state) => {
      logisticsUIState = state;
    },
    renderLogisticsPanel,
  });

  setState = (newState: ClientState) => {
    replayController.clearForState(newState);
    applyClientStateTransition(stateTransitionDeps, newState);
    mirror.clientState.value = newState;
  };

  const phaseControllerDeps = createMainPhaseTransitionDeps({
    ctx,
    renderer,
    ui,
    hud,
    actionDeps,
    turnTelemetry,
    setState: (state) => setState(state),
    runLocalAI: () => {
      void runAITurn();
    },
    beginCombat: () => beginCombat(actionDeps.combatDeps),
  });

  transitionToPhase = () => {
    transitionClientPhase(phaseControllerDeps);
  };

  const messageHandlerDeps = createMainMessageHandlerDeps({
    ctx,
    renderer,
    ui,
    hud,
    actionDeps,
    turnTelemetry,
    sessionApi,
    setState: (state) => setState(state),
    applyGameState: (state) => applyGameState(state),
    transitionToPhase: () => transitionToPhase(),
    onAnimationComplete: () => onAnimationComplete(),
    logScenarioBriefing: () => hud.logScenarioBriefing(),
    trackEvent: (event, props) => track(event, props),
  });
  messageHandlerHolder.deps = messageHandlerDeps;

  const createLocalTransport = (): GameTransport => {
    const net = networkHolder.deps;
    if (!net) {
      throw new Error('Game client network deps not initialized');
    }
    return createLocalGameTransport({
      getGameState: () => mirror.gameState.peek(),
      getPlayerId: () => ctx.playerId,
      getMap: () => map,
      getScenario: () => ctx.scenario,
      getScenarioDef: () => SCENARIOS[ctx.scenario] ?? SCENARIOS.biplanetary,
      getAIDifficulty: () => ctx.aiDifficulty,
      localGameFlowDeps: actionDeps.localGameFlowDeps,
      applyGameState: (s) => applyGameState(s),
      showToast: (msg, type) => ui.overlay.showToast(msg, type),
      logScenarioBriefing: () => hud.logScenarioBriefing(),
      transitionToPhase: () => transitionToPhase(),
      onAnimationComplete: () => onAnimationComplete(),
      startLocalGame: (scenario) => startLocalGameFromMain(net, scenario),
    });
  };

  const mainNetworkDeps: MainNetworkDeps = {
    ctx,
    map,
    renderer,
    ui,
    hud,
    actionDeps,
    turnTelemetry,
    sessionApi,
    connection,
    setMenuState: (state: ClientState) => setState(state),
    setState: (state: ClientState) => setState(state),
    applyGameState: (state: GameState) => applyGameState(state),
    transitionToPhase: () => transitionToPhase(),
    onAnimationComplete: () => onAnimationComplete(),
    runLocalAI: () => {
      void runAITurn();
    },
    track,
    createLocalTransport: () => createLocalTransport(),
    stopTurnTimer: () => turnTimer.stop(),
    onAfterClearGameState: () => {
      mirror.gameState.value = null;
    },
  };
  networkHolder.deps = mainNetworkDeps;

  const handleInput = (event: InputEvent) => {
    if (mirror.clientState.peek() === 'playing_movementAnim') return;
    const commands = interpretInput(
      event,
      mirror.gameState.peek(),
      map,
      ctx.playerId,
      ctx.planningState,
    );
    for (const cmd of commands) {
      dispatch(cmd);
    }
  };

  const input = createInputHandler(canvas, renderer.camera, handleInput);

  const sendFleetReady = (purchases: FleetPurchase[]) => {
    if (
      !ctx.gameState ||
      ctx.state !== 'playing_fleetBuilding' ||
      !ctx.transport
    ) {
      return;
    }
    ctx.transport.submitFleetReady(purchases);
    if (!ctx.isLocalGame) {
      ui.showFleetWaiting();
    }
  };

  const sendRematch = () => {
    ctx.transport?.requestRematch();
  };

  const toggleHelp = () => {
    ui.toggleHelpOverlay();
  };

  const dispatch = (cmd: GameCommand) => {
    const commandCtx: CommandRouterSessionRead = {
      state: ctx.state,
      playerId: ctx.playerId,
      gameState: ctx.gameState,
      transport: ctx.transport,
      planningState: ctx.planningState,
    };
    dispatchGameCommand(
      {
        ctx: commandCtx,
        astrogationDeps: actionDeps.astrogationDeps,
        combatDeps: actionDeps.combatDeps,
        ordnanceDeps: actionDeps.ordnanceDeps,
        logisticsUIState,
        ui,
        renderer,
        getCanvasCenter: () => ({
          x: canvas.clientWidth / 2,
          y: canvas.clientHeight / 2,
        }),
        cycleShip: (direction) => camera.cycleShip(direction),
        focusNearestEnemy: () => camera.focusNearestEnemy(),
        focusOwnFleet: () => camera.focusOwnFleet(),
        sendFleetReady: (purchases) => sendFleetReady(purchases),
        sendRematch: () => sendRematch(),
        exitToMenu: () => exitToMenu(),
        toggleHelp: () => toggleHelp(),
        updateSoundButton: () => hud.updateSoundButton(),
      },
      cmd,
    );
  };

  const handleKeyboardAction = (action: KeyboardAction) => {
    const cmd = keyboardActionToCommand(action);
    if (cmd) dispatch(cmd);
  };

  const joinGame = (code: string, playerToken: string | null = null) => {
    beginJoinGameFromMain(mainNetworkDeps, code, playerToken);
  };

  const handleUIEvent = (event: UIEvent) => {
    const plan = resolveUIEventPlan(event);
    switch (plan.kind) {
      case 'createGame':
        sessionApi.createGame(plan.scenario);
        return;
      case 'startSinglePlayer':
        setAIDifficulty(ctx, plan.difficulty);
        startLocalGameFromMain(mainNetworkDeps, plan.scenario);
        return;
      case 'joinGame':
        joinGame(plan.code, plan.playerToken);
        return;
      case 'command':
        dispatch(plan.command);
        return;
      case 'selectReplayMatch':
        replayController.selectMatch(plan.direction);
        return;
      case 'toggleReplay':
        void replayController.toggleReplay();
        return;
      case 'replayNav':
        replayController.stepReplay(plan.direction);
        return;
      case 'sendChat':
        ctx.transport?.sendChat(plan.text);
        return;
      case 'trackOnly':
        track(plan.event);
        return;
    }
  };

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'info',
  ) => {
    ui.overlay.showToast(message, type);
  };

  const disposeBrowserEvents = setupClientRuntime({
    canvas,
    map,
    tooltipEl,
    renderer,
    input,
    ui,
    ctx,
    updateTooltip: (x, y) => hud.updateTooltip(x, y),
    onKeyboardAction: (action) => handleKeyboardAction(action),
    onToggleHelp: () => toggleHelp(),
    onUpdateSoundButton: () => hud.updateSoundButton(),
    showToast: (message, type) => showToast(message, type),
    onUIEvent: (event) => handleUIEvent(event),
    joinGame: (code, playerToken) => joinGame(code, playerToken),
    setMenuState: () => setState('menu'),
  });

  return {
    renderer,
    showToast,
    dispose() {
      stopCombatWatch?.();
      setPlanningHudBump(undefined);
      disposeHudMirror?.();
      connection.close();
      turnTimer.stop();
      disposeBrowserEvents();
      input.dispose();
      ui.dispose();
      tutorial.dispose();
    },
  };
};

export type GameClient = ReturnType<typeof createGameClient>;
