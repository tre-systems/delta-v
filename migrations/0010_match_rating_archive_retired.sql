-- Make `match_rating` orphans (rated games whose archive row + R2
-- object are gone) explicit instead of silently breaking the
-- "every rated game has a replay" invariant. The 2026-05-02
-- post-deploy Cloudflare audit found 11 such rows where operator
-- cleanup deleted only the archive side. This migration adds two
-- columns so a future cleanup can mark instead of leaving the
-- relationship inconsistent, and backfills the known orphans with a
-- sentinel reason so the audit query returns "all-retired" today.
--
-- `archive_retired_at` is the unix-ms timestamp the rating row was
-- declared archive-less. `archive_retired_reason` is a short stable
-- string operators set at retirement time (e.g. `pre_audit_cleanup`,
-- `r2_loss`, `manual_redact`). Public listings continue to read from
-- `match_archive` so they never surface a retired rating; the columns
-- exist so the audit invariant
--
--   SELECT COUNT(*) FROM match_rating mr
--   LEFT JOIN match_archive ma ON ma.game_id = mr.game_id
--   WHERE ma.game_id IS NULL AND mr.archive_retired_at IS NULL
--
-- can be asserted to be 0 by R20 / health checks.

ALTER TABLE match_rating ADD COLUMN archive_retired_at INTEGER;
ALTER TABLE match_rating ADD COLUMN archive_retired_reason TEXT;

CREATE INDEX idx_match_rating_archive_retired_at
  ON match_rating (archive_retired_at);

-- Backfill known orphans from the 2026-05-02 audit. game_id list comes
-- from `SELECT mr.game_id FROM match_rating mr LEFT JOIN match_archive ma
-- ON ma.game_id = mr.game_id WHERE ma.game_id IS NULL` against the
-- production database immediately before this migration ran.
UPDATE match_rating
SET archive_retired_at = strftime('%s','now') * 1000,
    archive_retired_reason = 'pre_audit_cleanup'
WHERE game_id IN (
  '25BXH-m1',
  '3PJYX-m1',
  'B82EB-m1',
  'BCFV9-m1',
  'CH24Y-m1',
  'ETJBH-m1',
  'G4489-m1',
  'H5SFM-m1',
  'N7GMX-m1',
  'WKN9P-m1',
  'YAE2N-m1'
);
