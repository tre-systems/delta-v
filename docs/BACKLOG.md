# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Gameplay & Content

### Passenger rescue mechanics

Add passenger-specific transfer / rescue rules for
rescue scenarios.

Fuel and cargo transfer are already implemented; the
remaining work is passenger state, rescue objectives,
and the related UI / log presentation.

**Files:** `src/shared/engine/logistics.ts`,
`src/shared/engine/victory.ts`, `src/shared/types/`,
`src/client/game/logistics-ui.ts`,
`src/client/ui/game-log-view.ts`

### Spectator mode — client UI and live stream

Server-side spectator transport is complete: viewer-
aware filtering, spectator replay delivery, spectator-
tagged broadcasts, and WebSocket boundary enforcement
are all wired and tested. Live spectator WebSocket
joins are explicitly rejected (501) for now.

Remaining work is client-side: a spectator join flow,
real-time spectator state display during live games,
and the protocol extension to accept live spectator
WebSocket connections.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/protocol.ts`,
`src/client/game/client-kernel.ts`, client spectator UI

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

---

## Security & abuse hardening

These items complement [SECURITY.md](./SECURITY.md). None of them block the current friendly-match product model; prioritize if traffic is public, adversarial, or unexpectedly expensive.

### Rate-limit reporting endpoints (`/telemetry`, `/error`)

`POST /telemetry` and `POST /error` accept small JSON bodies (4KB cap) and write to D1 via `waitUntil`, but there is **no application-level per-IP rate limit**. A distributed client could inflate D1 rows and Worker CPU.

**Mitigations (pick one or combine):** Cloudflare WAF or rate-limiting rules on those paths; a Workers rate-limit binding keyed on hashed IP (same pattern as `CREATE_RATE_LIMITER`); or sampling / caps in `src/server/index.ts` before `insertEvent`.

**Files:** `src/server/index.ts`, `wrangler.toml`, Cloudflare dashboard

### Optional Turnstile on `POST /create`

Bot-driven room creation can spin many Durable Objects and archive writes. Turnstile validation on `/create` is described in [SECURITY.md](./SECURITY.md).

**Files:** client create-game UI, `src/server/index.ts` (`handleCreate`), Turnstile siteverify call

### Optional throttle on `GET /join/:code` and `GET /replay/:code`

Unauthenticated HTTP probes can wake DOs and run replay projection without joining. Add edge or app limits if metrics show abuse or material cost.

**Files:** `src/server/index.ts`, optional `[[ratelimits]]` or WAF rules

### Public matchmaking prep (longer room identifiers)

If the product moves beyond shared short codes, implement longer opaque IDs or signed invites (see [SECURITY.md](./SECURITY.md) competitive risks).

**Files:** `src/server/protocol.ts`, client lobby/join UX, any link/share format

---
