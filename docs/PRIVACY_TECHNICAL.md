# Privacy — technical summary

Describes what the Delta-V stack stores. Not a privacy policy, legal review, or jurisdiction-specific compliance advice.

## Scope

Telemetry/error collection, server-side diagnostics, and match-archive storage. Does not define legal basis, consent language, or user-facing policy wording.

## Client data flow

- **`anonId`** — random UUID in `localStorage` under key `deltav_anon_id`, attached to client reporting payloads ([`src/client/telemetry.ts`](../src/client/telemetry.ts)).
- **Player profile** — the lobby stores `{ playerKey, username, updatedAt }` in `localStorage['delta-v:player-profile']` so a returning browser keeps the same callsign and matchmaking identity. The lobby now exposes a **Forget my callsign** control that removes this local profile and clears cached room tokens on the current device.
- **Session tokens** — room-scoped `playerToken`s are cached in `localStorage['delta-v:tokens']` for reconnect/join convenience. The cache is pruned to the most recent 8 entries and drops anything older than 24 hours.
- **`reportError()`** — sends `error`, caller-supplied `context`, `url`, and `ua`.
- **`track(event, props)`** — sends arbitrary event names / props.
- **Requirement at call sites:** never put secrets, credentials, or direct personal data in telemetry/error props.

## Server storage

- `POST /telemetry` and `POST /error` accept JSON up to **4 KB** ([`src/server/index.ts`](../src/server/index.ts)).
- The client IP is transformed into `ip_hash` (SHA-256, truncated) before any D1 write; the raw IP is not written.
- Events are stored in D1 `events` with columns `ts`, `anon_id`, `event`, `props`, `ip_hash`, `ua` — see [`migrations/0001_create_events.sql`](../migrations/0001_create_events.sql).
- Durable Object diagnostic events (`engine_error`, `projection_parity_mismatch`, `game_abandoned`, lifecycle events) insert with `ip_hash = 'server'`; diagnostic payloads may include stack traces.

## Match and gameplay data

- Match metadata is stored in D1 `match_archive`; completed match archives are stored in R2 as `matches/{gameId}.json`.
- Chat is transmitted over WebSocket only; it is not written to D1 on the default telemetry/error path.

## Leaderboard data

- `POST /api/claim-name` (human) and `POST /api/agent-token` with `{ claim: { username } }` (agent) bind a client-held `playerKey` to a user-chosen `username` in D1 `player`. `is_agent` is set from the verified agent flow, not from the `playerKey` prefix alone.
- D1 `match_rating` stores one row per rated match (`game_id`, both `player_key`s, winner, and Glicko-2 before/after snapshots). Rows are keyed on `game_id` so replays / retries are idempotent via `INSERT OR IGNORE`.
- Public API (`GET /api/leaderboard`, `GET /api/leaderboard/me`) exposes only `username`, rating triple, `games_played`, `distinct_opponents`, `last_match_at`, and `is_agent`; `playerKey` is never returned in responses.
- Public API `GET /api/matches` does not expose usernames; the public match log includes only match metadata plus replay-identifying room/game ids.

## Operational note

- Access to logs, D1 query surfaces, and R2 archives is restricted to trusted maintainers.
- The product ships a short in-app operational disclosure describing anonymous diagnostics and completed-match archives. That is not a substitute for legal review.

## Further reading

- [SECURITY.md](./SECURITY.md) — abuse controls, endpoint hardening, data retention.
- [OBSERVABILITY.md](./OBSERVABILITY.md) — telemetry event catalog and incident queries.
