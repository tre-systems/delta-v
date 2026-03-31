import { buildSolarSystemMap, SCENARIOS } from '../../shared/map-data';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playWarning } from '../audio';
import { byId, clearHTML } from '../dom';
import { createInputHandler } from '../input';
import type { Dispose } from '../reactive';
import { createRenderer } from '../renderer/renderer';
import { track } from '../telemetry';
import { createTutorial } from '../tutorial';
import { createUIManager } from '../ui/ui';
import { type ActionDeps, createActionDeps } from './action-deps';
import { createCameraController } from './camera-controller';
import {
  setAIDifficulty,
  setLatencyMs,
  setOpponentDisconnectDeadlineMs,
  setReconnectAttempts,
  setReconnectOverlayState,
  setScenario,
  setTransport,
} from './client-context-store';
import { setupClientRuntime } from './client-runtime';
import {
  advanceToNextAttacker,
  autoSkipCombatIfNoTargets as autoSkipCombat,
  beginCombatPhase as beginCombat,
  resetCombatState as resetCombat,
} from './combat-actions';
import { createConnectionManager } from './connection';
import { applyClientGameState } from './game-state-store';
import { createHudController } from './hud-controller';
import { runAITurn as runAI } from './local-game-flow';
import { renderTransferPanel } from './logistics-ui';
import {
  createMainMessageHandlerDeps,
  createMainPhaseTransitionDeps,
  createMainStateTransitionDeps,
} from './main-deps';
import { createMainInteractionController } from './main-interactions';
import {
  exitToMenuFromMain,
  handleServerMessageFromMain,
  type MainNetworkDeps,
  startLocalGameFromMain,
} from './main-session-network';
import type { MessageHandlerDeps } from './message-handler';
import type { ClientState } from './phase';
import { transitionClientPhase } from './phase-controller';
import {
  createReplayController,
  type ReplayController,
} from './replay-controller';
import { createSessionApi, type SessionApi } from './session-api';
import {
  type ClientSession,
  createInitialClientSession,
} from './session-model';
import { attachMainSessionEffects } from './session-signals';
import { applyClientStateTransition } from './state-transition';
import { createTurnTimerManager } from './timer';
import { createLocalGameTransport, type GameTransport } from './transport';
import { createTurnTelemetryTracker } from './turn-telemetry';

export type { ClientSession, MainNetworkDeps };

