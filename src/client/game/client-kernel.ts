import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { playWarning } from '../audio';
import { byId, clearHTML } from '../dom';
import { createInputHandler } from '../input';
import type { Dispose } from '../reactive';
import { createRenderer } from '../renderer/renderer';
import { track } from '../telemetry';
import { createTutorial } from '../tutorial';
import { createUIManager } from '../ui/ui';
import { createActionDeps } from './action-deps';
import { createCameraController } from './camera-controller';
import { setAIDifficulty } from './client-context-store';
import { setupClientRuntime } from './client-runtime';
import { resetCombatState as resetCombat } from './combat-actions';
import { createHudController } from './hud-controller';
import { renderTransferPanel } from './logistics-ui';
import { createMainInteractionController } from './main-interactions';
import type { MainNetworkDeps } from './main-session-network';
import { createMainSessionShell } from './main-session-shell';
import type { ClientState } from './phase';
import { createPlayerProfileService } from './player-profile-service';
import type { ReplayController } from './replay-controller';
import {
  type ClientSession,
  createInitialClientSession,
} from './session-model';
import { attachMainSessionEffects } from './session-signals';
import { createSessionTokenService } from './session-token-service';
import { createTurnTimerManager } from './timer';
import { createTurnTelemetryTracker } from './turn-telemetry';

export type { ClientSession, MainNetworkDeps };

/**
 * Composition root: wires session `ctx`, reactive session effects (`session-signals`),
 * lifecycle wiring (`main-session-shell`), HUD, and input. Prefer changing
 * behavior in `game/*` modules rather than growing this closure.
 *
 * **Composition ownership (see also `game-state-store.ts`):**
 * - `main-session-shell` owns client state transitions, message handling,
 *   replay wiring, connection lifecycle, and local transport bridging.
 * - `attachMainSessionEffects` owns the grouped reactive session -> renderer/UI/HUD
 *   subscriptions (selection, identity, combat controls, fleet panel, waiting copy,
 *   latency, logistics panel, HUD, and renderer game state).
 * - `clearTrails` and other renderer APIs stay presentation-owned here.
 */
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();
  const playerProfile = createPlayerProfileService({
    storage: localStorage,
  });
  const sessionTokens = createSessionTokenService({
    storage: localStorage,
  });

  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const ui = createUIManager({
    playerProfile,
    sessionTokens,
  });
  const tutorial = createTutorial({
    openHelpSection: (sectionElementId) => ui.openHelpSection(sectionElementId),
  });
  tutorial.onTelemetry = (evt, props) => track(evt, props);
  const tooltipEl = byId('shipTooltip');
  const transferPanelEl = byId('transferPanel');
  const map = buildSolarSystemMap();
  const turnTelemetry = createTurnTelemetryTracker();

  let applyGameState: (state: GameState) => void;
  let setState: (newState: ClientState) => void;
  let transitionToPhase: () => void;
  let replayController: ReplayController;

  const resetCombatState = () => {
    resetCombat(actionDeps.combatDeps);
  };

  const showToast = (message: string, type: 'error' | 'info' | 'success') => {
    ui.overlay.showToast(message, type);
  };

  const renderLogisticsPanel = (state: typeof ctx.logisticsState) => {
    if (!state) {
      clearHTML(transferPanelEl);
      return;
    }

    renderTransferPanel(transferPanelEl, state);
  };

  const turnTimer = createTurnTimerManager({
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

  const disposeSessionSubscriptions: Dispose = attachMainSessionEffects(ctx, {
    renderer,
    ui,
    hud,
    logistics: {
      renderLogisticsPanel,
    },
  });

  const camera = createCameraController({
    getGameState: () => ctx.gameStateSignal.peek(),
    getPlayerId: () => ctx.playerId as PlayerId,
    getPlanningState: () => ctx.planningState,
    renderer,
    logText: (text, cssClass) => ui.log.logText(text, cssClass),
  });

  const actionDeps = createActionDeps({
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

  const sessionShell = createMainSessionShell({
    ctx,
    map,
    renderer,
    ui,
    hud,
    actionDeps,
    turnTelemetry,
    playerProfile,
    sessionTokens,
    turnTimer,
    tutorial,
    tooltipEl,
    showToast,
    track,
    fetchImpl: globalThis.fetch.bind(globalThis),
    location: window.location,
    webSocketCtor: WebSocket,
  });

  applyGameState = sessionShell.applyGameState;
  replayController = sessionShell.replayController;
  setState = sessionShell.setState;
  transitionToPhase = sessionShell.transitionToPhase;

  const connection = sessionShell.connection;
  const sessionApi = sessionShell.sessionApi;
  const networkDeps: MainNetworkDeps = sessionShell.networkDeps;
  const exitToMenu = sessionShell.exitToMenu;

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
    mainNetworkDeps: networkDeps,
    setAIDifficulty: (difficulty) => setAIDifficulty(ctx, difficulty),
    exitToMenu,
    trackEvent: (event, props) => track(event, props),
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
    interactions,
    updateTooltip: (x, y) => hud.updateTooltip(x, y),
    onUpdateSoundButton: () => hud.updateSoundButton(),
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
