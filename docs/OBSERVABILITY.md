# Observability

What Delta-V emits today and how to use it for incidents and tuning. Complements [SECURITY.md](./SECURITY.md) (telemetry abuse) and [ARCHITECTURE.md](./ARCHITECTURE.md) (server layout).

- [Sources](#sources)
- [D1 `events` schema and event catalog](#d1-events-schema-summary)
- [Server-side lifecycle and side-channel events](#server-side-lifecycle-and-side-channel-events)
- [Incident triage quickstart](#incident-triage-quickstart)
- [Starter alert thresholds](#starter-alert-thresholds-tune-to-baseline)
- [Operational D1 queries](#operational-d1-queries)
- [Workers log filters](#workers-log-filters)
- [PII / privacy stance](#pii-privacy-stance-technical)
- [Gaps and follow-ups](#gaps-and-follow-ups)

## Sources

| Source                          | What                                                                             | Where to read it                                                       |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Worker + DO logs**            | `console.log` / `console.error` from `src/server/index.ts`, `GameDO`, handlers   | Cloudflare Workers **Logs** (observability enabled in `wrangler.toml`) |
| **D1 `events`**                 | Client telemetry, client errors, DO `engine_error`, `projection_parity_mismatch`, `game_abandoned`, lifecycle/side-channel rows (30-day rolling window) | D1 **SQL** in dashboard or `wrangler d1 execute`                       |
| **D1 `match_archive`**          | One row per completed match (metadata index)                                     | Same                                                                   |
| **D1 `player` / `match_rating`**| Leaderboard identity + per-rated-match Glicko-2 snapshots                        | Same                                                                   |
| **R2 `MATCH_ARCHIVE`**          | Full JSON per match (`matches/{gameId}.json`)                                    | R2 bucket browser / API                                                |
| **Client**                      | `track()` → `POST /telemetry`, `reportError()` → `POST /error`                   | Implemented in `src/client/telemetry.ts`                               |

## D1 `events` schema (summary)

From `migrations/0001_create_events.sql`:

- `ts`, `anon_id`, `event`, `props` (JSON string), `ip_hash` (hashed `cf-connecting-ip` for client posts; literal `'server'` for DO inserts), `ua`, `created`.

**Current `event` values**

- From client **`/telemetry`**:
  - `create_game_attempted` with `{ scenario }`
  - `create_game_failed` with `{ scenario, reason, status? }`
  - `game_created` with `{ scenario, mode, difficulty? }`
  - `join_game_attempted` with `{ hasPlayerToken }`
  - `join_game_succeeded` with no additional props
  - `join_game_retried_without_token` with `{ reason }`
  - `join_game_failed` with `{ reason, status?, hasPlayerToken }`
  - `quick_match_attempted`, `quick_match_queued`, `quick_match_found`, `quick_match_failed`, `quick_match_expired`, `quick_match_cancelled` (props vary by path — see `session-api.ts`)
  - `spectate_join_succeeded` with no additional props
  - `reconnect_attempt_scheduled` with `{ attempt, delayMs }`
  - `reconnect_succeeded` with `{ attempts }`
  - `reconnect_failed` with `{ attempts }`
  - `replay_fetch_failed` with `{ reason, gameId, status? }`
  - `replay_fetch_succeeded` with `{ gameId }`
  - `archived_replay_fetch_failed` / `archived_replay_fetch_succeeded` with `{ gameId, ... }`
  - `game_over` with `{ won, reason, scenario, mode, turn? }`
  - `server_error_received` with `{ message, code? }`
  - `action_rejected_received` with `{ reason, expectedTurn?, expectedPhase?, actualTurn, actualPhase, activePlayer }` (browser path when ActionGuards reject)
  - `ws_parse_error` with no additional props
  - `ws_invalid_message` with `{ error }`
  - `ws_connect_error` with no additional props (fires on `WebSocket` `error` before close)
  - `ws_connect_closed` with `{ code, wasClean, reasonLen }` (first connect / reconnect close telemetry)
  - `turn_completed` with `{ turn, totalMs, phases, scenario, mode }`
  - `first_turn_completed` with `{ turn, totalMs, phases, scenario, mode }`
  - `scenario_browsed` with no additional props
  - `tutorial_started` with no additional props
  - `tutorial_completed` with no additional props
  - `tutorial_skipped` with no additional props
  - `fleet_ready_submitted`, `surrender_submitted` (see `main-interactions.ts`)
  - `ai_game_started` with `{ scenario, difficulty }` (local AI path)
- From client **`/error`**: `client_error` with `{ error, url, ua, ...context }`; current global handlers add either `{ source, line, col }` or `{ type: 'unhandledrejection' }`.
- From **`game-do/telemetry.ts`**: `engine_error` with `{ code, phase, turn, message, stack? }`; `projection_parity_mismatch` with `{ gameId, liveTurn, livePhase, projectedTurn, projectedPhase }`; `game_abandoned` with `{ gameId, turn, phase, reason, scenario }` (server-side; `anon_id` null, `ip_hash` `'server'`).

### Server-side lifecycle and side-channel events

Emitted from `src/server/game-do/telemetry.ts` (`reportLifecycleEvent`, `reportSideChannelFailure`) and `src/server/matchmaker-do.ts`. All share `anon_id = null` and `ip_hash = 'server'`. Lifecycle events emit `console.log`; side-channel failures emit `console.error` so the two streams are easy to separate in Workers Logs.

**Lifecycle (normal signals):**

- `game_started` — `{ gameId, code, scenario }`
- `game_ended` — `{ gameId, code, turn, winner, reason }` (`winner` is `null` on draws)
- `disconnect_grace_started` — `{ code, player, disconnectAt }` (ms epoch the grace expires)
- `disconnect_grace_resolved` — `{ code, player }` (marker cleared because the player reconnected)
- `disconnect_grace_expired` — `{ code, player }` (grace ran out; engine will forfeit)
- `turn_timeout_fired` — `{ code, gameId, turn, phase, activePlayer }`
- `matchmaker_paired` — `{ code, scenario, leftKey, rightKey, waitMsLeft, waitMsRight }`

**Side-channel failures (investigate on spike):**

- `live_registry_register_failed` — `{ code, scenario, status?, error? }` (match may be missing from `/matches`)
- `live_registry_deregister_failed` — `{ code, status?, error? }` (stale "Live now" entry)
- `mcp_observation_timeout` — `{ handler, timeoutMs }` (10 s hard ceiling; future async paths could hang requests otherwise)
- `matchmaker_pairing_split` — `{ code?, reason, conflicts?, status?, attempts? }` (`reason` ∈ `room_code_collision` / `allocation_failed` / `max_retries_exceeded`)

Static **`GET /version.json`** (built into `dist/` at bundle time) exposes `{ packageVersion, assetsHash }` for support — it is not written to D1.

## Incident triage quickstart

Use this when someone reports "game is broken" or metrics look wrong.

1. Confirm scope quickly in Workers Logs:
   - Is it one room code or many?
   - Is it one browser/device cohort or broad?
2. Check for an error spike, then split by hour:

```sql
-- Error spike (last 24h)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND event IN ('client_error', 'engine_error', 'projection_parity_mismatch')
GROUP BY event
ORDER BY n DESC;

-- Same, split by hour (last 6h)
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
- `mcp_observation_timeout` > 0 in any rolling 15-minute window: investigate — expected rate is 0.
- `live_registry_register_failed` or `live_registry_deregister_failed` > 2 in 15 minutes: LiveRegistryDO may be down; `/matches` will lag reality.
- `matchmaker_pairing_split` / `matchmaker_paired` > 5% sustained over 1 hour: queue is hot enough to warrant coalesced allocation.
- `disconnect_grace_expired` / (`disconnect_grace_resolved` + `disconnect_grace_expired`) > 50% over 1 hour: reconnect flow is failing for most players.

## Operational D1 queries

Paste these into the Cloudflare D1 console or run via `wrangler d1 execute`.

```sql
-- Telemetry volume by event name (last 24h)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
GROUP BY event
ORDER BY n DESC
LIMIT 30;

-- Match completions by scenario (last 7 days)
SELECT scenario, COUNT(*) AS matches,
       AVG(turns) AS avg_turns,
       AVG(completed_at - created_at) / 1000.0 AS avg_duration_s
FROM match_archive
WHERE completed_at > (strftime('%s','now') - 7 * 86400) * 1000
GROUP BY scenario
ORDER BY matches DESC;

-- Active unique clients (last 24h, by anon_id)
SELECT COUNT(DISTINCT anon_id) AS unique_clients
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND anon_id IS NOT NULL;

-- Scenario popularity (games created, last 7 days)
SELECT json_extract(props, '$.scenario') AS scenario, COUNT(*) AS n
FROM events
WHERE event = 'game_created'
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

-- Lifecycle cadence (last 24h)
SELECT event, COUNT(*) AS n
FROM events
WHERE ts > (strftime('%s','now') - 86400) * 1000
  AND event IN (
    'game_started', 'game_ended',
    'disconnect_grace_started', 'disconnect_grace_resolved', 'disconnect_grace_expired',
    'turn_timeout_fired', 'matchmaker_paired'
  )
GROUP BY event
ORDER BY n DESC;

-- Disconnect-grace outcomes — resolved (player reconnected) vs expired (forfeit).
-- A high expired/(resolved+expired) ratio means reconnects are failing.
SELECT
  SUM(CASE WHEN event = 'disconnect_grace_resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN event = 'disconnect_grace_expired'  THEN 1 ELSE 0 END) AS expired
FROM events
WHERE ts > (strftime('%s','now') - 7 * 86400) * 1000
  AND event IN ('disconnect_grace_resolved', 'disconnect_grace_expired');

-- Matchmaker split rate (last 7 days). If splits / paired > ~1% in a quiet
-- period, consider coalesced enqueue or longer retry budget in MatchmakerDO.
SELECT
  SUM(CASE WHEN event = 'matchmaker_paired'         THEN 1 ELSE 0 END) AS paired,
  SUM(CASE WHEN event = 'matchmaker_pairing_split'  THEN 1 ELSE 0 END) AS splits
FROM events
WHERE ts > (strftime('%s','now') - 7 * 86400) * 1000
  AND event IN ('matchmaker_paired', 'matchmaker_pairing_split');

-- Matchmaker split reasons (breaks down the 'splits' counter above).
SELECT json_extract(props, '$.reason') AS reason, COUNT(*) AS n
FROM events
WHERE event = 'matchmaker_pairing_split'
  AND ts > (strftime('%s','now') - 7 * 86400) * 1000
GROUP BY reason
ORDER BY n DESC;

-- MCP observation timeouts (last 24h). Expected value is 0; any spike
-- suggests a hung dependency under buildObservation or DO contention.
SELECT COUNT(*) AS n
FROM events
WHERE event = 'mcp_observation_timeout'
  AND ts > (strftime('%s','now') - 86400) * 1000;

-- LIVE_REGISTRY failures (last 24h). Non-zero means some matches never
-- appeared on /matches (register) or stayed visible after end (deregister).
SELECT event, COUNT(*) AS n
FROM events
WHERE event IN ('live_registry_register_failed', 'live_registry_deregister_failed')
  AND ts > (strftime('%s','now') - 86400) * 1000
GROUP BY event;

-- Turn-timeout rate per scenario (last 7 days). Correlate with
-- game_abandoned to tell "AFK player" from "engine wedge".
SELECT json_extract(props, '$.phase') AS phase, COUNT(*) AS n
FROM events
WHERE event = 'turn_timeout_fired'
  AND ts > (strftime('%s','now') - 7 * 86400) * 1000
GROUP BY phase
ORDER BY n DESC;
```

## Workers log filters

In the Cloudflare Workers **Logs** tab, filter by:

- `Engine error` — catches `console.error` from game action failures
- `Inactivity timeout` — room cleanup events
- `Rate limit exceeded` — WebSocket abuse
- `projection_parity_mismatch` — replay integrity issues (critical)
- `[game_started]` / `[game_ended]` — lifecycle trace for a single match
- `[matchmaker_pairing_split]` — immediate smoke-test when the matchmaker looks unhealthy
- `[mcp_observation_timeout]` — any hit is unexpected; inspect the handler label in `props`

## PII / privacy stance (technical)

- **Client:** `anonId` is a random UUID in `localStorage` (`deltav_anon_id`). `reportError` may include `url`, `ua`, and arbitrary context — keep context **non-sensitive** at call sites.
- **Server:** stores **hashed IP** (`ip_hash`), not raw IP, for client-originated rows.
- **Chat text** is not written to D1 by default (in-game only).

User-facing policy copy is out of scope here; align any public privacy text with this behavior. See [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md).

## Gaps and follow-ups

- No built-in **dashboards** or **alerts** — use Cloudflare + D1 exports or third-party tools. Operational D1 queries are documented above.
- **Rate limits:** canonical table in [SECURITY.md#3-rate-limiting-architecture](./SECURITY.md#3-rate-limiting-architecture); optional cross-edge WAF if distributed abuse is observed.
- **Retention:** `events` rows older than 30 days are deleted daily by `purgeOldEvents` (cron `0 4 * * *` in `wrangler.toml`). Other tables (`match_archive`, `player`, `match_rating`, R2 archives) have no automatic TTL — see [SECURITY.md § Data retention](./SECURITY.md#data-retention-d1-r2-do).
- **Sampling** or caps can be added in `src/server/index.ts` before `insertEvent` if volume grows.
