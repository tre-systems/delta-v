# ADR 0001: Data retention and deletion (D1, R2, DO)

## Context

Delta-V persists:

- **D1** `events` — telemetry and error rows from Workers and DO.
- **D1** `match_archive` — metadata index for completed matches.
- **R2** (when bound) — `matches/{gameId}.json` full archives.
- **Durable Object storage** — live match event chunks, checkpoints, room config; evicted when the DO is inactive (plus optional R2 archive at match end).

Growth is **unbounded by default** in application code.

## Decision

1. **Default policy:** **Retain** telemetry and match archives until an explicit operations policy says otherwise. There is no automatic TTL in app code today.
2. **Operational control:** Use **Cloudflare D1** export/backup, **R2 lifecycle rules** (e.g. transition to cheaper tier or delete after N days), and **manual SQL** (`DELETE` batches) when a retention window is mandated.
3. **User deletion requests:** If a jurisdiction requires erasure, use **`anon_id`** (client UUID) and time windows in `events`; match archives may require **gameId/room_code** correlation — document a runbook when needed.

## Consequences

- Cost scales with traffic and completed matches; monitor D1 rows and R2 size.
- [BACKLOG.md](../BACKLOG.md) “Data lifecycle” item remains valid if product needs automated purge.
- [SECURITY.md](../SECURITY.md) and [OBSERVABILITY.md](../OBSERVABILITY.md) describe what is stored, not legal guarantees.
