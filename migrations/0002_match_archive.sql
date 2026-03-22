-- Lightweight metadata for completed matches.
-- Full event streams and checkpoints live in R2;
-- this table provides indexing for lookup and analysis.

CREATE TABLE match_archive (
  game_id      TEXT PRIMARY KEY,
  room_code    TEXT NOT NULL,
  scenario     TEXT NOT NULL,
  winner       INTEGER,
  win_reason   TEXT,
  turns        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);
