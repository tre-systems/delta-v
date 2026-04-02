import { hexKey } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { createDisposalScope, type Dispose, effect } from '../reactive';
import { deriveHudViewModel } from './helpers';
import { getSelectedShip } from './selection';
import type { ClientSession } from './session-model';

type SessionIdentityConsumers = {
  renderer: { setPlayerId: (id: PlayerId | -1) => void };
  ui: { setPlayerId: (id: PlayerId | -1) => void };
};

type SessionCombatButtonsUI = {
  showAttackButton: (visible: boolean) => void;
  showFireButton: (visible: boolean, count: number) => void;
};

type SessionHudConsumer = {
  updateHUD: () => void;
};

type SessionWaitingScreenUI = {
  setWaitingState: (code: string | null, connecting: boolean) => void;
};

type SessionLatencyUI = {
  updateLatency: (latencyMs: number | null) => void;
};

type SessionFleetPanelUI = {
  updateFleetStatus: (status: string) => void;
  updateShipList: (
    ships: GameState['ships'],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) => void;
};

type SessionLogisticsPanelUI = {
  renderLogisticsPanel: (state: ClientSession['logisticsState']) => void;
};

type SessionGameStateRenderer = {
  setGameState: (state: GameState | null) => void;
};

type MainSessionEffectsDeps = {
  renderer: SessionIdentityConsumers['renderer'] & SessionGameStateRenderer;
  ui: SessionIdentityConsumers['ui'] &
    SessionCombatButtonsUI &
    SessionWaitingScreenUI &
    SessionLatencyUI &
    SessionFleetPanelUI;
  hud: SessionHudConsumer;
  logistics: SessionLogisticsPanelUI;
};

/**
 * Reconciles the planning store's selected ship with the derived active
 * selection so HUD updates can stay read-only.
 */
export const attachSessionPlanningSelectionEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerIdSignal'
  >,
): Dispose =>
  effect(() => {
    session.stateSignal.value;
    const gameState = session.gameStateSignal.value;
    const playerId = session.playerIdSignal.value;
    const planning = session.planningState;

    planning.revisionSignal?.value;

    if (!gameState || playerId === -1) {
      if (planning.selectedShipId !== null) {
        planning.setSelectedShipId(null);
      }
      return;
    }

    const selectedShip = getSelectedShip(
      gameState,
      playerId,
      planning.selectedShipId,
    );
    const selectedId = selectedShip?.id ?? null;

    if (selectedId === planning.selectedShipId) {
      return;
    }

    if (!selectedShip) {
      planning.setSelectedShipId(null);
      return;
    }

    planning.selectShip(selectedShip.id, hexKey(selectedShip.position));
  });

/**
 * Keeps combat action buttons aligned with reactive session/planning state
 * instead of imperative updates from combat action code.
 */
export const attachSessionCombatButtonsEffect = (
  session: Pick<ClientSession, 'stateSignal' | 'planningState'>,
  ui: SessionCombatButtonsUI,
): Dispose =>
  effect(() => {
    const isPlayingCombat = session.stateSignal.value === 'playing_combat';
    session.planningState.revisionSignal?.value;

    ui.showAttackButton(false);
    const hasTarget = session.planningState.combatTargetId !== null;
    const hasSelection = session.planningState.selectedShipId !== null;
    ui.showFireButton(
      isPlayingCombat && (hasTarget || hasSelection),
      hasTarget ? 1 : 0,
    );
  });

/**
 * Subscribes the HUD to the session's reactive state plus planning updates:
 * a single reactive pipeline from `gameState` / `state` / planning revision
 * to `updateHUD`.
 */
export const attachSessionHudEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerIdSignal'
  >,
  hud: SessionHudConsumer,
): Dispose =>
  effect(() => {
    session.gameStateSignal.value;
    session.stateSignal.value;
    session.playerIdSignal.value;
    session.planningState.revisionSignal?.value;
    hud.updateHUD();
  });

