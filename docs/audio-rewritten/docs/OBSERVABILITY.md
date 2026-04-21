# Observability

This chapter explains what Delta-V emits today and how to use those signals during incidents, tuning passes, and runtime diagnosis.

## Sources

There are six main observability sources.

First, Worker and Durable Object logs capture console output and error output from the main Worker entrypoint, the game room object, the matchmaker, and related handlers.

Second, the D1 events table stores client telemetry, client error reports, and server-side lifecycle or failure rows.

Third, the D1 match-archive table stores one metadata row per completed match.

Fourth, the D1 player and match-rating tables store leaderboard identity and rating history.

Fifth, the R2 match archive bucket stores one full JSON record per completed match.

Sixth, the browser itself emits telemetry and error reports to the server through the telemetry and error endpoints.

In practical terms, the flow is simple: browser signals and server-side events both feed D1 and Workers Logs, while completed-match archival also feeds the D1 archive index and the R2 JSON store.

## Events table

The events table stores a timestamp, an anonymous identifier, an event name, a JSON properties blob, a hashed client IP or the literal word server for server-originated rows, a user-agent string, and a creation timestamp.

On the client side, the table records room creation attempts and failures, join attempts and outcomes, quick-match flow, spectator joins, reconnect scheduling and outcomes, replay fetch success and failure, leaderboard and match-list views, replay engagement signals, game-over summaries, server errors surfaced to the client, rejected actions, WebSocket parse and validation failures, WebSocket close metadata, turn timing, tutorial and scenario browsing events, and local AI game starts.

On the client-error side, the table records browser errors and unhandled rejections together with URL, user-agent, and basic context.

On the server side, the telemetry module records engine errors, projection parity mismatches, and game-abandoned events.

## Server lifecycle and side-channel events

The server also emits a second class of observability signals that are easier to think of as lifecycle markers and side-channel failures.

Lifecycle events include game started, game ended, disconnect grace started, disconnect grace resolved, disconnect grace expired, turn timeout fired, matchmaker paired, and rating outcomes such as rating applied, skipped, or failed.

Side-channel failures include live-registry register or deregister failures, Model Context Protocol observation timeouts, matchmaker pairing splits, and Durable Object code-update eviction signals.

The useful mental model is this: normal room progress and cleanup emit lifecycle events; anything that suggests the authoritative flow worked but an auxiliary subsystem did not emits a side-channel failure.

## Orphan rooms and inactivity cleanup

The create route allocates a game room object immediately, even before a second player joins. If nobody ever connects, that room is effectively an orphaned private room.

Cleanup is driven by the inactivity timer. Any room activity refreshes the inactivity deadline to five minutes in the future. When the alarm reaches that deadline, the game room closes sockets, marks the room archived, clears reconnect and timeout markers, purges match-scoped checkpoint and event residue from Durable Object storage, and, if a game state exists, schedules archival to D1 and R2 before local cleanup completes.

Orphan rooms never appear in the public live-match listing. Operationally, the two main signals to watch are successful create requests that never produce game-start or game-end lifecycle rows, and log lines mentioning inactivity timeout or game abandoned.

## Incident triage quickstart

Use a five-step triage loop.

First, confirm scope in Workers Logs. Decide whether the problem is isolated to one room, one browser family, or many rooms at once.

Second, check the error classes in D1. In practice this means looking for spikes in client errors, engine errors, and projection parity mismatches.

Third, if engine errors or projection parity mismatches are rising, treat the issue as an authoritative-state or replay-integrity risk first. Check the recent deploy range and be prepared to disable or roll back a risky change.

Fourth, if client errors rise without matching server errors, suspect a browser or UI regression and split by user-agent and recent client changes.

Fifth, if match completion looks wrong, inspect the match-archive metadata and then pull a concrete archived JSON sample from R2.

The decision tree is straightforward: authority and replay issues first, then browser-specific client issues, then archive-shaping or completion issues.

## Starter alert thresholds

Until a fuller dashboard exists, the practical default thresholds are:

Any engine error in a fifteen-minute window should page the maintainer.

Any projection parity mismatch in a fifteen-minute window should also page the maintainer and is high severity.

Client errors should warn when the current fifteen-minute count is more than three times the normal baseline for the same weekday and hour.

A spike in four-twenty-nine responses on the telemetry or error endpoints should trigger an abuse or noisy-client investigation.

Any Model Context Protocol observation timeout is abnormal and should be investigated immediately.

Repeated live-registry register or deregister failures mean the public live listing may be inaccurate.

A high pairing-split ratio means the matchmaker queue is under contention.

A high disconnect-grace-expired ratio means reconnect flow is failing for a meaningful share of users.

## Operational queries

The canonical operational queries still live in the main observability document. The important point for this audio edition is the purpose of each query:

one query measures event volume by type,
another summarizes match completions by scenario,
another counts active unique clients,
another measures scenario popularity,
another tracks replay engagement,
another summarizes reconnect and disconnect issues,
and another highlights the most common client errors.

Together they answer the core operational questions: what is hot, what is failing, what scenarios are active, and whether reconnect and replay behavior still look healthy.

## Workers log filters

The most useful Workers Logs searches are the engine-error marker, inactivity-timeout messages, projection parity mismatch, game started, game ended, matchmaker pairing split, and Model Context Protocol observation timeout.

Those filters let you move quickly from a vague player report to a concrete cluster of relevant log lines.

## Privacy stance

The browser stores a locally generated anonymous identifier. Error reports can include URL, user-agent, and limited caller-supplied context, so that context should stay non-sensitive.

On the server side, the events table stores hashed client IPs rather than raw IPs for client-originated rows. Chat content is not written into the events table by default.

## Gaps and follow-ups

There are still no first-class dashboards or automated alerting built into the repository. Today the main operational tools are Cloudflare's own logging and database tooling plus the documented D1 queries.

If volume grows significantly, sampling or caps can be added before server-side inserts. If abuse grows, the security layer provides the next escalation path.
