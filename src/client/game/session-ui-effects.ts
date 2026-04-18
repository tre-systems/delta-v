import type { GameState, Phase, PlayerId } from '../../shared/types/domain';
import type { ReadonlySignal } from '../reactive';
import { type Dispose, effect } from '../reactive';
import type { WaitingScreenState } from '../ui/screens';
import { deriveInteractionMode, type InteractionMode } from './interaction-fsm';
import type { ClientState } from './phase';
import type { ClientSession } from './session-model';

const PHASE_ALERT_MODES = new Set<InteractionMode>([
  'astrogation',
  'ordnance',
  'logistics',
  'combat',
]);

const clientPlayPhaseToGamePhase = (clientState: ClientState): Phase | null => {
  switch (clientState) {
    case 'playing_astrogation':
      return 'astrogation';
    case 'playing_ordnance':
      return 'ordnance';
    case 'playing_logistics':
      return 'logistics';
    case 'playing_combat':
      return 'combat';
    default:
      return null;
  }
};

export type SessionIdentityConsumers = {
  renderer: { setPlayerId: (id: PlayerId | -1) => void };
  ui: { setPlayerId: (id: PlayerId | -1) => void };
};

export type SessionWaitingScreenUI = {
  setWaitingState: (state: WaitingScreenState | null) => void;
};

export type SessionLatencyUI = {
  updateLatency: (latencyMs: number | null) => void;
};

export type SessionLogisticsPanelUI = {
  renderLogisticsPanel: (state: ClientSession['logisticsState']) => void;
};

export type SessionGameStateRenderer = {
  setGameState: (state: GameState | null) => void;
};

export type SessionInteractionUI = {
  bindClientStateSignal: (signal: ReadonlySignal<ClientState>) => void;
};

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
  session: Pick<ClientSession, 'stateSignal' | 'waitingScreenStateSignal'>,
  ui: SessionWaitingScreenUI,
): Dispose =>
  effect(() => {
    const state = session.stateSignal.value;

    ui.setWaitingState(
      deriveInteractionMode(state) === 'waiting'
        ? session.waitingScreenStateSignal.value
        : null,
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

export type SessionPhaseAlertOverlay = {
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
};

/**
 * Shows the brief phase banner when the player enters an interactive turn
 * phase that matches `gameState.phase` (avoids flashes during movement
 * animation or other client/game mismatches). Re-shows after leaving and
 * re-entering the same turn phase (e.g. returning from `playing_movementAnim`).
 */
export const attachSessionPhaseAlertEffect = (
  session: Pick<
    ClientSession,
    'stateSignal' | 'gameStateSignal' | 'playerIdSignal'
  >,
  overlay: SessionPhaseAlertOverlay,
): Dispose => {
  let lastAlertKey = '';

  return effect(() => {
    const clientState = session.stateSignal.value;
    const gameState = session.gameStateSignal.value;
    const playerId = session.playerIdSignal.value;
    const mode = deriveInteractionMode(clientState);
    const uiPhase = clientPlayPhaseToGamePhase(clientState);

    if (!PHASE_ALERT_MODES.has(mode) || uiPhase === null) {
      lastAlertKey = '';
      return;
    }

    if (!gameState || playerId < 0) {
      lastAlertKey = '';
      return;
    }

    if (gameState.phase !== uiPhase) {
      return;
    }

    const alertKey = `${uiPhase}:${gameState.turnNumber}:${gameState.activePlayer}`;
    if (alertKey === lastAlertKey) {
      return;
    }

    lastAlertKey = alertKey;
    overlay.showPhaseAlert(uiPhase, gameState.activePlayer === playerId);
  });
};
