export interface PlayerRecoveryRecord {
  playerKey: string;
  recoveryHash: string;
  issuedAt: number;
}

interface PlayerRecoveryRow {
  player_key: string;
  recovery_hash: string;
  issued_at: number;
}

const rowToRecord = (row: PlayerRecoveryRow): PlayerRecoveryRecord => ({
  playerKey: row.player_key,
  recoveryHash: row.recovery_hash,
  issuedAt: row.issued_at,
});

export const upsertPlayerRecovery = async (opts: {
  db: D1Database;
  playerKey: string;
  recoveryHash: string;
  issuedAt: number;
}): Promise<void> => {
  await opts.db
    .prepare(
      'INSERT INTO player_recovery (player_key, recovery_hash, issued_at) ' +
        'VALUES (?, ?, ?) ' +
        'ON CONFLICT(player_key) DO UPDATE SET ' +
        'recovery_hash = excluded.recovery_hash, issued_at = excluded.issued_at',
    )
    .bind(opts.playerKey, opts.recoveryHash, opts.issuedAt)
    .run();
};

export const selectPlayerRecoveryByHash = async (
  db: D1Database,
  recoveryHash: string,
): Promise<PlayerRecoveryRecord | null> => {
  const row = await db
    .prepare(
      'SELECT player_key, recovery_hash, issued_at ' +
        'FROM player_recovery WHERE recovery_hash = ? LIMIT 1',
    )
    .bind(recoveryHash)
    .first<PlayerRecoveryRow>();
  return row ? rowToRecord(row) : null;
};

export const revokePlayerRecovery = async (
  db: D1Database,
  playerKey: string,
): Promise<void> => {
  await db
    .prepare('DELETE FROM player_recovery WHERE player_key = ?')
    .bind(playerKey)
    .run();
};
