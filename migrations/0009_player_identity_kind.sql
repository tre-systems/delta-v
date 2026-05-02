-- Make player-row identity lifecycle explicit so future filtering /
-- retention / archive-quality decisions stop relying on
-- `username LIKE 'Pilot ____'` and prefix globbing.
--
-- Values written by claimPlayerName at first-claim time:
--   claimed_human   - explicit POST /api/claim-name with a real callsign
--   default_human   - matchmaker auto-claim with `Pilot XXXX` default
--   agent           - POST /api/agent-token (not the official-bot key)
--   official_bot    - OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY
--   seed_agent      - bootstrap / seeding scripts (set via direct D1 update)
--   test            - reserved-test prefixes (QA_, Probe_, Bot_) caught at
--                     claim time
--
-- Backfill conservatively from existing columns: is_agent=1 maps to the
-- generic `agent` kind, the official-bot key maps to `official_bot`, and
-- everything else is left null until a future claim or operator update
-- assigns the right kind. Index is kept narrow because retention /
-- visibility queries always combine identity_kind with one of last_match_at
-- or rating.

ALTER TABLE player ADD COLUMN identity_kind TEXT;

UPDATE player
SET identity_kind = 'official_bot'
WHERE player_key = 'agent_official_quickmatch_normal' AND identity_kind IS NULL;

UPDATE player
SET identity_kind = 'agent'
WHERE is_agent = 1 AND identity_kind IS NULL;

CREATE INDEX idx_player_identity_kind
  ON player (identity_kind);
