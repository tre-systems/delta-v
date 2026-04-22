-- Persist whether a completed rated match used the platform-operated
-- Official Bot quick-match fallback so archive/history surfaces can
-- disclose that provenance without hard-coding player keys.

ALTER TABLE match_archive
  ADD COLUMN official_bot_match INTEGER NOT NULL DEFAULT 0;
