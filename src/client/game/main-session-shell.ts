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
  setWaitingScreenState,
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
import type { PlayerProfileService } from './player-profile-service';
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
  playerProfile: Pick<PlayerProfileService, 'getProfile'>;
  sessionTokens: Pick<
    SessionTokenService,
    'clearStoredPlayerToken' | 'getStoredPlayerToken' | 'storePlayerToken'
  >;
  tutorial: Tutorial;
  turnTimer: TurnTimerManager;
  tooltipEl: HTMLElement;
  showToast: (message: string, type: ToastType) => void;
  track: (event: string, props?: Record<string, unknown>) => void;
  fetchImpl: typeof fetch;
  location: Location;
  webSocketCtor: typeof WebSocket;
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
  let archivedReplayFetchAbort: AbortController | null = null;

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

  // During replay playback the live presentation helpers flip the client
  // state to `playing_movementAnim` (see `presentMovementResult`), which
  // hides the replay bar and spectator HUD (they only render when the
  // client is in `gameOver`). Wrap the animation completion so we restore
  // the spectator-safe state before the controller schedules the next
  // entry.
  const wrapReplayDone = (onAnimationsDone: () => void) => () => {
    setState('gameOver');
    onAnimationsDone();
  };

  const presentReplayMovementEntry = (
    message: Extract<S2C, { type: 'movementResult' }>,
    onAnimationsDone: () => void,
  ) => {
    messageHandlerDeps.presentMovementResult(
      message.state,
      message.movements,
      message.ordnanceMovements,
      message.events,
      wrapReplayDone(onAnimationsDone),
    );
  };

  const presentReplayCombatResults = (
    previousState: GameState | null,
    state: GameState,
    results: Parameters<MessageHandlerDeps['presentCombatResults']>[2],
    onAnimationsDone: () => void,
  ) => {
    const prior =
      previousState ??
      args.ctx.gameStateSignal.peek() ??
      structuredClone(state);
    messageHandlerDeps.presentCombatResults(prior, state, results, false);
    setTimeout(wrapReplayDone(onAnimationsDone), 1800);
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
    webSocketCtor: args.webSocketCtor,
  });

  const sessionApi = createSessionApi({
    ctx: args.ctx,
    playerProfile: args.playerProfile,
    tokens: args.sessionTokens,
    showToast: args.showToast,
    setMenuLoading: (loading, kind) => args.ui.setMenuLoading(loading, kind),
    setWaitingScreenState: (state) => setWaitingScreenState(args.ctx, state),
    setState: (state) => setState(state),
    setScenario: (scenario) => setScenario(args.ctx, scenario),
    connect: (code) => connection.connect(code),
    track: args.track,
    fetchImpl: args.fetchImpl,
    location: args.location,
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
    logText: (text, cssClass) => args.ui.log.logText(text, cssClass),
    trackEvent: (event, props) => args.track(event, props),
    clearTrails: () => args.renderer.clearTrails(),
    applyGameState: (state) => applyGameState(state),
    frameOnActivePlayer: (state) => args.renderer.frameOnActivePlayer(state),
    presentReplayEntry: (entry, previousState, onAnimationsDone) => {
      const message = entry.message;

      if (message.type === 'movementResult') {
        presentReplayMovementEntry(message, onAnimationsDone);
        return;
      }

      if (message.type === 'combatResult') {
        presentReplayCombatResults(
          previousState,
          message.state,
          message.results,
          onAnimationsDone,
        );
        return;
      }

      if (message.type === 'combatSingleResult') {
        presentReplayCombatResults(
          previousState,
          message.state,
          [message.result],
          onAnimationsDone,
        );
        return;
      }

      args.renderer.clearTrails();
      applyGameState(message.state);
      onAnimationsDone();
    },
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
    getMap: () => args.map,
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
      logText: (text, cssClass) => args.ui.log.logText(text, cssClass),
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
    replayController,
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
    registerArchivedReplayFetchAbort: (controller) => {
      archivedReplayFetchAbort = controller;
    },
    releaseArchivedReplayFetchAbortIfMatches: (controller) => {
      if (archivedReplayFetchAbort === controller) {
        archivedReplayFetchAbort = null;
      }
    },
    abortInflightArchivedReplayFetch: () => {
      archivedReplayFetchAbort?.abort();
      archivedReplayFetchAbort = null;
    },
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
