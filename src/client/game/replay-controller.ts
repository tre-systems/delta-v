import type { ReplayTimeline } from '../../shared/replay';
import type { GameState } from '../../shared/types/domain';
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
}

export interface ReplayController {
  readonly controlsSignal: ReadonlySignal<ReplayControlsView>;
  clearForState: (state: ClientState) => void;
  onGameOverShown: () => void;
  onGameOverMessage: () => void;
  selectMatch: (direction: 'prev' | 'next') => void;
  toggleReplay: () => Promise<void>;
  stepReplay: (direction: 'start' | 'prev' | 'next' | 'end') => void;
}

export const createReplayController = (
  deps: ReplayControllerDeps,
): ReplayController => {
  let replayTimeline: ReplayTimeline | null = null;
  let replayIndex: number | null = null;
  let replaySourceState: GameState | null = null;
  let selectedReplayGameId: string | null = null;
  const controlsSignal = signal(createHiddenReplayControls());

  const buildReplayStatusText = (
    timeline: ReplayTimeline,
    index: number,
  ): string => {
    const entry = timeline.entries[index];

    if (!entry) {
      return timeline.gameId;
    }

    return `${timeline.gameId} • Turn ${entry.turn} • ${entry.phase.toUpperCase()} • ${index + 1}/${timeline.entries.length}`;
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
    replayTimeline = null;
    replayIndex = null;
    replaySourceState = null;
    selectedReplayGameId = null;
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
        deps.showToast(
          'Replay is only available for multiplayer matches right now.',
          'info',
        );
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
        deps.showToast('Replay unavailable for this match.', 'error');
        updateOverlay();
        return;
      }

      replaySourceState = structuredClone(ctx.gameState);
      replayTimeline = timeline;
      replayIndex = timeline.entries.length - 1;
      deps.clearTrails();
      deps.applyGameState(timeline.entries[replayIndex].message.state);
      updateOverlay();
    },
    stepReplay: (direction) => {
      if (!replayTimeline || replayIndex === null) {
        return;
      }

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

      const entry = replayTimeline.entries[replayIndex];

      if (!entry) {
        return;
      }

      deps.clearTrails();
      deps.applyGameState(entry.message.state);
      updateOverlay();
    },
  };
};
