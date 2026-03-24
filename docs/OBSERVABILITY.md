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

## PII / privacy stance (technical)

- **Client**: `anonId` is a random UUID in `localStorage` (`deltav_anon_id`); `reportError` may include `url`, `ua`, and arbitrary context — keep context **non-sensitive** at call sites.
- **Server**: stores **hashed IP** (`ip_hash`), not raw IP, for client-originated rows.
- **Chat text** is not written to D1 by default (in-game only).

User-facing policy copy is out of scope here; align any public privacy text with this behavior.

## Gaps and follow-ups

- No built-in **dashboards** or **alerts** — use Cloudflare + D1 exports or third-party tools.
- **Rate limits** on `/telemetry` and `/error` are recommended under abuse; see [BACKLOG.md](./BACKLOG.md) and [SECURITY.md](./SECURITY.md).
- **Sampling** or caps can be added in `src/server/index.ts` before `insertEvent` if volume grows.
