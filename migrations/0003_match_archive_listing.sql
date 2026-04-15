-- Add match_coached flag so the public match-history page can tag
-- matches that used the /coach whisper. Persisted from DO storage at
-- archive time (see archiveCompletedMatch).
--
-- Index on completed_at for fast "newest first" pagination used by the
-- GET /api/matches listing endpoint.

ALTER TABLE match_archive ADD COLUMN match_coached INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_match_archive_completed_at
  ON match_archive (completed_at DESC);
