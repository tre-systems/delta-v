-- Manual agent identities need a second, non-public possession secret before
-- the token issuer will renew their 24-hour bearer. This prevents someone who
-- learns or guesses an agent_* player key from impersonating that agent or
-- renaming its leaderboard callsign.

CREATE TABLE agent_credential (
  player_key TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER,
  legacy_locked INTEGER NOT NULL DEFAULT 0 CHECK (legacy_locked IN (0, 1))
);

-- Existing manual agents pre-date renewal secrets. Lock their identities
-- rather than leave a first-request takeover window. A still-valid bearer can
-- upgrade a locked identity and receive its one-time renewal secret.
INSERT INTO agent_credential (
  player_key,
  credential_hash,
  created_at,
  legacy_locked
)
SELECT
  player_key,
  lower(hex(randomblob(32))),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  1
FROM player
WHERE is_agent = 1
  AND player_key NOT LIKE 'agent_oauth_%';
