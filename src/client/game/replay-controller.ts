import type { ReplayEntry, ReplayTimeline } from '../../shared/replay';
import type { GameState } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import { type ReadonlySignal, signal } from '../reactive';
import {
  createHiddenReplayControls,
  type ReplayControlsView,
  type ReplaySpeed,
} from '../ui/overlay-state';
import type { ClientState } from './phase';
import {
  deriveReplaySelection,
  shiftReplaySelection,
} from './replay-selection';

// Minimum dwell between replay frames at 1x playback. Long enough to read a
// snap-only state (e.g. ordnance launch, logistics) before advancing. Speed
// multiplier shrinks this for 2x/4x and expands it for 0.5x.
const SNAP_DWELL_MS_AT_1X = 800;
const ALLOWED_SPEEDS: readonly ReplaySpeed[] = [0.5, 1, 2, 4];

interface ReplayControllerDeps {
  getClientContext: () => {
    state: ClientState;
    isLocalGame: boolean;
    gameCode: string | null;
    gameState: GameState | null;
  };
  fetchReplay: (code: string, gameId: string) => Promise<ReplayTimeline | null>;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  logText: (text: string, cssClass?: string) => void;
  clearTrails: () => void;
  applyGameState: (state: GameState) => void;
  frameOnActivePlayer: (state: GameState) => void;
  // Drive a replay entry through the live presentation pipeline so that
  // movement/combat events trigger the same animations as during play. The
  // host is expected to apply state, kick off any animations, and invoke
  // `onAnimationsDone` when the entry has fully played out (callers may
  // invoke synchronously when there is nothing to animate).
  presentReplayEntry: (
    entry: ReplayEntry,
    previousState: GameState | null,
    onAnimationsDone: () => void,
  ) => void;
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
  cycleSpeed: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
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
  let playToken: number | null = null;
  let playTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingAnimationToken: number | null = null;
  let playbackSpeed: ReplaySpeed = 1;
  const controlsSignal = signal(createHiddenReplayControls());

  const currentDwellMs = (): number => SNAP_DWELL_MS_AT_1X / playbackSpeed;

  const isPlaying = () => playToken !== null;

  const stopPlay = () => {
    playToken = null;
    pendingAnimationToken = null;
    if (playTimeoutId !== null) {
      clearTimeout(playTimeoutId);
      playTimeoutId = null;
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
    return `Turn ${entry.turn} · ${player} ${entry.phase.toUpperCase()}`;
  };

  const buildTurnLabel = (timeline: ReplayTimeline, index: number): string => {
    const entry = timeline.entries[index];
    if (!entry) return '';
    const maxTurn =
      timeline.entries[timeline.entries.length - 1]?.turn ?? entry.turn;
    return `Turn ${entry.turn}/${maxTurn}`;
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
        speed: playbackSpeed,
        progress: 0,
        turnLabel: '',
      };
      return;
    }

