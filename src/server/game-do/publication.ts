// State publication pipeline — named steps extracted from GameDO.publishStateChange.
// Each step is independently testable; the pipeline runner preserves ordering.

import type { EngineEvent } from '../../shared/engine/engine-events';
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
  STATEFUL_SERVER_MESSAGE_TYPES,
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

  if (
    !STATEFUL_SERVER_MESSAGE_TYPES.includes(
      replayMessage.type as (typeof STATEFUL_SERVER_MESSAGE_TYPES)[number],
    )
  ) {
    throw new Error(
      `Unsupported stateful server message: ${replayMessage.type}`,
    );
  }

  // Step 1: Append events
  const eventSeq =
    events.length === 0
      ? await getEventStreamLength(deps.storage, state.gameId)
      : await (async () => {
          await appendEnvelopedEvents(
            deps.storage,
            state.gameId,
            actor,
            ...events,
          );
          return getEventStreamLength(deps.storage, state.gameId);
        })();

  // Step 2: Checkpoint
  if (
    events.some(
      (event) => event.type === 'turnAdvanced' || event.type === 'gameOver',
    )
  ) {
    await saveCheckpoint(deps.storage, state.gameId, state, eventSeq);
  }

  // Step 3: Verify projection parity
  await deps.verifyProjectionParity(state);

  // Step 4: Archive if game over
  if (events.some((event) => event.type === 'gameOver')) {
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

    // Step 4b: Update Glicko-2 ratings if game over (paired matches only)
    // The rating-writer itself no-ops on non-paired rooms and when either
    // participant lacks a `player` row.
    scheduleMatchRatingUpdate(
      {
        db: deps.env.DB,
        waitUntil: deps.waitUntil,
        getRoomConfig: deps.getRoomConfig,
      },
      state,
    );
  }

  // Step 5: Restart turn timer
  if (restartTurnTimer) {
    await deps.startTurnTimer(state);
  }

  // Step 6: Broadcast
  deps.broadcastStateChange(state, replayMessage);
};
