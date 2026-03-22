# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Gameplay & Content

### Post-game turn replay UI

Let players step backward and forward through recorded
turn history after game end using the existing replay
archive foundation. Reuse the current presentation
pipeline where practical rather than building a second
renderer stack.

Initial scope: previous/next, jump to start/end, replay
timeline labels, and exit back to the finished-match
screen. Defer in-live-match scrubbing until the
post-game flow is stable.

**Files:** `src/client/main.ts`,
`src/client/game/`, `src/client/ui/overlay-view.ts`,
`src/client/ui/ui.ts`

### Spectator mode

Allow read-only third-party connections that receive
live state broadcasts and replay/catch-up history but
cannot submit actions, occupy seats, or affect
disconnect-forfeit logic.

Default spectator visibility should be public-state
only. Hidden-information scenarios must not leak
player-private data to spectators unless an explicit
omniscient/debug mode is added later.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/protocol.ts`,
`src/shared/types/protocol.ts`,
`src/shared/engine/game-engine.ts`,
`src/client/main.ts`, client spectator UI

### Viewer-aware state filtering

Replace the current player-only hidden-information
filter with a viewer-aware model that supports player 0,
player 1, and spectator/public views.

Filtering rules should apply consistently to live
broadcasts, replay history, and catch-up payloads so
future hidden data does not leak through alternate
delivery paths.

**Files:** `src/shared/engine/game-engine.ts`,
`src/server/game-do/game-do.ts`,
`src/server/game-do/messages.ts`

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

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

---

## Operations & Performance

### Replay retention and archive storage

Decide how long replay history should live and where it
should be stored.

For short-lived replay while a room remains active,
Durable Object storage is sufficient. For persistent
replay links that outlive room inactivity cleanup,
archive completed matches to R2 and keep only lightweight
metadata in D1 or room storage.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/index.ts`, deployment/storage config

### Replay and spectator integration tests

Add integration coverage for replay history ordering,
rematch isolation, spectator join/auth, viewer-aware
filtering in hidden-information scenarios, and client
replay stepping controls.

This work should land alongside implementation rather
than as a cleanup pass afterward, since replay and
spectator bugs are mostly lifecycle bugs at the
server/client boundary.

**Files:** `src/server/game-do/*.test.ts`,
`src/server/index.test.ts`,
`src/client/game/*.test.ts`,
`src/client/ui/*.test.ts`

---

## Security & Abuse Prevention

### Globalize room creation rate limiting

`/create` throttling now exists in worker code and can
optionally call a configured rate-limit binding, but
production-grade global enforcement still depends on
deployment-side Cloudflare configuration.

If this endpoint needs stronger abuse resistance in
production, move the control to a Cloudflare WAF or
other edge-global rate limiting rule so enforcement is
not dependent on worker instance locality, fallback
behavior, or process lifetime.

**Files:** deployment / Cloudflare config,
`src/server/index.ts`, `wrangler.toml`
