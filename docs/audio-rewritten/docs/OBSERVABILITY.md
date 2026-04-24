# Observability

This chapter explains what Delta-V emits today and how to use those signals during incidents, tuning passes, and runtime diagnosis. It complements the security chapter, which covers telemetry abuse, and the architecture chapter, which covers server layout.

## Sources

There are seven main observability sources.

First, Worker and Durable Object logs capture console output and error output from the main Worker entrypoint, the game room object, the matchmaker, and related handlers.

Second, the events table in the primary database stores client telemetry, client error reports, and server-side lifecycle or failure rows within a thirty-day rolling window.

Third, the match-archive table stores one metadata row per completed match.

Fourth, the player and match-rating tables store leaderboard identity and per-rated-match Glicko-2 snapshots.

Fifth, the match-archive object-storage bucket stores one full JSON record per completed match, keyed by game identifier.

Sixth, the browser emits telemetry and error reports to the server through the telemetry and error endpoints.

Seventh, an internal metrics endpoint exposes an authenticated aggregate snapshot over the events and match-archive tables.

In practical terms, browser signals and server-side events both feed the events table and Workers logs, while completed-match archival also feeds the archive index and the JSON object store.

## Events schema and catalog

The events table stores a timestamp, an anonymous identifier, an event name, a JSON properties blob, a hashed client IP — or the literal word "server" for server-originated rows — a user-agent string, and a creation timestamp. The hashed IP is a salted hash of the connecting-IP header; production fails closed when the salt secret is missing.

On the client side, the table records create-game attempts and failures, join attempts and outcomes, the full quick-match flow, spectator joins, reconnect scheduling and outcomes, replay fetch success and failure, leaderboard and match-list views, replay engagement signals — including open, end, early-exit, and speed change — game-over summaries, server errors surfaced to the client, rejected actions, WebSocket parse and validation failures, WebSocket connect-error and connect-close metadata, turn timing for regular and first turns, tutorial state, scenario browsing and scenario-selected events, fleet-ready and surrender submissions, and local artificial-intelligence game starts.

On the client-error side, the table records browser errors and unhandled rejections together with URL, user agent, and basic context.

On the server side, the telemetry module records engine errors, projection parity mismatches, and game-abandoned events; each carries a null anonymous identifier and the "server" literal for the hashed IP.

## Server lifecycle and side-channel events

The server also emits a second class of observability signals that are easier to think of as lifecycle markers and side-channel failures. All share a null anonymous identifier and the "server" literal for the hashed IP. Lifecycle events emit standard console output; side-channel failures emit console error output so the two streams are easy to separate in the logs.

Lifecycle events include game-started, game-ended — the winner is null on draws — disconnect-grace-started, disconnect-grace-resolved, disconnect-grace-expired, turn-timeout-fired, matchmaker-paired, matchmaker-official-bot-filled for explicit fallback acceptance, matchmaker-official-bot-declined for explicit "keep waiting" choices, and rating outcomes such as applied, skipped, or failed.

Official-bot segmentation is carried through the authoritative server path: game-started, game-ended, rating-applied summaries, match-archive rows, and the public matches endpoint all include an official-bot-match flag. That means queue relief, rating impact, and replay or history uptake can all be segmented without inferring from player keys.

Side-channel failures to investigate on spike include live-registry register or deregister failures, which mean a match may be missing from the matches listing or stay visible after it ended; Model Context Protocol observation timeouts, tripped by a ten-second hard ceiling; matchmaker pairing splits, whose reasons include room-code collision, allocation failed, or max-retries exceeded; and game Durable Object code-update eviction signals, which mean an old Durable Object instance handled a post-deploy callback and hit a storage-eviction failure — the triggering interaction is lost, but the room recovers on the next callback against the fresh instance.

A static version endpoint exposes the package version and assets hash for support; it is not written to the events table. Health probes live on a well-known health path with aliases for "/health" and "/status"; the payload reports an overall ok flag, a commit or assets hash resolved from Worker deploy metadata, and the Worker module's boot timestamp.

The Worker entrypoint also records two abuse-focused signals. First, a create-request row in the events table for every create call, capturing route, outcome, scenario, payload bytes, status, and error. This covers direct script traffic that never emits first-party client telemetry. Second, sampled console output under authentication-failure and rate-limit markers for invalid bearers, malformed agent-token payloads, and create-class or Model Context Protocol rate-limit hits. Sampling is deterministic per salted hashed IP so repeated abuse from the same source still leaves a tail signal without flooding logs.

### Internal metrics endpoint

The internal metrics endpoint exposes a small authenticated aggregate snapshot for operators. It is intentionally narrow: enough to answer "is the game healthy this week?" without turning the Worker into a dashboard service. It requires an internal-metrics bearer token; local development and test allow loopback requests without a token when the secret is unset. An optional days parameter selects a one-to-thirty-day window, defaulting to seven. Current response sections include daily active matches, scenario play mix, artificial-intelligence difficulty distribution, first-turn completion, WebSocket health, reconnects, average turn duration by scenario, and Official Bot usage. This route is the application-supported alternative to pasting one-off queries for common health questions; raw database queries are still the better tool for deeper investigations.

## Orphan rooms and inactivity cleanup

