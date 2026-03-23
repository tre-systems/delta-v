import type { EventEnvelope } from '../../shared/engine/engine-events';
import type { GameState } from '../../shared/types/domain';
import {
  type Checkpoint,
  getCheckpoint,
  getEventStream,
  getMatchCreatedAt,
} from './archive';

/** Persistent archive of a completed match. */
export interface MatchArchive {
  gameId: string;
  roomCode: string;
  scenario: string;
  winner: number | null;
  winReason: string | null;
  turnCount: number;
  createdAt: number;
  completedAt: number;
  eventStream: EventEnvelope[];
  checkpoint: Checkpoint | null;
}

const r2Key = (gameId: string): string => `matches/${gameId}.json`;

/**
 * Archive a completed match to R2 and insert metadata
 * into D1. Fire-and-forget — errors are logged but
 * never block game flow.
 */
export const archiveCompletedMatch = async (
  storage: DurableObjectStorage,
  r2: R2Bucket,
  db: D1Database | undefined,
  state: GameState,
  roomCode: string,
): Promise<void> => {
  const { gameId } = state;

  try {
    const [eventStream, checkpoint, matchCreatedAt] = await Promise.all([
      getEventStream(storage, gameId),
      getCheckpoint(storage, gameId),
      getMatchCreatedAt(storage, gameId),
    ]);

    const archive: MatchArchive = {
      gameId,
      roomCode,
      scenario: state.scenario,
      winner: state.winner,
      winReason: state.winReason,
      turnCount: state.turnNumber,
      createdAt: matchCreatedAt ?? checkpoint?.savedAt ?? Date.now(),
      completedAt: Date.now(),
      eventStream,
      checkpoint,
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
          state.winner,
          state.winReason,
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

/**
 * Fetch a previously archived match from R2.
 * Returns null if R2 is not bound or the archive
 * doesn't exist.
 */
export const fetchArchivedMatch = async (
  r2: R2Bucket | undefined,
  gameId: string,
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
