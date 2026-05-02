import type { EventEnvelope } from '../../shared/engine/engine-events';
import type { GameId } from '../../shared/ids';
import { hasOfficialQuickMatchBot } from '../../shared/player';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { RoomConfig } from '../protocol';
import {
  type Checkpoint,
  deleteCheckpoint,
  getCheckpoint,
  getEventStream,
  getMatchCreatedAt,
  getMatchSeed,
} from './archive';
import { isMatchCoached } from './coach';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

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
  officialBotMatch: boolean;
  // Immutable participant snapshots taken at archive time. The public
  // `/api/matches` listing reads these so deleting or renaming the live
  // `player` row never breaks an archived match's display name. Older
  // archives written before migration 0007 leave these null; the listing
  // query falls back to the legacy `match_rating -> player` join in that
  // case.
  playerAUsername: string | null;
  playerBUsername: string | null;
  winnerUsername: string | null;
}

const r2Key = (gameId: GameId): string => `matches/${gameId}.json`;
export const MATCH_ARCHIVE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MATCH_ARCHIVE_PURGE_BATCH_SIZE = 128;
const MATCH_ARCHIVE_PURGE_MAX_BATCHES = 8;

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
    const [
      eventStream,
      checkpoint,
      matchCreatedAt,
      matchSeed,
      matchCoached,
      roomConfig,
    ] = await Promise.all([
      getEventStream(storage, gameId),
      getCheckpoint(storage, gameId),
      getMatchCreatedAt(storage, gameId),
      getMatchSeed(storage, gameId),
      isMatchCoached(storage),
      storage.get<RoomConfig>(GAME_DO_STORAGE_KEYS.roomConfig),
    ]);
    const officialBotMatch = hasOfficialQuickMatchBot(
      roomConfig?.players ?? [],
    );

    // Snapshot participant callsigns at archive time. Default-only
    // identities are normalised to null so the public listing renders a
    // clean fallback. We drop:
    //   - empty / whitespace-only usernames,
    //   - the lobby placeholders "Player 1" / "Player 2"
    //     (DEFAULT_ROOM_PLAYERS in protocol.ts), and
    //   - the auto-generated `Pilot …` defaults from
    //     `buildDefaultUsername` in src/shared/player.ts.
    // A user who claimed the default name explicitly via /api/claim-name
    // is still subject to the live `player` row, so falling through to
    // the legacy join via COALESCE in matches-list.ts continues to work
    // for them; the snapshot just refuses to immortalise an unclaimed
    // default that may legitimately be reaped later.
    const isDefaultPilotName = (username: string): boolean => {
      // Matches `Pilot` (no suffix) and `Pilot XXXX` where XXXX is 1-4
      // ASCII letters/digits — the exact shape returned by
      // buildDefaultUsername.
      return /^Pilot(?: [A-Za-z0-9]{1,4})?$/.test(username);
    };
    const snapshotUsername = (
      profile: { username?: string; playerKey?: string } | undefined,
    ): string | null => {
      const username =
        typeof profile?.username === 'string' ? profile.username.trim() : '';
      if (
        username === '' ||
        username === 'Player 1' ||
        username === 'Player 2' ||
        isDefaultPilotName(username)
      ) {
        return null;
      }
      return username;
    };

    const playerAUsername = snapshotUsername(roomConfig?.players?.[0]);
    const playerBUsername = snapshotUsername(roomConfig?.players?.[1]);
    const winner = state.outcome?.winner ?? null;
    const winnerUsername =
      winner === 0 ? playerAUsername : winner === 1 ? playerBUsername : null;

    const archive: MatchArchive = {
      gameId,
      roomCode,
      scenario: state.scenario,
      winner,
      winReason: state.outcome?.reason ?? null,
      turnCount: state.turnNumber,
      createdAt: matchCreatedAt ?? checkpoint?.savedAt ?? Date.now(),
      completedAt: Date.now(),
      eventStream,
      checkpoint,
      matchSeed,
      officialBotMatch,
      playerAUsername,
      playerBUsername,
      winnerUsername,
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
            'win_reason, turns, created_at, completed_at, match_coached, official_bot_match, ' +
            'player_a_username, player_b_username, winner_username) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          gameId,
          roomCode,
          state.scenario,
          winner,
          state.outcome?.reason ?? null,
          state.turnNumber,
          archive.createdAt,
          archive.completedAt,
          matchCoached ? 1 : 0,
          officialBotMatch ? 1 : 0,
          playerAUsername,
          playerBUsername,
          winnerUsername,
        )
        .run();
    }

    // Prune the DO-side checkpoint: R2 now holds the canonical copy,
    // and the checkpoint existed only to speed up live-projection
    // rebuilds. Leaving it in DO storage would be permanent residue
    // on every completed match (~5–10 KB per room) with no consumer.
    await deleteCheckpoint(storage, gameId);
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

type ArchiveRow = {
  game_id: string;
};

export const purgeExpiredMatchArchives = async (
  db: D1Database | undefined,
  r2: R2Bucket | undefined,
  maxAgeMs: number,
): Promise<{ deletedRows: number; deletedObjects: number }> => {
  if (!db) {
    return { deletedRows: 0, deletedObjects: 0 };
  }

  const cutoff = Date.now() - maxAgeMs;
  let deletedRows = 0;
  let deletedObjects = 0;

  for (let batch = 0; batch < MATCH_ARCHIVE_PURGE_MAX_BATCHES; batch++) {
    let results: ArchiveRow[];
    try {
      const response = await db
        .prepare(
          'SELECT game_id FROM match_archive ' +
            'WHERE completed_at < ? ORDER BY completed_at ASC LIMIT ?',
        )
        .bind(cutoff, MATCH_ARCHIVE_PURGE_BATCH_SIZE)
        .all<ArchiveRow>();
      results = response.results ?? [];
    } catch (err) {
      console.error('[match-archive] Failed to select expired rows', err);
      break;
    }

    if (results.length === 0) {
      break;
    }

    const gameIds = results.map((row) => row.game_id as GameId);
    const archiveKeys = gameIds.map((gameId) => r2Key(gameId));

    if (r2) {
      try {
        await r2.delete(archiveKeys);
        deletedObjects += archiveKeys.length;
      } catch (err) {
        console.error('[match-archive] Failed to delete expired R2 objects', {
          count: archiveKeys.length,
          err,
        });
        break;
      }
    }

    try {
      const placeholders = gameIds.map(() => '?').join(', ');
      const response = await db
        .prepare(`DELETE FROM match_archive WHERE game_id IN (${placeholders})`)
        .bind(...gameIds)
        .run();
      const meta = (response as { meta?: { changes?: number } }).meta;
      deletedRows += meta?.changes ?? 0;
    } catch (err) {
      console.error('[match-archive] Failed to delete expired archive rows', {
        count: gameIds.length,
        err,
      });
      break;
    }

    if (results.length < MATCH_ARCHIVE_PURGE_BATCH_SIZE) {
      break;
    }
  }

  return { deletedRows, deletedObjects };
};
