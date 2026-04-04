import type { EventEnvelope } from '../../shared/engine/engine-events';
import type { GameId } from '../../shared/ids';
import type { GameState, PlayerId } from '../../shared/types/domain';
import {
  type Checkpoint,
  getCheckpoint,
  getEventStream,
  getMatchCreatedAt,
  getMatchSeed,
} from './archive';

// Persistent archive of a completed match.
export interface MatchArchive {
  gameId: GameId;
  roomCode: string;
  scenario: string;
  winner: PlayerId | null;
  winReason: string | null;
  turnCount: number;
  createdAt: number;
  completedAt: number;
  eventStream: EventEnvelope[];
  checkpoint: Checkpoint | null;
  matchSeed: number | null;
}

const r2Key = (gameId: GameId): string => `matches/${gameId}.json`;

// Archive a completed match to R2 and insert metadata
// into D1. Fire-and-forget — errors are logged but
// never block game flow.
export const archiveCompletedMatch = async (
  storage: DurableObjectStorage,
  r2: R2Bucket,
  db: D1Database | undefined,
  state: GameState,
  roomCode: string,
): Promise<void> => {
  const { gameId } = state;

  try {
    const [eventStream, checkpoint, matchCreatedAt, matchSeed] =
      await Promise.all([
        getEventStream(storage, gameId),
        getCheckpoint(storage, gameId),
        getMatchCreatedAt(storage, gameId),
        getMatchSeed(storage, gameId),
      ]);

    const archive: MatchArchive = {
      gameId,
      roomCode,
      scenario: state.scenario,
      winner: state.outcome?.winner ?? null,
      winReason: state.outcome?.reason ?? null,
      turnCount: state.turnNumber,
      createdAt: matchCreatedAt ?? checkpoint?.savedAt ?? Date.now(),
      completedAt: Date.now(),
      eventStream,
      checkpoint,
      matchSeed,
    };

    await r2.put(r2Key(gameId), JSON.stringify(archive), {
      customMetadata: {
        scenario: state.scenario,
        roomCode,
        turns: String(state.turnNumber),
      },
    });

    if (db) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO match_archive ' +
            '(game_id, room_code, scenario, winner, ' +
            'win_reason, turns, created_at, completed_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          gameId,
          roomCode,
          state.scenario,
          state.outcome?.winner ?? null,
          state.outcome?.reason ?? null,
          state.turnNumber,
          archive.createdAt,
          archive.completedAt,
        )
        .run();
    }
  } catch (err) {
    console.error('[match-archive] Failed to archive match:', gameId, err);
  }
};

export const scheduleArchiveCompletedMatch = (
  deps: {
    storage: DurableObjectStorage;
    r2: R2Bucket | undefined;
    db: D1Database | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
  },
  state: GameState,
  roomCode: string,
): void => {
  if (!deps.r2) {
    return;
  }

  deps.waitUntil(
    archiveCompletedMatch(deps.storage, deps.r2, deps.db, state, roomCode),
  );
};

// Fetch a previously archived match from R2.
// Returns null if R2 is not bound or the archive
// doesn't exist.
export const fetchArchivedMatch = async (
  r2: R2Bucket | undefined,
  gameId: GameId,
): Promise<MatchArchive | null> => {
  if (!r2) return null;

  try {
    const obj = await r2.get(r2Key(gameId));

    if (!obj) return null;
    return (await obj.json()) as MatchArchive;
  } catch {
    return null;
  }
};
