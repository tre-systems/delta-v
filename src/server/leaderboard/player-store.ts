// D1 access for the `player` table defined in
// migrations/0004_leaderboard.sql. One player row per playerKey; a
// row is created on first successful claim and thereafter mutated
// both by rename and by the rating-update path.
//
// Rename semantics: a playerKey can update its own username freely
// (matches the client-side callsign model where users tweak names).
// A username taken by a *different* key returns a `name_taken` error
// with no DB mutation. This lets the home-screen Callsign field act
// as the single source of identity: same input for local display and
// public leaderboard.

export interface PlayerRecord {
  playerKey: string;
  username: string;
  isAgent: boolean;
  rating: number;
  rd: number;
  volatility: number;
  gamesPlayed: number;
  distinctOpponents: number;
  lastMatchAt: number | null;
  createdAt: number;
}

export type ClaimOutcome =
  | { ok: true; player: PlayerRecord; created: boolean; renamed: boolean }
  | { ok: false; error: 'name_taken' };

interface PlayerRow {
  player_key: string;
  username: string;
  is_agent: number;
  rating: number;
  rd: number;
  volatility: number;
  games_played: number;
  distinct_opponents: number;
  last_match_at: number | null;
  created_at: number;
}

const SELECT_COLUMNS =
  'player_key, username, is_agent, rating, rd, volatility, ' +
  'games_played, distinct_opponents, last_match_at, created_at';

const rowToRecord = (row: PlayerRow): PlayerRecord => ({
  playerKey: row.player_key,
  username: row.username,
  isAgent: row.is_agent === 1,
  rating: row.rating,
  rd: row.rd,
  volatility: row.volatility,
  gamesPlayed: row.games_played,
  distinctOpponents: row.distinct_opponents,
  lastMatchAt: row.last_match_at,
  createdAt: row.created_at,
});

export const selectPlayerByKey = async (
  db: D1Database,
  playerKey: string,
): Promise<PlayerRecord | null> => {
  const row = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM player WHERE player_key = ? LIMIT 1`,
    )
    .bind(playerKey)
    .first<PlayerRow>();
  return row ? rowToRecord(row) : null;
};

export const claimPlayerName = async (opts: {
  db: D1Database;
  playerKey: string;
  username: string;
  isAgent: boolean;
  now: number;
}): Promise<ClaimOutcome> => {
  const { db, playerKey, username, isAgent, now } = opts;

  const existing = await selectPlayerByKey(db, playerKey);

  if (existing) {
    // Same name the caller already owns — nothing to do.
    if (existing.username === username) {
      return { ok: true, player: existing, created: false, renamed: false };
    }
    // Rename request. UPDATE will fail with UNIQUE(username) if the
    // target name is already owned by someone else.
    try {
      await db
        .prepare('UPDATE player SET username = ? WHERE player_key = ?')
        .bind(username, playerKey)
        .run();
    } catch (err) {
      if (!isConstraintError(err)) throw err;
      return { ok: false, error: 'name_taken' };
    }
    const renamed = await selectPlayerByKey(db, playerKey);
    if (!renamed) throw new Error('player row missing after rename');
    return { ok: true, player: renamed, created: false, renamed: true };
  }

  try {
    await db
      .prepare(
        'INSERT INTO player (player_key, username, is_agent, created_at) ' +
          'VALUES (?, ?, ?, ?)',
      )
      .bind(playerKey, username, isAgent ? 1 : 0, now)
      .run();
  } catch (err) {
    // Race: either another request for this key just inserted, or the
    // username is already owned by a different key. Re-select by key.
    if (!isConstraintError(err)) throw err;
    const after = await selectPlayerByKey(db, playerKey);
    if (after) {
      return { ok: true, player: after, created: false, renamed: false };
    }
    return { ok: false, error: 'name_taken' };
  }

  const fresh = await selectPlayerByKey(db, playerKey);
  if (!fresh) {
    throw new Error('player row missing after insert');
  }
  return { ok: true, player: fresh, created: true, renamed: false };
};

const isConstraintError = (err: unknown): boolean =>
  err instanceof Error && /constraint|UNIQUE/i.test(err.message);
