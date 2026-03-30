import type { ReconnectOverlayState } from '../game/session-ui-state';
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
  bindReconnectStateSignal: (
    next: ReadonlySignal<ReconnectOverlayState | null>,
  ) => void;
  bindOpponentDisconnectDeadlineSignal: (
    next: ReadonlySignal<number | null>,
  ) => void;
  bindHideOpponentDisconnected: (hide: () => void) => void;
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
  const hiddenReconnectStateSignal = signal<ReconnectOverlayState | null>(null);
  const reconnectStateSourceSignal = signal<
    ReadonlySignal<ReconnectOverlayState | null>
  >(hiddenReconnectStateSignal);
  const hiddenOpponentDisconnectDeadlineSignal = signal<number | null>(null);
  const opponentDisconnectDeadlineSourceSignal = signal<
    ReadonlySignal<number | null>
  >(hiddenOpponentDisconnectDeadlineSignal);
  let hideOpponentDisconnected: (() => void) | null = null;

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
    const state = reconnectStateSourceSignal.value.value;

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
  const opponentDisconnectDeadlineSignal = computed(
    () => opponentDisconnectDeadlineSourceSignal.value.value,
  );

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
    bindReconnectStateSignal: (next) => {
      reconnectStateSourceSignal.value = next;
    },
    bindOpponentDisconnectDeadlineSignal: (next) => {
      opponentDisconnectDeadlineSourceSignal.value = next;
    },
    bindHideOpponentDisconnected: (hide) => {
      hideOpponentDisconnected = hide;
    },
    showReconnecting: (attempt, maxAttempts, onCancel) => {
      hiddenReconnectStateSignal.value = {
        attempt,
        maxAttempts,
        onCancel,
      };
    },
    hideReconnecting: () => {
      hiddenReconnectStateSignal.value = null;
    },
    cancelReconnect: () => {
      const onCancel = reconnectStateSourceSignal.value.peek()?.onCancel;
      hiddenReconnectStateSignal.value = null;
      onCancel?.();
    },
    showOpponentDisconnected: (graceDeadlineMs) => {
      hiddenOpponentDisconnectDeadlineSignal.value = graceDeadlineMs;
    },
    hideOpponentDisconnected: () => {
      if (hideOpponentDisconnected) {
        hideOpponentDisconnected();
        return;
      }

      hiddenOpponentDisconnectDeadlineSignal.value = null;
    },
  };
};
