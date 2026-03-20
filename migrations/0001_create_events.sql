-- Telemetry and error events table
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  anon_id   TEXT,
  event     TEXT NOT NULL,
  props     TEXT,
  ip_hash   TEXT,
  ua        TEXT,
  created   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_event ON events(event);
CREATE INDEX idx_events_anon ON events(anon_id);
