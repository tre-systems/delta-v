# Privacy — technical summary (not legal advice)

This document describes current implementation behavior in this repository.
It does not replace a privacy policy, legal review, or jurisdiction-specific compliance advice.

## Scope

- Covers telemetry/error collection, server-side diagnostics, and match archive storage.
- Focuses on what is technically stored and where.
- Does not define legal basis, consent language, or user-facing policy wording.

## Client data flow

- **`anonId`**: random UUID stored in `localStorage` (`deltav_anon_id`) and attached to client reporting payloads (`src/client/telemetry.ts`).
- **`reportError()`** sends `error`, caller-supplied `context`, `url`, and `ua` fields.
- **`track(event, props)`** sends arbitrary event names/props.
- **Requirement at call sites**: do not put secrets, credentials, or direct personal data in telemetry/error props.

## Server-side storage behavior

- **`POST /telemetry` and `POST /error`** accept JSON payloads up to **4KB** (`src/server/index.ts`).
- Incoming client IP is transformed into `ip_hash` (SHA-256, truncated) before D1 insert; raw IP is not written by this path.
- Events are stored in D1 `events` with core columns (`ts`, `anon_id`, `event`, `props`, `ip_hash`, `ua`) defined in `migrations/0001_create_events.sql`.
- Durable Object diagnostic events (`engine_error`, `projection_parity_mismatch`) insert with `ip_hash = 'server'`; diagnostic payloads can include stack traces.

## Match and gameplay data

- Match metadata is stored in D1 `match_archive`; full completed match archives are stored in R2 as `matches/{gameId}.json`.
- Chat content is transmitted over WebSocket for live play and is not written to D1 by the default telemetry/error path.

## Operational note

- Access to logs, D1 query surfaces, and R2 archives should be restricted to trusted maintainers/operators.

## Further reading

- [SECURITY.md](./SECURITY.md) — abuse controls, endpoint hardening, XSS posture.
- [OBSERVABILITY.md](./OBSERVABILITY.md) — telemetry/event sources and incident queries.
- [SECURITY.md](./SECURITY.md#data-retention-d1-r2-do) — retention stance across D1, R2, and Durable Objects.
