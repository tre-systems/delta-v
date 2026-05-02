-- Add visibility and quality-flag columns so the public match-history
-- listing can hide low-quality / noise rows without deleting the
-- underlying R2 + D1 audit records.
--
-- `public_visible` is the single toggle the public listing reads. It
-- defaults to 1 (visible) so existing rows keep the prior behaviour;
-- the archive code in `match-archive.ts` flips it to 0 at write time
-- when the row matches an obvious-noise pattern such as a 1- or 2-turn
-- disconnect-forfeit, a null-outcome abandoned match, both participant
-- snapshots empty (placeholder seats), or a reserved-test callsign.
--
-- `quality_flags` is a small JSON array of string reasons captured at
-- archive time so operators can audit *why* a row was hidden. Older
-- rows leave it null. The public API never exposes this column.
--
-- Index supports the filtered listing query
-- (`WHERE public_visible = 1 ORDER BY completed_at DESC`).

ALTER TABLE match_archive
  ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 1;

ALTER TABLE match_archive
  ADD COLUMN quality_flags TEXT;

CREATE INDEX idx_match_archive_public_visible_completed_at
  ON match_archive (public_visible, completed_at DESC);
