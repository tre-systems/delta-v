// Retention helpers for `match_rating` rows whose `match_archive` row
// or R2 object is missing. The 2026-05-02 audit found 11 such orphans
// where operator cleanup deleted the archive side without touching the
// rating side, breaking the "every rated game has a replay" invariant.
//
// The fix is non-destructive: rather than deleting the rating row (and
// losing rating-history audit data), operators mark the row with
// `archive_retired_at` + `archive_retired_reason`. Public surfaces
// already read from `match_archive` so they never surface retired
// ratings; the columns exist so the invariant
//
//   SELECT COUNT(*) FROM match_rating mr
//   LEFT JOIN match_archive ma ON ma.game_id = mr.game_id
//   WHERE ma.game_id IS NULL AND mr.archive_retired_at IS NULL
//
// can be asserted to be 0 by health checks.

export interface RatingArchiveOrphan {
  gameId: string;
  createdAt: number;
}

// Recognised retirement reasons. Free-form text is accepted by the
// schema; this list documents the canonical codes operators should
// reach for first, in audit-friendliness order.
export const ARCHIVE_RETIRED_REASONS = [
  'pre_audit_cleanup', // historic cleanup before this column existed
  'r2_loss', // R2 object disappeared (bucket purge / TTL bug / op error)
  'manual_redact', // operator removed the archive deliberately
  'expired_retention', // routine retention purge ran
] as const;

export type ArchiveRetiredReason = (typeof ARCHIVE_RETIRED_REASONS)[number];

interface OrphanRow {
  game_id: string;
  created_at: number;
}

// List rated matches whose archive row is missing AND that have not
// already been marked retired. Operators run this before applying a
// new retirement reason; the empty result is the desired steady state.
export const listUnretiredRatingArchiveOrphans = async (
  db: D1Database,
  limit = 100,
): Promise<RatingArchiveOrphan[]> => {
  const result = await db
    .prepare(
      'SELECT mr.game_id, mr.created_at ' +
        'FROM match_rating mr ' +
        'LEFT JOIN match_archive ma ON ma.game_id = mr.game_id ' +
        'WHERE ma.game_id IS NULL ' +
        'AND mr.archive_retired_at IS NULL ' +
        'ORDER BY mr.created_at DESC ' +
        'LIMIT ?',
    )
    .bind(limit)
    .all<OrphanRow>();
  return (result.results ?? []).map((row) => ({
    gameId: row.game_id,
    createdAt: row.created_at,
  }));
};

// Mark a set of rating rows as retired so the orphan invariant query
// returns 0 even though the underlying archive row / R2 object cannot
// be restored. Idempotent: calling twice leaves the original
// retired_at timestamp unchanged.
export const markRatingArchiveRetired = async (
  db: D1Database,
  gameIds: string[],
  reason: string,
  now: number,
): Promise<{ marked: number }> => {
  if (gameIds.length === 0) {
    return { marked: 0 };
  }

  const placeholders = gameIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `UPDATE match_rating ` +
        `SET archive_retired_at = ?, archive_retired_reason = ? ` +
        `WHERE game_id IN (${placeholders}) ` +
        `AND archive_retired_at IS NULL`,
    )
    .bind(now, reason, ...gameIds)
    .run();
  const meta = (result as { meta?: { changes?: number } }).meta;
  return { marked: meta?.changes ?? 0 };
};
