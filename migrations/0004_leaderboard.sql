-- Public leaderboard with Elo (Glicko-2).
--
-- `player` binds an opaque client-held playerKey to the user's
-- callsign / username (same string the client shows in the Callsign
-- field, reused from src/shared/player.ts). Humans claim a username
-- via POST /api/claim-name; agents claim via POST /api/agent-token
-- with an optional `claim` body. First-claim wins in both cases.
-- Agents carry is_agent=1 so the UI can badge them.
--
-- Ratings are stored in the Glicko-2 display scale (1500 default,
-- RD 350, volatility 0.06). A player is "provisional" (hidden from
-- the default leaderboard view) until their rd shrinks below the
-- threshold and they've played enough distinct opponents — see
-- src/shared/rating/provisional.ts.
--
-- `match_rating` records one row per rated match. Writes use game_id
-- PRIMARY KEY so a replay or retry of the same match is an idempotent
-- no-op via INSERT OR IGNORE. Rows remain even if the matching
-- match_archive row ages out.

CREATE TABLE player (
  player_key          TEXT    PRIMARY KEY,
  username            TEXT    NOT NULL UNIQUE,
  is_agent            INTEGER NOT NULL DEFAULT 0,
  rating              REAL    NOT NULL DEFAULT 1500,
  rd                  REAL    NOT NULL DEFAULT 350,
  volatility          REAL    NOT NULL DEFAULT 0.06,
  games_played        INTEGER NOT NULL DEFAULT 0,
  distinct_opponents  INTEGER NOT NULL DEFAULT 0,
  last_match_at       INTEGER,
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_player_rating
  ON player (rating DESC);

CREATE TABLE match_rating (
  game_id        TEXT    PRIMARY KEY,
  player_a_key   TEXT    NOT NULL,
  player_b_key   TEXT    NOT NULL,
  winner_key     TEXT,
  pre_rating_a   REAL    NOT NULL,
  post_rating_a  REAL    NOT NULL,
  pre_rating_b   REAL    NOT NULL,
  post_rating_b  REAL    NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_match_rating_player_a
  ON match_rating (player_a_key);

CREATE INDEX idx_match_rating_player_b
  ON match_rating (player_b_key);
