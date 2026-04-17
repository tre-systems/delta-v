// State publication pipeline — named steps extracted from GameDO.publishStateChange.
// Each step is independently testable; the pipeline runner preserves ordering.

import type { EngineEvent } from '../../shared/engine/engine-events';
import type { GameId } from '../../shared/ids';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { scheduleMatchRatingUpdate } from '../leaderboard/rating-writer';
import type { RoomConfig } from '../protocol';
import {
  appendEnvelopedEvents,
  getEventStreamLength,
  saveCheckpoint,
} from './archive';
import { scheduleArchiveCompletedMatch } from './match-archive';
import {
  resolveStateBearingMessage,
  type StatefulServerMessage,
} from './message-builders';

export interface PublicationDeps {
  storage: DurableObjectStorage;
  env: { DB: D1Database; MATCH_ARCHIVE?: R2Bucket };
  waitUntil: (promise: Promise<unknown>) => void;
  getGameCode: () => Promise<string>;
  getRoomConfig: () => Promise<RoomConfig | null>;
  verifyProjectionParity: (state: GameState) => Promise<void>;
  broadcastStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
  ) => void;
  startTurnTimer: (state: GameState) => Promise<void>;
}

export interface PublicationOptions {
  actor?: PlayerId | null;
  restartTurnTimer?: boolean;
  events?: EngineEvent[];
}

// Step 1: Append engine events to the event stream.
const appendEvents = async (
  storage: DurableObjectStorage,
  gameId: GameId,
  actor: PlayerId | null,
  events: EngineEvent[],
): Promise<number> => {
  if (events.length === 0) {
    return getEventStreamLength(storage, gameId);
  }
  await appendEnvelopedEvents(storage, gameId, actor, ...events);
  return getEventStreamLength(storage, gameId);
};

// Step 2: Save a checkpoint at turn boundaries or game end.
const checkpointIfNeeded = async (
  storage: DurableObjectStorage,
  gameId: GameId,
  state: GameState,
  eventSeq: number,
  events: EngineEvent[],
): Promise<void> => {
  const hasTurnBoundary = events.some(
    (e) => e.type === 'turnAdvanced' || e.type === 'gameOver',
  );
  if (hasTurnBoundary) {
    await saveCheckpoint(storage, gameId, state, eventSeq);
  }
};

// Step 3: Archive completed match to R2 for persistent analysis.
const archiveIfGameOver = (
  deps: Pick<PublicationDeps, 'storage' | 'env' | 'waitUntil'>,
  state: GameState,
  roomCode: string,
  events: EngineEvent[],
): void => {
  const hasGameOver = events.some((e) => e.type === 'gameOver');
  if (hasGameOver) {
    scheduleArchiveCompletedMatch(
      {
        storage: deps.storage,
        r2: deps.env.MATCH_ARCHIVE,
        db: deps.env.DB,
        waitUntil: deps.waitUntil,
      },
      state,
      roomCode,
    );
  }
};

// Step 3b: Update Glicko-2 ratings for matchmaker-paired matches.
// The rating-writer itself no-ops on non-paired rooms and when either
// participant lacks a `player` row.
const updateRatingsIfGameOver = (
  deps: Pick<PublicationDeps, 'env' | 'waitUntil' | 'getRoomConfig'>,
  state: GameState,
  events: EngineEvent[],
): void => {
  const hasGameOver = events.some((e) => e.type === 'gameOver');
  if (hasGameOver) {
    scheduleMatchRatingUpdate(
      {
        db: deps.env.DB,
        waitUntil: deps.waitUntil,
        getRoomConfig: deps.getRoomConfig,
      },
      state,
    );
  }
};

// Pipeline runner: executes all steps in order, preserving the original
// behavioral contract of GameDO.publishStateChange.
export const runPublicationPipeline = async (
  deps: PublicationDeps,
  state: GameState,
  primaryMessage?: StatefulServerMessage,
  options?: PublicationOptions,
): Promise<void> => {
  const { actor = null, restartTurnTimer = true, events = [] } = options ?? {};

  const roomCode = await deps.getGameCode();
  const replayMessage = resolveStateBearingMessage(state, primaryMessage);

  // Step 1: Append events
  const eventSeq = await appendEvents(
    deps.storage,
    state.gameId,
    actor,
    events,
  );

  // Step 2: Checkpoint
  await checkpointIfNeeded(deps.storage, state.gameId, state, eventSeq, events);

  // Step 3: Verify projection parity
  await deps.verifyProjectionParity(state);

  // Step 4: Archive if game over
  archiveIfGameOver(deps, state, roomCode, events);

  // Step 4b: Update Glicko-2 ratings if game over (paired matches only)
  updateRatingsIfGameOver(deps, state, events);

  // Step 5: Restart turn timer
  if (restartTurnTimer) {
    await deps.startTurnTimer(state);
  }

  // Step 6: Broadcast
  deps.broadcastStateChange(state, replayMessage);
};
