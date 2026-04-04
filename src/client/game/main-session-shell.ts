import { isValidScenario, SCENARIOS } from '../../shared/map-data';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import type { Renderer } from '../renderer/renderer';
import type { Tutorial } from '../tutorial';
import type { UIManager } from '../ui/ui';
import type { ActionDeps } from './action-deps';
import {
  setLatencyMs,
  setOpponentDisconnectDeadlineMs,
  setReconnectAttempts,
  setReconnectOverlayState,
  setScenario,
  setTransport,
} from './client-context-store';
import {
  advanceToNextAttacker,
  autoSkipCombatIfNoTargets as autoSkipCombat,
  beginCombatPhase as beginCombat,
} from './combat-actions';
import { type ConnectionManager, createConnectionManager } from './connection';
import { applyClientGameState } from './game-state-store';
import type { HudController } from './hud-controller';
import { runAITurn as runAI } from './local-game-flow';
import {
  createMainMessageHandlerDeps,
  createMainPhaseTransitionDeps,
  createMainStateTransitionDeps,
} from './main-deps';
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
import type { ClientSession } from './session-model';
import type { SessionTokenService } from './session-token-service';
import { applyClientStateTransition } from './state-transition';
import type { TurnTimerManager } from './timer';
import { createLocalGameTransport } from './transport';
import type { TurnTelemetryTracker } from './turn-telemetry';

type ToastType = 'error' | 'info' | 'success';

export interface MainSessionShellDeps {
  ctx: ClientSession;
  map: SolarSystemMap;
  renderer: Renderer;
  ui: UIManager;
  hud: HudController;
  actionDeps: ActionDeps;
  turnTelemetry: TurnTelemetryTracker;
  sessionTokens: Pick<
    SessionTokenService,
    'clearStoredPlayerToken' | 'getStoredPlayerToken' | 'storePlayerToken'
  >;
  tutorial: Tutorial;
  turnTimer: TurnTimerManager;
  tooltipEl: HTMLElement;
  showToast: (message: string, type: ToastType) => void;
  track: (event: string, props?: Record<string, unknown>) => void;
}

export interface MainSessionShell {
  connection: ConnectionManager;
  sessionApi: SessionApi;
  replayController: ReplayController;
  networkDeps: MainNetworkDeps;
  setState: (newState: ClientState) => void;
  transitionToPhase: () => void;
  applyGameState: (state: GameState) => void;
  exitToMenu: () => void;
}

