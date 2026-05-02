-- Snapshot participant callsigns onto each archived match so the public
-- match-history UI no longer depends on `match_archive -> match_rating ->
-- player` joins. The 2026-05-02 cleanup exposed that pruning a `Pilot XXXX`
-- default-callsign row could orphan an archived match's display name; the
-- archive table should hold an immutable snapshot at completion time.
--
-- Backfill is intentionally not done here: existing rows keep showing nulls
-- in the new columns, and the listing query falls back to the legacy join
-- when a snapshot is null. Future archives populate the new columns
-- directly.

ALTER TABLE match_archive ADD COLUMN player_a_username TEXT;
ALTER TABLE match_archive ADD COLUMN player_b_username TEXT;
ALTER TABLE match_archive ADD COLUMN winner_username TEXT;