/**
 * Composition root: wires session `ctx`, reactive session effects (`session-signals`),
 * network, HUD, and input. Prefer changing behavior in `game/*` modules rather
 * than growing this closure.
 *
 * **Effect ownership (see also `game-state-store.ts`):**
 * - `setState` — only here (drives `applyClientStateTransition` + reactive session state).
 * - `applyGameState` — `applyClientGameState` (ctx + planning cleanup); the session's
 *   `gameStateSignal` then drives renderer/HUD effects.
 * - `exitToMenuSession` — clears game state via `clearClientGameState`.
 * - `attachMainSessionEffects` — owns the grouped reactive session -> renderer/UI/HUD
 *   subscriptions (selection, identity, combat controls, fleet panel, waiting copy,
 *   latency, logistics panel, HUD, and renderer game state).
 * - `clearTrails` and other renderer APIs — presentation, replay, session lifecycle.
 */
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();

  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const ui = createUIManager();
  const tutorial = createTutorial();
  tutorial.onTelemetry = (evt) => track(evt);
  const tooltipEl = byId('shipTooltip');
  const transferPanelEl = byId('transferPanel');
  const map = buildSolarSystemMap();
  const turnTelemetry = createTurnTelemetryTracker();

  const sessionHolder: { api: SessionApi | null } = { api: null };
  const networkHolder: { deps: MainNetworkDeps | null } = { deps: null };
  const messageHandlerHolder: { deps: MessageHandlerDeps | null } = {
    deps: null,
  };

  let actionDeps: ActionDeps;
  let replayController: ReplayController;

  let setState: (newState: ClientState) => void;
  let transitionToPhase: () => void;
  let disposeSessionSubscriptions: Dispose | undefined;

  const applyGameState = (state: GameState) => {
    applyClientGameState({ ctx }, state);
  };

  const resetCombatState = () => {
    resetCombat(actionDeps.combatDeps);
  };

  const autoSkipCombatIfNoTargets = () => {
    autoSkipCombat(actionDeps.combatDeps);
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
    getGameState: () => ctx.gameStateSignal.peek(),
    getClientState: () => ctx.stateSignal.peek(),
    isSpectatorSession: () => ctx.spectatorMode,
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
    setReconnectOverlayState: (state) => {
      setReconnectOverlayState(ctx, state);
    },
    setState: (s) => setState(s),
    handleMessage,
    showToast: (msg, type) => ui.overlay.showToast(msg, type),
    exitToMenu,
    trackEvent: (event, props) => track(event, props),
  });

  const turnTimer = createTurnTimerManager({
    showToast: (msg, type) => ui.overlay.showToast(msg, type),
    playWarning,
  });
  ui.bindTurnTimerSignal(turnTimer.viewSignal);

  const hud = createHudController({
    getGameState: () => ctx.gameStateSignal.peek(),
    getPlayerId: () => ctx.playerId as PlayerId,
    getClientState: () => ctx.stateSignal.peek(),
    getPlanningState: () => ctx.planningState,
    getMap: () => map,
    ui,
    renderer,
    tooltipEl,
  });

  disposeSessionSubscriptions = attachMainSessionEffects(ctx, {
    renderer,
    ui,
    hud,
    logistics: {
      renderLogisticsPanel: (state) => {
        if (!state) {
          clearHTML(transferPanelEl);
          return;
        }

        renderTransferPanel(transferPanelEl, state);
      },
    },
  });

  const camera = createCameraController({
    getGameState: () => ctx.gameStateSignal.peek(),
    getPlayerId: () => ctx.playerId as PlayerId,
    getPlanningState: () => ctx.planningState,
    renderer,
    overlay: ui.overlay,
  });

  actionDeps = createActionDeps({
    getGameState: () => ctx.gameStateSignal.peek(),
    getClientState: () => ctx.stateSignal.peek(),
    getPlayerId: () => ctx.playerId as PlayerId,
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
      state: ctx.stateSignal.peek(),
      isLocalGame: ctx.isLocalGame,
      gameCode: ctx.gameCode,
      gameState: ctx.gameStateSignal.peek(),
    }),
    fetchReplay: (code, gameId) => sessionApi.fetchReplay(code, gameId),
    showToast: (message, type) => ui.overlay.showToast(message, type),
    clearTrails: () => renderer.clearTrails(),
    applyGameState: (state) => applyGameState(state),
  });
  ui.overlay.bindReconnectStateSignal(ctx.reconnectOverlayStateSignal);
  ui.overlay.bindOpponentDisconnectDeadlineSignal(
    ctx.opponentDisconnectDeadlineMsSignal,
  );
  ui.overlay.bindHideOpponentDisconnected(() => {
    setOpponentDisconnectDeadlineMs(ctx, null);
  });
  ui.overlay.bindReplayControlsSignal(replayController.controlsSignal);

  const stateTransitionDeps = createMainStateTransitionDeps({
    ctx,
    renderer,
    ui,
    actionDeps,
    turnTelemetry,
    tutorial,
    turnTimer,
    tooltipEl,
    resetCombatState,
    autoSkipCombatIfNoTargets,
  });

  setState = (newState: ClientState) => {
    replayController.clearForState(newState);
    applyClientStateTransition(stateTransitionDeps, newState);
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
    advanceToNextAttacker: () => advanceToNextAttacker(actionDeps.combatDeps),
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
      getGameState: () => ctx.gameStateSignal.peek(),
      getPlayerId: () => ctx.playerId as PlayerId,
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
      advanceToNextAttacker: () => advanceToNextAttacker(actionDeps.combatDeps),
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
  };
  networkHolder.deps = mainNetworkDeps;

  const interactions = createMainInteractionController({
    canvas,
    map,
    ctx,
    actionDeps,
    ui,
    renderer,
    camera,
    hud,
    replayController,
    sessionApi,
    mainNetworkDeps,
    setAIDifficulty: (difficulty) => setAIDifficulty(ctx, difficulty),
    exitToMenu,
    trackEvent: (event) => track(event),
  });

  const input = createInputHandler(canvas, renderer.camera, (event) =>
    interactions.handleInput(event),
  );

  const disposeBrowserEvents = setupClientRuntime({
    canvas,
    map,
    tooltipEl,
    renderer,
    input,
    ui,
    ctx,
    updateTooltip: (x, y) => hud.updateTooltip(x, y),
    onKeyboardAction: (action) => interactions.handleKeyboardAction(action),
    onToggleHelp: () => interactions.toggleHelp(),
    onUpdateSoundButton: () => hud.updateSoundButton(),
    showToast: (message, type) => interactions.showToast(message, type),
    onUIEvent: (event) => interactions.handleUIEvent(event),
    joinGame: (code, playerToken) => interactions.joinGame(code, playerToken),
    spectateGame: (code) => interactions.spectateGame(code),
    setMenuState: () => setState('menu'),
  });

  return {
    renderer,
    showToast: interactions.showToast,
    dispose() {
      disposeSessionSubscriptions?.();
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