export const createMainSessionShell = (
  args: MainSessionShellDeps,
): MainSessionShell => {
  let setState: (newState: ClientState) => void;
  let transitionToPhase: () => void;
  let replayController: ReplayController;
  let messageHandlerDeps: MessageHandlerDeps;
  let networkDeps: MainNetworkDeps;

  const applyGameState = (state: GameState) => {
    applyClientGameState(
      { ctx: args.ctx, isSpectator: args.ctx.spectatorMode },
      state,
    );
  };

  const runLocalAI = async () => {
    await runAI(args.actionDeps.localGameFlowDeps);
  };

  const onAnimationComplete = () => {
    transitionToPhase();
  };

  const handleMessage = (msg: S2C) => {
    handleServerMessageFromMain(messageHandlerDeps, msg, () =>
      replayController.onGameOverMessage(),
    );
  };

  const exitToMenu = () => {
    exitToMenuFromMain(networkDeps);
  };

  const connection = createConnectionManager({
    getGameCode: () => args.ctx.gameCode,
    getGameState: () => args.ctx.gameStateSignal.peek(),
    getClientState: () => args.ctx.stateSignal.peek(),
    isSpectatorSession: () => args.ctx.spectatorMode,
    getStoredPlayerToken: (code) =>
      args.sessionTokens.getStoredPlayerToken(code),
    getReconnectAttempts: () => args.ctx.reconnectAttempts,
    setReconnectAttempts: (count) => {
      setReconnectAttempts(args.ctx, count);
    },
    setTransport: (transport) => {
      setTransport(args.ctx, transport);
    },
    setLatencyMs: (latencyMs) => {
      setLatencyMs(args.ctx, latencyMs);
    },
    setReconnectOverlayState: (state) => {
      setReconnectOverlayState(args.ctx, state);
    },
    setState: (state) => setState(state),
    handleMessage,
    showToast: args.showToast,
    exitToMenu,
    trackEvent: args.track,
  });

  const sessionApi = createSessionApi({
    ctx: args.ctx,
    tokens: args.sessionTokens,
    showToast: args.showToast,
    setMenuLoading: (loading) => args.ui.setMenuLoading(loading),
    setState: (state) => setState(state),
    setScenario: (scenario) => setScenario(args.ctx, scenario),
    connect: (code) => connection.connect(code),
    track: args.track,
  });

  replayController = createReplayController({
    getClientContext: () => ({
      state: args.ctx.stateSignal.peek(),
      isLocalGame: args.ctx.isLocalGame,
      gameCode: args.ctx.gameCode,
      gameState: args.ctx.gameStateSignal.peek(),
    }),
    fetchReplay: (code, gameId) => sessionApi.fetchReplay(code, gameId),
    showToast: args.showToast,
    clearTrails: () => args.renderer.clearTrails(),
    applyGameState: (state) => applyGameState(state),
    frameOnActivePlayer: (state) => args.renderer.frameOnActivePlayer(state),
  });

  args.ui.overlay.bindReconnectStateSignal(
    args.ctx.reconnectOverlayStateSignal,
  );
  args.ui.overlay.bindOpponentDisconnectDeadlineSignal(
    args.ctx.opponentDisconnectDeadlineMsSignal,
  );
  args.ui.overlay.bindHideOpponentDisconnected(() => {
    setOpponentDisconnectDeadlineMs(args.ctx, null);
  });
  args.ui.overlay.bindReplayControlsSignal(replayController.controlsSignal);

  const stateTransitionDeps = createMainStateTransitionDeps({
    ctx: args.ctx,
    renderer: args.renderer,
    ui: args.ui,
    actionDeps: args.actionDeps,
    turnTelemetry: args.turnTelemetry,
    tutorial: args.tutorial,
    turnTimer: args.turnTimer,
    tooltipEl: args.tooltipEl,
    autoSkipCombatIfNoTargets: () => autoSkipCombat(args.actionDeps.combatDeps),
  });

  setState = (newState: ClientState) => {
    replayController.clearForState(newState);
    applyClientStateTransition(stateTransitionDeps, newState);
  };

  const phaseControllerDeps = createMainPhaseTransitionDeps({
    ctx: args.ctx,
    renderer: args.renderer,
    ui: args.ui,
    hud: args.hud,
    actionDeps: args.actionDeps,
    turnTelemetry: args.turnTelemetry,
    setState: (state) => setState(state),
    runLocalAI: () => {
      void runLocalAI();
    },
    beginCombat: () => beginCombat(args.actionDeps.combatDeps),
  });

  transitionToPhase = () => {
    transitionClientPhase(phaseControllerDeps);
  };

  messageHandlerDeps = createMainMessageHandlerDeps({
    ctx: args.ctx,
    renderer: args.renderer,
    ui: args.ui,
    hud: args.hud,
    actionDeps: args.actionDeps,
    turnTelemetry: args.turnTelemetry,
    storePlayerToken: (code, token) =>
      args.sessionTokens.storePlayerToken(code, token),
    setState: (state) => setState(state),
    applyGameState: (state) => applyGameState(state),
    transitionToPhase: () => transitionToPhase(),
    onAnimationComplete,
    advanceToNextAttacker: () =>
      advanceToNextAttacker(args.actionDeps.combatDeps),
    logScenarioBriefing: () => args.hud.logScenarioBriefing(),
    trackEvent: args.track,
  });

  const createLocalTransport = () => {
    return createLocalGameTransport({
      getGameState: () => args.ctx.gameStateSignal.peek(),
      getPlayerId: () => args.ctx.playerId as PlayerId,
      getMap: () => args.map,
      getScenario: () => args.ctx.scenario,
      getScenarioDef: () =>
        isValidScenario(args.ctx.scenario)
          ? SCENARIOS[args.ctx.scenario]
          : SCENARIOS.biplanetary,
      getAIDifficulty: () => args.ctx.aiDifficulty,
      localGameFlowDeps: args.actionDeps.localGameFlowDeps,
      applyGameState: (state) => applyGameState(state),
      showToast: args.showToast,
      logScenarioBriefing: () => args.hud.logScenarioBriefing(),
      transitionToPhase: () => transitionToPhase(),
      onAnimationComplete,
      advanceToNextAttacker: () =>
        advanceToNextAttacker(args.actionDeps.combatDeps),
      startLocalGame: (scenario) =>
        startLocalGameFromMain(networkDeps, scenario),
    });
  };

  networkDeps = {
    ctx: args.ctx,
    map: args.map,
    renderer: args.renderer,
    ui: args.ui,
    hud: args.hud,
    actionDeps: args.actionDeps,
    turnTelemetry: args.turnTelemetry,
    sessionApi,
    sessionTokens: args.sessionTokens,
    connection,
    setState: (state: ClientState) => setState(state),
    applyGameState: (state: GameState) => applyGameState(state),
    transitionToPhase: () => transitionToPhase(),
    onAnimationComplete,
    runLocalAI: () => {
      void runLocalAI();
    },
    track: args.track,
    createLocalTransport,
    stopTurnTimer: () => args.turnTimer.stop(),
  };

  return {
    connection,
    sessionApi,
    replayController,
    networkDeps,
    setState,
    transitionToPhase,
    applyGameState,
    exitToMenu,
  };
};
