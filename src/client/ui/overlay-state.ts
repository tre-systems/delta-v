import { computed, type ReadonlySignal, signal } from '../reactive';
import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  type GameOverStatsLike,
} from './screens';

export interface ReplayControlsView {
  available: boolean;
  active: boolean;
  loading: boolean;
  statusText: string;
  selectedGameId: string;
  canSelectPrevMatch: boolean;
  canSelectNextMatch: boolean;
  canStart: boolean;
  canPrev: boolean;
  canNext: boolean;
  canEnd: boolean;
}

interface GameOverOverlayState {
  won: boolean;
  reason: string;
  stats?: GameOverStatsLike;
  rematchPending: boolean;
}

interface ReconnectOverlayState {
  attempt: number;
  maxAttempts: number;
  onCancel: () => void;
}

interface GameOverOverlayView {
  visible: boolean;
  titleText: string;
  titleClass: string;
  reasonText: string;
  statLines: Array<{
    label: string;
    value: string;
  }>;
  rematchText: string;
  rematchDisabled: boolean;
}

interface ReconnectOverlayView {
  visible: boolean;
  reconnectText: string;
  attemptText: string;
}

export interface OverlayStateStore {
  readonly gameOverViewSignal: ReadonlySignal<GameOverOverlayView>;
  readonly replayControlsSignal: ReadonlySignal<ReplayControlsView>;
  readonly reconnectViewSignal: ReadonlySignal<ReconnectOverlayView>;
  readonly opponentDisconnectDeadlineSignal: ReadonlySignal<number | null>;
  showGameOver: (
    won: boolean,
    reason: string,
    stats?: GameOverStatsLike,
  ) => void;
  showRematchPending: () => void;
  bindReplayControlsSignal: (next: ReadonlySignal<ReplayControlsView>) => void;
  showReconnecting: (
    attempt: number,
    maxAttempts: number,
    onCancel: () => void,
  ) => void;
  hideReconnecting: () => void;
  cancelReconnect: () => void;
  showOpponentDisconnected: (graceDeadlineMs: number) => void;
  hideOpponentDisconnected: () => void;
}

export const createHiddenReplayControls = (): ReplayControlsView => ({
  available: false,
  active: false,
  loading: false,
  statusText: '',
  selectedGameId: '',
  canSelectPrevMatch: false,
  canSelectNextMatch: false,
  canStart: false,
  canPrev: false,
  canNext: false,
  canEnd: false,
});

const HIDDEN_GAME_OVER_VIEW: GameOverOverlayView = {
  visible: false,
  titleText: '',
  titleClass: '',
  reasonText: '',
  statLines: [],
  rematchText: 'Rematch',
  rematchDisabled: false,
};

const HIDDEN_RECONNECT_VIEW: ReconnectOverlayView = {
  visible: false,
  reconnectText: '',
  attemptText: '',
};

export const createOverlayStateStore = (): OverlayStateStore => {
  const gameOverStateSignal = signal<GameOverOverlayState | null>(null);
  const hiddenReplayControlsSignal = signal(createHiddenReplayControls());
  const replayControlsSourceSignal = signal<ReadonlySignal<ReplayControlsView>>(
    hiddenReplayControlsSignal,
  );
  const reconnectStateSignal = signal<ReconnectOverlayState | null>(null);
  const opponentDisconnectDeadlineSignal = signal<number | null>(null);

  const gameOverViewSignal = computed(() => {
    const state = gameOverStateSignal.value;

    if (!state) {
      return HIDDEN_GAME_OVER_VIEW;
    }

    const view = buildGameOverView(state.won, state.reason, state.stats);
    const rematchView = state.rematchPending
      ? buildRematchPendingView()
      : {
          rematchText: view.rematchText,
          rematchDisabled: view.rematchDisabled,
        };

    return {
      visible: true,
      titleText: view.titleText,
      titleClass: state.won ? 'game-over-victory' : 'game-over-defeat',
      reasonText: view.reasonText,
      statLines: view.statLines,
      rematchText: rematchView.rematchText,
      rematchDisabled: rematchView.rematchDisabled,
    };
  });

  const replayControlsSignal = computed(
    () => replayControlsSourceSignal.value.value,
  );

  const reconnectViewSignal = computed(() => {
    const state = reconnectStateSignal.value;

    if (!state) {
      return HIDDEN_RECONNECT_VIEW;
    }

    const view = buildReconnectView(state.attempt, state.maxAttempts);
    return {
      visible: true,
      reconnectText: view.reconnectText,
      attemptText: view.attemptText,
    };
  });

  return {
    gameOverViewSignal,
    replayControlsSignal,
    reconnectViewSignal,
    opponentDisconnectDeadlineSignal,
    showGameOver: (won, reason, stats) => {
      gameOverStateSignal.value = {
        won,
        reason,
        stats,
        rematchPending: false,
      };
    },
    showRematchPending: () => {
      gameOverStateSignal.update((current) =>
        current
          ? {
              ...current,
              rematchPending: true,
            }
          : current,
      );
    },
    bindReplayControlsSignal: (next) => {
      replayControlsSourceSignal.value = next;
    },
    showReconnecting: (attempt, maxAttempts, onCancel) => {
      reconnectStateSignal.value = {
        attempt,
        maxAttempts,
        onCancel,
      };
    },
    hideReconnecting: () => {
      reconnectStateSignal.value = null;
    },
    cancelReconnect: () => {
      const onCancel = reconnectStateSignal.peek()?.onCancel;
      reconnectStateSignal.value = null;
      onCancel?.();
    },
    showOpponentDisconnected: (graceDeadlineMs) => {
      opponentDisconnectDeadlineSignal.value = graceDeadlineMs;
    },
    hideOpponentDisconnected: () => {
      opponentDisconnectDeadlineSignal.value = null;
    },
  };
};