    const timeline = replayTimeline;
    const index = replayIndex;
    const canAdvance = index < timeline.entries.length - 1;
    const totalEntries = timeline.entries.length;
    const progress = totalEntries > 1 ? index / (totalEntries - 1) : 1;

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
      speed: playbackSpeed,
      progress,
      turnLabel: buildTurnLabel(timeline, index),
    };
  };

  let shownOutcomeForIndex: number | null = null;

  const clearReplay = () => {
    stopPlay();
    replayTimeline = null;
    replayIndex = null;
    replaySourceState = null;
    selectedReplayGameId = null;
    shownOutcomeForIndex = null;
  };

  const maybeAnnounceOutcome = (entry: ReplayEntry, index: number) => {
    if (!replayTimeline) return;
    const isLast = index === replayTimeline.entries.length - 1;
    const outcome = entry.message.state.outcome;
    if (!isLast || !outcome || shownOutcomeForIndex === index) return;
    shownOutcomeForIndex = index;
    const winnerLabel = `Player ${outcome.winner + 1}`;
    deps.logText(
      `Replay ended — ${winnerLabel} wins: ${outcome.reason}`,
      'log-status',
    );
  };

  // Apply a single replay entry. When `animateContinuation` is supplied we
  // hand the entry off to the host's presentation pipeline so movement/combat
  // play with full animations, and the continuation fires once those are
  // done. When omitted we snap directly to the entry's state (used for
  // manual scrubbing where the user is in control of pacing).
  const applyReplayEntry = (
    index: number,
    animateContinuation?: () => void,
  ) => {
    if (!replayTimeline) return;
    const entry = replayTimeline.entries[index];
    if (!entry) return;
    const previousState = deps.getClientContext().gameState;

    if (animateContinuation) {
      deps.presentReplayEntry(entry, previousState, animateContinuation);
      deps.frameOnActivePlayer(entry.message.state);
      maybeAnnounceOutcome(entry, index);
      return;
    }

    deps.clearTrails();
    deps.applyGameState(entry.message.state);
    deps.frameOnActivePlayer(entry.message.state);
    maybeAnnounceOutcome(entry, index);
  };

  const scheduleNextEntry = (token: number) => {
    if (token !== playToken) return;
    if (playTimeoutId !== null) {
      clearTimeout(playTimeoutId);
    }
    playTimeoutId = setTimeout(() => {
      playTimeoutId = null;
      stepForward(token);
    }, currentDwellMs());
  };

  const stepForward = (token: number) => {
    if (token !== playToken) return;
    if (!replayTimeline || replayIndex === null) return;
    const maxIndex = replayTimeline.entries.length - 1;
    if (replayIndex >= maxIndex) {
      stopPlay();
      updateOverlay();
      return;
    }
    replayIndex = replayIndex + 1;
    pendingAnimationToken = token;
    applyReplayEntry(replayIndex, () => {
      if (pendingAnimationToken !== token) return;
      pendingAnimationToken = null;
      scheduleNextEntry(token);
    });
    updateOverlay();
  };

  const startPlay = () => {
    if (!replayTimeline || replayIndex === null) return;
    if (isPlaying()) return;

    const maxIndex = replayTimeline.entries.length - 1;
    const token = (playToken ?? 0) + 1;
    playToken = token;

    if (replayIndex >= maxIndex) {
      replayIndex = 0;
      shownOutcomeForIndex = null;
      pendingAnimationToken = token;
      applyReplayEntry(replayIndex, () => {
        if (pendingAnimationToken !== token) return;
        pendingAnimationToken = null;
        scheduleNextEntry(token);
      });
    } else {
      scheduleNextEntry(token);
    }

    updateOverlay();
  };

  return {
    controlsSignal,
    clearForState: (state) => {
      if (state === 'gameOver') {
        return;
      }

      // Replay playback temporarily flips client state to
      // `playing_movementAnim` while each movement entry animates, then
      // our wrapReplayDone continuation flips it back to 'gameOver'. This
      // is part of replay, not a context exit — preserve the timeline or
      // playback dies mid-entry.
      if (replayTimeline !== null && state === 'playing_movementAnim') {
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
        deps.logText(TOAST.sessionController.replayLocalOnly, 'log-env');
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
        speed: playbackSpeed,
        progress: 0,
        turnLabel: '',
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
      startPlay();
    },
    togglePlay: () => {
      if (!replayTimeline || replayIndex === null) return;

      if (isPlaying()) {
        stopPlay();
        updateOverlay();
        return;
      }

      startPlay();
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
    cycleSpeed: () => {
      const nextIndex =
        (ALLOWED_SPEEDS.indexOf(playbackSpeed) + 1) % ALLOWED_SPEEDS.length;
      playbackSpeed = ALLOWED_SPEEDS[nextIndex];
      // If a timeout is already armed, reschedule so the new speed takes
      // effect on the very next entry rather than after the current dwell.
      if (isPlaying() && playToken !== null && pendingAnimationToken === null) {
        scheduleNextEntry(playToken);
      }
      updateOverlay();
    },
    setSpeed: (speed) => {
      if (!ALLOWED_SPEEDS.includes(speed)) return;
      playbackSpeed = speed;
      if (isPlaying() && playToken !== null && pendingAnimationToken === null) {
        scheduleNextEntry(playToken);
      }
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
      startPlay();
    },
  };
};
