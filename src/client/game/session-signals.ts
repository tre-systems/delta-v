import { hexKey } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { type Dispose, effect } from '../reactive';
import { deriveHudViewModel } from './helpers';
import { getSelectedShip } from './selection';
import type { ClientSession } from './session-model';

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
  ui: {
    showAttackButton: (visible: boolean) => void;
    showFireButton: (visible: boolean, count: number) => void;
  },
): Dispose =>
  effect(() => {
    const isPlayingCombat = session.stateSignal.value === 'playing_combat';
    session.planningState.revisionSignal?.value;
    const queuedAttackCount = session.planningState.queuedAttacks.length;

    ui.showAttackButton(
      isPlayingCombat && session.planningState.combatTargetId !== null,
    );
    ui.showFireButton(
      isPlayingCombat && queuedAttackCount > 0,
      queuedAttackCount,
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
  hud: { updateHUD: () => void },
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
  deps: {
    renderer: { setPlayerId: (id: PlayerId | -1) => void };
    ui: { setPlayerId: (id: PlayerId | -1) => void };
  },
): Dispose =>
  effect(() => {
    const playerId = session.playerIdSignal.value;

    deps.renderer.setPlayerId(playerId);
    deps.ui.setPlayerId(playerId);
  });

/** Keeps latency display aligned with reactive session state instead of push-style UI calls. */
export const attachSessionLatencyEffect = (
  session: Pick<ClientSession, 'latencyMsSignal' | 'isLocalGameSignal'>,
  ui: { updateLatency: (latencyMs: number | null) => void },
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
  ui: {
    updateFleetStatus: (status: string) => void;
    updateShipList: (
      ships: GameState['ships'],
      selectedId: string | null,
      burns: Map<string, number | null>,
    ) => void;
  },
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
  ui: {
    renderLogisticsPanel: (state: ClientSession['logisticsState']) => void;
  },
): Dispose =>
  effect(() => {
    ui.renderLogisticsPanel(session.logisticsStateSignal.value);
  });

/** Keeps the canvas renderer aligned with `session.gameState` (including `null` on exit). */
export const attachRendererGameStateEffect = (
  session: Pick<ClientSession, 'gameStateSignal'>,
  renderer: { setGameState: (state: GameState | null) => void },
): Dispose =>
  effect(() => {
    renderer.setGameState(session.gameStateSignal.value);
  });
