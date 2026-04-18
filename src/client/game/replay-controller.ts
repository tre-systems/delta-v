import type { ReplayTimeline } from '../../shared/replay';
import type { GameState } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import { type ReadonlySignal, signal } from '../reactive';
import {
  createHiddenReplayControls,
  type ReplayControlsView,
} from '../ui/overlay-state';
import type { ClientState } from './phase';
import {
  deriveReplaySelection,
  shiftReplaySelection,
} from './replay-selection';

const PLAY_INTERVAL_MS = 600;

interface ReplayControllerDeps {
  getClientContext: () => {
    state: ClientState;
    isLocalGame: boolean;
    gameCode: string | null;
    gameState: GameState | null;
  };
  fetchReplay: (code: string, gameId: string) => Promise<ReplayTimeline | null>;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  clearTrails: () => void;
  applyGameState: (state: GameState) => void;
  frameOnActivePlayer: (state: GameState) => void;
}

export interface ReplayController {
  readonly controlsSignal: ReadonlySignal<ReplayControlsView>;
  clearForState: (state: ClientState) => void;
  onGameOverShown: () => void;
  onGameOverMessage: () => void;
  selectMatch: (direction: 'prev' | 'next') => void;
  toggleReplay: () => Promise<void>;
  togglePlay: () => void;
  stepReplay: (direction: 'start' | 'prev' | 'next' | 'end') => void;
  // Seed the controller with a pre-fetched timeline — used by the archived
  // replay viewer path that boots the client into replay mode without an
  // interactive gameplay session. Requires the client to be in `gameOver`
  // state with gameState and gameCode already applied (the caller is
  // responsible for doing that before invoking this method).
  startArchivedReplay: (timeline: ReplayTimeline) => void;
}