/** Keeps renderer and UI identity consumers aligned with the reactive session player id. */
export const attachSessionPlayerIdentityEffect = (
  session: Pick<ClientSession, 'playerIdSignal'>,
  deps: SessionIdentityConsumers,
): Dispose =>
  effect(() => {
    const playerId = session.playerIdSignal.value;

    deps.renderer.setPlayerId(playerId);
    deps.ui.setPlayerId(playerId);
  });

/** Keeps the waiting screen copy aligned with reactive session connection state. */
export const attachSessionWaitingScreenEffect = (
  session: Pick<ClientSession, 'stateSignal' | 'gameCodeSignal'>,
  ui: SessionWaitingScreenUI,
): Dispose =>
  effect(() => {
    const state = session.stateSignal.value;
    const gameCode = session.gameCodeSignal.value;

    ui.setWaitingState(
      state === 'waitingForOpponent' ? gameCode : null,
      state === 'connecting',
    );
  });

/** Keeps latency display aligned with reactive session state instead of push-style UI calls. */
export const attachSessionLatencyEffect = (
  session: Pick<ClientSession, 'latencyMsSignal' | 'isLocalGameSignal'>,
  ui: SessionLatencyUI,
): Dispose =>
  effect(() => {
    const latencyMs = session.latencyMsSignal.value;
    const isLocalGame = session.isLocalGameSignal.value;

    ui.updateLatency(!isLocalGame && latencyMs >= 0 ? latencyMs : null);
  });

/** Keeps fleet status and ship list aligned with reactive session/planning state. */
export const attachSessionFleetPanelEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'playerIdSignal' | 'planningState'
  >,
  ui: SessionFleetPanelUI,
): Dispose =>
  effect(() => {
    const gameState = session.gameStateSignal.value;
    const playerId = session.playerIdSignal.value;

    session.planningState.revisionSignal?.value;

    if (!gameState || playerId === -1) {
      ui.updateFleetStatus('');
      ui.updateShipList([], null, new Map<string, number | null>());
      return;
    }

    const hud = deriveHudViewModel(gameState, playerId, session.planningState);

    ui.updateFleetStatus(hud.fleetStatus);
    ui.updateShipList(hud.myShips, hud.selectedId, session.planningState.burns);
  });

/** Keeps the logistics transfer panel aligned with the session-owned logistics state. */
export const attachSessionLogisticsPanelEffect = (
  session: Pick<ClientSession, 'logisticsStateSignal'>,
  ui: SessionLogisticsPanelUI,
): Dispose =>
  effect(() => {
    ui.renderLogisticsPanel(session.logisticsStateSignal.value);
  });

/** Keeps the canvas renderer aligned with `session.gameState` (including `null` on exit). */
export const attachRendererGameStateEffect = (
  session: Pick<ClientSession, 'gameStateSignal'>,
  renderer: SessionGameStateRenderer,
): Dispose =>
  effect(() => {
    renderer.setGameState(session.gameStateSignal.value);
  });

/**
 * Composes the main client's reactive session effects so the composition root
 * can attach the session -> renderer/UI/HUD pipelines as one lifecycle unit.
 */
export const attachMainSessionEffects = (
  session: ClientSession,
  deps: MainSessionEffectsDeps,
): Dispose => {
  const scope = createDisposalScope();

  scope.add(attachSessionPlanningSelectionEffect(session));
  scope.add(
    attachSessionPlayerIdentityEffect(session, {
      renderer: deps.renderer,
      ui: deps.ui,
    }),
  );
  scope.add(attachSessionCombatButtonsEffect(session, deps.ui));
  scope.add(attachSessionFleetPanelEffect(session, deps.ui));
  scope.add(attachSessionHudEffect(session, deps.hud));
  scope.add(attachSessionWaitingScreenEffect(session, deps.ui));
  scope.add(attachSessionLatencyEffect(session, deps.ui));
  scope.add(attachSessionLogisticsPanelEffect(session, deps.logistics));
  scope.add(attachRendererGameStateEffect(session, deps.renderer));

  return () => scope.dispose();
};