The create route allocates a game room object immediately, even before a second player joins. If nobody ever connects, that room is effectively an orphaned private room. There is currently no public or operator endpoint that lists orphan room counts.

Every room touch refreshes the inactivity deadline to five minutes in the future. When the alarm reaches that deadline, the game room closes any sockets, marks the room archived, clears disconnect, turn-timeout, rematch, and Model Context Protocol session markers, and purges match-scoped event and checkpoint residue from Durable Object storage. If a game state exists at cleanup time, the alarm path also schedules the archival mirror to object storage and the archive table before local storage is scrubbed. Orphan rooms never appear in the public live-match listing; that surface only reports seated live matches.

Operationally, the two main signals to watch are create rows with an outcome of "created" that never produce a game-started or game-ended lifecycle event for the same room within a few minutes, and log lines mentioning inactivity timeout or game abandoned.

## Incident triage quickstart

Use a five-step triage loop.

First, confirm scope in the Workers logs: decide whether the problem is isolated to one room, one browser family, or many rooms at once.

Second, check the error classes in the database, looking for spikes in client errors, engine errors, and projection parity mismatches, both in total and split by hour.

Third, if engine errors or projection parity mismatches are rising, treat the issue as an authoritative-state or replay-integrity risk first. Check the recent deploy range and be prepared to disable or roll back a risky change.

Fourth, if client errors rise without matching server errors, suspect a browser or user-interface regression and split by user agent and recent client changes.

Fifth, if match completion looks wrong, inspect the archive metadata rows and then pull a concrete archived JSON sample.

The decision tree is straightforward: authority and replay issues first, then browser-specific client issues, then archive-shaping or completion issues.

## Starter alert thresholds

These are practical defaults until formal dashboards and alerts are added.

Any engine error in a fifteen-minute window should page the maintainer. Any projection parity mismatch in a fifteen-minute window should also page the maintainer and is high severity. Client errors should warn when the current fifteen-minute count is more than three times the normal baseline for the same weekday and hour. A spike in rate-limit rejections on the telemetry or error endpoints should trigger an abuse or noisy-client investigation and consideration of tighter global edge caps. Any Model Context Protocol observation timeout is abnormal and should be investigated immediately. More than two live-registry register or deregister failures in fifteen minutes mean the live-registry subsystem may be down and the matches listing may lag reality. A matchmaker pairing-split ratio above five percent sustained over an hour means the queue is hot enough to warrant coalesced allocation. A disconnect-grace-expired ratio above fifty percent over an hour means reconnect flow is failing for most players.

## Operational queries

The canonical operational queries live in the main observability document. The important point for this audio edition is the purpose of each query: one measures event volume by type, another summarizes match completions by scenario including average turns and duration, another summarizes Official Bot uptake and outcome, another tracks fallback accept and decline counts by day, another counts active unique clients, another measures scenario popularity from create events, another reports discovery-surface views, another captures the replay funnel of opens versus completions versus early exits, another measures replay abandonment by turn and progress, another reports replay speed usage, another summarizes disconnects and reconnects, another highlights the most common client errors, another reports lifecycle cadence, another computes disconnect-grace outcome ratios, another measures the matchmaker split rate and breakdown reasons, another tracks Model Context Protocol observation timeouts — expected to be zero — another catches live-registry failures, another reports turn-timeout rate per scenario and phase, and another dumps the rating-history audit trail for a given player key. Together they answer the core operational questions: what is hot, what is failing, what scenarios are active, and whether reconnect, replay, and rating behavior still look healthy.

## Workers log filters

The most useful searches in the Workers logs tab are "Engine error" for action failures, "Inactivity timeout" for room cleanup, "Rate limit exceeded" for WebSocket abuse, "projection parity mismatch" for replay integrity, the game-started and game-ended markers for per-match lifecycle trace, the matchmaker-pairing-split marker as an immediate smoke test when the matchmaker looks unhealthy, and the Model Context Protocol observation-timeout marker, where any hit is unexpected and the handler label in the properties should be inspected.

## Privacy stance

On the client side, the anonymous identifier is a random universally-unique identifier stored in local storage. Error reports may include URL, user agent, and arbitrary context, so that context should stay non-sensitive at call sites.

On the server side, the events table stores a salted hashed IP — not a raw IP — for client-originated rows; production fails closed when the salt secret is missing. Chat text is not written to the events table by default and stays in-game only. Rate limits are now described as "per salted hashed IP" for the read-path throttles. User-facing policy copy is out of scope here; align any public privacy text with this behavior.

## Gaps and follow-ups

There are still no first-class dashboards or automated alerting built into the repository. Today the main operational tools are Cloudflare's own logging and database tooling plus the documented operational queries and the internal metrics endpoint. Canonical rate-limit numbers live in the security document, and an optional cross-edge web application firewall can be added if distributed abuse is observed. Events rows older than thirty days are deleted daily by a purge task scheduled via the Worker cron; the same cron also purges match-archive rows and their object-storage entries older than one hundred eighty days. Other tables — player and match-rating — have no automatic retention window. The rating-history columns are intentionally kept as an audit and history trail for future player-profile charts, administrator anti-cheat review, and balance analysis; they are not dead schema just because the current public app does not read them yet. Sampling or caps can be added before server-side inserts if volume grows.
