-- Optional human callsign recovery. Recovery codes are possession
-- secrets shown once to the player; D1 stores only a one-way hash.

CREATE TABLE player_recovery (
  player_key     TEXT    PRIMARY KEY,
  recovery_hash  TEXT    NOT NULL UNIQUE,
  issued_at      INTEGER NOT NULL
);

CREATE INDEX idx_player_recovery_hash
  ON player_recovery (recovery_hash);
