# Observability map

What Delta-V emits today and how to use it for incidents and tuning. Complements [SECURITY.md](./SECURITY.md) (telemetry abuse) and [ARCHITECTURE.md](./ARCHITECTURE.md) (server layout).

## Sources

| Source                 | What                                                                             | Where to read it                                                       |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Worker + DO logs**   | `console.log` / `console.error` from `src/server/index.ts`, `GameDO`, handlers   | Cloudflare Workers **Logs** (observability enabled in `wrangler.toml`) |
| **D1 `events`**        | Client telemetry, client errors, DO `engine_error`, `projection_parity_mismatch` | D1 **SQL** in dashboard or `wrangler d1 execute`                       |
| **D1 `match_archive`** | One row per completed match (metadata index)                                     | Same                                                                   |
| **R2 `MATCH_ARCHIVE`** | Full JSON per match (`matches/{gameId}.json`)                                    | R2 bucket browser / API                                                |
| **Client**             | `track()` → `POST /telemetry`, `reportError()` → `POST /error`                   | Implemented in `src/client/telemetry.ts`                               |

## D1 `events` schema (summary)

From `migrations/0001_create_events.sql`:

- `ts`, `anon_id`, `event`, `props` (JSON string), `ip_hash` (hashed `cf-connecting-ip` for client posts; literal `'server'` for DO inserts), `ua`, `created`.

**Typical `event` values**

- From client **`/telemetry`**: whatever `track('eventName', props)` sends (`event` column + merged props).
- From client **`/error`**: `client_error` plus payload fields.
- From **`game-do/telemetry.ts`**: `engine_error`, `projection_parity_mismatch` (server-side; `anon_id` null, `ip_hash` `'server'`).

## Sample D1 queries

```sql
-- Error spike (last 24h, client-reported)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND event IN ('client_error', 'engine_error', 'projection_parity_mismatch')
GROUP BY event
ORDER BY n DESC;

-- Telemetry volume by event name (adjust time filter)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
GROUP BY event
ORDER BY n DESC
LIMIT 30;
```

## Incident triage quickstart

Use this when someone reports "game is broken" or metrics look wrong.

1. Confirm scope quickly in Workers Logs:
   - Is it one room code or many?
   - Is it one browser/device cohort or broad?
2. Run the error-spike query above, then split by hour:

```sql
SELECT
  event,
  strftime('%Y-%m-%d %H:00', ts / 1000, 'unixepoch') AS hour,
  COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 6 * 3600) * 1000
  AND event IN ('client_error', 'engine_error', 'projection_parity_mismatch')
GROUP BY event, hour
ORDER BY hour DESC, n DESC;
```

3. If `projection_parity_mismatch` or `engine_error` rises:
   - Treat as server-authority/replay integrity risk first.
   - Check recent deploy/commit range and disable risky rollout if needed.
4. If `client_error` rises without server errors:
   - Suspect client/runtime or browser-specific regressions.
   - Correlate by `ua` and recent UI changes.
5. If match completion looks wrong, inspect:
   - D1 `match_archive` rows for missing/abnormal completions.
   - R2 `matches/{gameId}.json` for a concrete broken sample.

## Starter alert thresholds (tune to baseline)

These are practical defaults until formal dashboards/alerts are added.

- `engine_error` > 0 in a 15-minute window: page maintainer.
- `projection_parity_mismatch` > 0 in a 15-minute window: page maintainer (high severity).
- `client_error`: warn when current 15-minute count is >3x the same weekday/hour baseline.
- `POST /telemetry` or `POST /error` 429 rate spikes: investigate abuse/noisy clients and consider tighter global WAF caps.

## PII / privacy stance (technical)

- **Client**: `anonId` is a random UUID in `localStorage` (`deltav_anon_id`); `reportError` may include `url`, `ua`, and arbitrary context — keep context **non-sensitive** at call sites.
- **Server**: stores **hashed IP** (`ip_hash`), not raw IP, for client-originated rows.
- **Chat text** is not written to D1 by default (in-game only).

User-facing policy copy is out of scope here; align any public privacy text with this behavior.

## Operational D1 queries

Paste these into the Cloudflare D1 console or run via `wrangler d1 execute`.

```sql
-- Match completions by scenario (last 7 days)
SELECT scenario, COUNT(*) AS matches,
       AVG(turn_count) AS avg_turns,
       AVG(duration_ms) / 1000.0 AS avg_duration_s
FROM match_archive
WHERE completed_at > datetime('now', '-7 days')
GROUP BY scenario
ORDER BY matches DESC;

-- Active unique clients (last 24h, by anon_id)
SELECT COUNT(DISTINCT anon_id) AS unique_clients
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND anon_id IS NOT NULL;

-- Scenario popularity (games started, last 7 days)
SELECT json_extract(props, '$.scenario') AS scenario, COUNT(*) AS n
FROM events
WHERE event = 'game_started'
  AND ts > (strftime('%s','now') - 7 * 86400) * 1000
GROUP BY scenario
ORDER BY n DESC;

-- Disconnects and reconnects (last 24h)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND event IN ('reconnect_attempt_scheduled', 'reconnect_failed', 'ws_parse_error', 'ws_invalid_message')
GROUP BY event
ORDER BY n DESC;

-- Top client errors by message (last 24h)
SELECT json_extract(props, '$.message') AS error_msg, COUNT(*) AS n
FROM events
WHERE event = 'client_error'
  AND ts > (strftime('%s','now') - 86400) * 1000
GROUP BY error_msg
ORDER BY n DESC
LIMIT 10;
```

## Workers log filters

In the Cloudflare Workers **Logs** tab, filter by:

- `Engine error` — catches `console.error` from game action failures
- `Inactivity timeout` — room cleanup events
- `Rate limit exceeded` — WebSocket abuse
- `projection_parity_mismatch` — replay integrity issues (critical)

## Gaps and follow-ups

- No built-in **dashboards** or **alerts** — use Cloudflare + D1 exports or third-party tools. Operational D1 queries are documented above.
- **Rate limits:** per-isolate caps on `/telemetry` and `/error` shipped (see [SECURITY.md](./SECURITY.md)); optional global WAF if distributed abuse is observed.
- **Sampling** or caps can be added in `src/server/index.ts` before `insertEvent` if volume grows.
