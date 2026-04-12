import type { GameState, PlayerId } from '../../shared/types/domain';
import type { ReadonlySignal } from '../reactive';
import { type Dispose, effect } from '../reactive';
import { deriveInteractionMode } from './interaction-fsm';
import type { ClientState } from './phase';
import type { ClientSession } from './session-model';

export type SessionIdentityConsumers = {
  renderer: { setPlayerId: (id: PlayerId | -1) => void };
  ui: { setPlayerId: (id: PlayerId | -1) => void };
};

export type SessionWaitingScreenUI = {
  setWaitingState: (
    code: string | null,
    connecting: boolean,
    scenarioName?: string | null,
  ) => void;
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
  session: Pick<ClientSession, 'stateSignal' | 'gameCodeSignal' | 'scenario'>,
  ui: SessionWaitingScreenUI,
): Dispose =>
  effect(() => {
    const state = session.stateSignal.value;
    const gameCode = session.gameCodeSignal.value;

    ui.setWaitingState(
      deriveInteractionMode(state) === 'waiting' ? gameCode : null,
      state === 'connecting',
      session.scenario,
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