export const createReplayController = (
  deps: ReplayControllerDeps,
): ReplayController => {
  let replayTimeline: ReplayTimeline | null = null;
  let replayIndex: number | null = null;
  let replaySourceState: GameState | null = null;
  let selectedReplayGameId: string | null = null;
  let playIntervalId: ReturnType<typeof setInterval> | null = null;
  const controlsSignal = signal(createHiddenReplayControls());

  const isPlaying = () => playIntervalId !== null;

  const stopPlay = () => {
    if (playIntervalId !== null) {
      clearInterval(playIntervalId);
      playIntervalId = null;
    }
  };

  const buildReplayStatusText = (
    timeline: ReplayTimeline,
    index: number,
  ): string => {
    const entry = timeline.entries[index];

    if (!entry) {
      return timeline.gameId;
    }

    const player = `P${entry.message.state.activePlayer + 1}`;
    return `Turn ${entry.turn} · ${player} ${entry.phase.toUpperCase()} · ${index + 1}/${timeline.entries.length}`;
  };

  const getReplaySelection = () => {
    const ctx = deps.getClientContext();
    const gameState = ctx.gameState;

    if (!gameState) {
      return null;
    }

    const replaySelection = deriveReplaySelection(
      gameState.gameId,
      ctx.gameCode,
      selectedReplayGameId,
    );

    if (
      replaySelection &&
      selectedReplayGameId !== replaySelection.selectedGameId
    ) {
      selectedReplayGameId = replaySelection.selectedGameId;
    }

    return replaySelection;
  };

  const updateOverlay = () => {
    const ctx = deps.getClientContext();
    const available =
      !ctx.isLocalGame &&
      ctx.state === 'gameOver' &&
      ctx.gameCode !== null &&
      ctx.gameState !== null;

    if (!available) {
      controlsSignal.value = createHiddenReplayControls();
      return;
    }

    const gameState = ctx.gameState;
    if (gameState === null) {
      return;
    }

    const replaySelection = getReplaySelection();
    if (replaySelection === null) {
      return;
    }

    if (replayTimeline === null || replayIndex === null) {
      controlsSignal.value = {
        available: true,
        active: false,
        loading: false,
        playing: false,
        statusText:
          replaySelection.latestMatchNumber > 1
            ? `Selected ${replaySelection.selectedGameId} for replay`
            : `Ready to replay ${gameState.gameId}`,
        selectedGameId: replaySelection.selectedGameId,
        canSelectPrevMatch: replaySelection.selectedMatchNumber > 1,
        canSelectNextMatch:
          replaySelection.selectedMatchNumber <
          replaySelection.latestMatchNumber,
        canStart: false,
        canPrev: false,
        canNext: false,
        canEnd: false,
      };
      return;
    }

    const timeline = replayTimeline;
    const index = replayIndex;
    const canAdvance = index < timeline.entries.length - 1;

    controlsSignal.value = {
      available: true,
      active: true,
      loading: false,
      playing: isPlaying(),
      statusText: buildReplayStatusText(timeline, index),
      selectedGameId: replaySelection.selectedGameId,
      canSelectPrevMatch: replaySelection.selectedMatchNumber > 1,
      canSelectNextMatch:
        replaySelection.selectedMatchNumber < replaySelection.latestMatchNumber,
      canStart: index > 0,
      canPrev: index > 0,
      canNext: canAdvance,
      canEnd: canAdvance,
    };
  };

  const clearReplay = () => {
    stopPlay();
    replayTimeline = null;
    replayIndex = null;
    replaySourceState = null;
    selectedReplayGameId = null;
  };

  const applyReplayEntry = (index: number) => {
    if (!replayTimeline) return;
    const entry = replayTimeline.entries[index];
    if (!entry) return;
    deps.clearTrails();
    deps.applyGameState(entry.message.state);
    deps.frameOnActivePlayer(entry.message.state);
  };

  const stepForward = () => {
    if (!replayTimeline || replayIndex === null) return;
    const maxIndex = replayTimeline.entries.length - 1;
    if (replayIndex >= maxIndex) {
      stopPlay();
      updateOverlay();
      return;
    }
    replayIndex = replayIndex + 1;
    applyReplayEntry(replayIndex);
    updateOverlay();
  };

  return {
    controlsSignal,
    clearForState: (state) => {
      if (state === 'gameOver') {
        return;
      }

      clearReplay();
      controlsSignal.value = createHiddenReplayControls();
    },
    onGameOverShown: () => {
      selectedReplayGameId = deps.getClientContext().gameState?.gameId ?? null;
      updateOverlay();
    },
    onGameOverMessage: () => {
      updateOverlay();
    },
    selectMatch: (direction) => {
      if (replayTimeline !== null) {
        return;
      }

      const replaySelection = getReplaySelection();

      if (replaySelection === null || replaySelection.latestMatchNumber <= 1) {
        return;
      }

      const nextSelection = shiftReplaySelection(replaySelection, direction);

      if (nextSelection.selectedGameId === replaySelection.selectedGameId) {
        return;
      }

      selectedReplayGameId = nextSelection.selectedGameId;
      updateOverlay();
    },
    toggleReplay: async () => {
      if (replayTimeline && replayIndex !== null) {
        stopPlay();
        if (replaySourceState) {
          deps.clearTrails();
          deps.applyGameState(replaySourceState);
        }
        replayTimeline = null;
        replayIndex = null;
        replaySourceState = null;
        updateOverlay();
        return;
      }

      const ctx = deps.getClientContext();

      if (ctx.isLocalGame) {
        deps.showToast(TOAST.sessionController.replayLocalOnly, 'info');
        return;
      }

      const replaySelection = getReplaySelection();

      if (!ctx.gameCode || !ctx.gameState?.gameId || !replaySelection) {
        return;
      }

      controlsSignal.value = {
        available: true,
        active: false,
        loading: true,
        playing: false,
        statusText: `Loading ${replaySelection.selectedGameId}...`,
        selectedGameId: replaySelection.selectedGameId,
        canSelectPrevMatch: replaySelection.selectedMatchNumber > 1,
        canSelectNextMatch:
          replaySelection.selectedMatchNumber <
          replaySelection.latestMatchNumber,
        canStart: false,
        canPrev: false,
        canNext: false,
        canEnd: false,
      };

      const timeline = await deps.fetchReplay(
        ctx.gameCode,
        replaySelection.selectedGameId,
      );

      if (!timeline || timeline.entries.length === 0) {
        deps.showToast(TOAST.sessionController.replayUnavailable, 'error');
        updateOverlay();
        return;
      }

      replaySourceState = structuredClone(ctx.gameState);
      replayTimeline = timeline;
      replayIndex = 0;
      applyReplayEntry(replayIndex);
      updateOverlay();
    },
    togglePlay: () => {
      if (!replayTimeline || replayIndex === null) return;

      if (isPlaying()) {
        stopPlay();
        updateOverlay();
        return;
      }

      // If at the end, restart from the beginning
      const maxIndex = replayTimeline.entries.length - 1;
      if (replayIndex >= maxIndex) {
        replayIndex = 0;
        applyReplayEntry(replayIndex);
      }

      playIntervalId = setInterval(stepForward, PLAY_INTERVAL_MS);
      updateOverlay();
    },
    stepReplay: (direction) => {
      if (!replayTimeline || replayIndex === null) {
        return;
      }

      stopPlay();

      const maxIndex = replayTimeline.entries.length - 1;

      switch (direction) {
        case 'start':
          replayIndex = 0;
          break;
        case 'prev':
          replayIndex = Math.max(0, replayIndex - 1);
          break;
        case 'next':
          replayIndex = Math.min(maxIndex, replayIndex + 1);
          break;
        case 'end':
          replayIndex = maxIndex;
          break;
      }

      applyReplayEntry(replayIndex);
      updateOverlay();
    },
    startArchivedReplay: (timeline) => {
      if (timeline.entries.length === 0) {
        deps.showToast(TOAST.sessionController.replayNoEntries, 'error');
        return;
      }

      stopPlay();
      // Remember the caller's current state so that toggling the replay off
      // restores it (for archived replays this is the match's final state —
      // set by the caller before invoking us).
      const ctx = deps.getClientContext();
      replaySourceState = ctx.gameState ? structuredClone(ctx.gameState) : null;
      selectedReplayGameId = timeline.gameId;
      replayTimeline = timeline;
      replayIndex = 0;
      applyReplayEntry(replayIndex);
      updateOverlay();
    },
  };
};
