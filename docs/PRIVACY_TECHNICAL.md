# Privacy — technical summary (not legal advice)

This document **describes what the code does**. It does not replace a **privacy policy** or legal review.

## Client

- **`anonId`**: random UUID stored in `localStorage` (`deltav_anon_id`), sent with `/telemetry` and available for correlation in D1 (`src/client/telemetry.ts`).
- **`reportError`**: may include `url`, `userAgent`, and caller-supplied `context` — **avoid putting secrets or PII in context** at call sites.
- **`track(event, props)`**: arbitrary event names and props; keep props non-sensitive.

## Server

- **`POST /telemetry` and `POST /error`**: JSON max **4KB**; `ip_hash` = **SHA-256 truncated** of `cf-connecting-ip` (see `hashIp` in `src/server/index.ts`). Raw IP is not stored in D1 by this path.
- **DO telemetry rows** (`engine_error`, `projection_parity_mismatch`): `ip_hash` is the literal `'server'`; stack traces may appear in `props` — restrict log access accordingly.

## In-game

- **Chat** text is exchanged between players over WebSocket; not written to D1 in the default path. Treat as **player-generated content** for any future moderation or retention policy.

## Further reading

- [SECURITY.md](./SECURITY.md) — abuse, XSS, reporting endpoints.
- [OBSERVABILITY.md](./OBSERVABILITY.md) — D1 schema and queries.
- [SECURITY.md](./SECURITY.md#data-retention-d1-r2-do) — retention stance (D1, R2, DO).
