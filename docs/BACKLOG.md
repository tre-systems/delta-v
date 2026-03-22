# Delta-V Backlog

Remaining work only. Completed items are in git history.

This backlog is ordered by architectural priority for the
next phase. Replay and spectator tests are part of each
item's definition of done and should land with the
feature, not as a cleanup pass afterward.

---

## Architecture & Platform

### Event-sourced match log foundation

Adopt an append-only authoritative event stream per
match. Each validated command should append a versioned
event envelope with `gameId`, sequence number, actor
identity, correlation id, turn / phase context, and a
timestamp.

The current snapshot persistence and replay archive
should be treated as transitional compatibility layers
until projectors and checkpoints are in place.

Definition of done: rematches create isolated streams,
append ordering is enforced, duplicate / out-of-order
writes are rejected or ignored safely, and rebuild-from-
events tests exist for the covered flows.

**Files:** `src/shared/events.ts`,
`src/shared/types/`, `src/server/game-do/game-do.ts`,
`src/server/game-do/messages.ts`,
`src/server/protocol.ts`

### Explicit RNG outcome capture

Persist authoritative random outcomes inside the event
stream so replay and rebuild do not depend on rerunning
`Math.random()` against future code.

Combat rolls, heroism, asteroid hazards, reinforcement
draws, and any other non-deterministic results should be
recorded as facts in the emitted events.

Definition of done: replay from events reproduces live
resolution for the covered movement, ordnance, and
combat flows.

**Files:** `src/shared/combat.ts`,
`src/shared/movement.ts`,
`src/shared/engine/combat.ts`,
`src/shared/engine/ordnance.ts`,
`src/shared/events.ts`

### Projection and checkpoint model

Define how read models are built from the event stream:
the authoritative `GameState` projection, player views,
spectator / public views, and reconnect / replay
checkpoints.

Snapshots become checkpoints and cache, not the source
of truth. Decide checkpoint cadence, replay rebuild
strategy, and parity expectations between incremental
projection and full rebuild.

Definition of done: rebuild tests compare live state
with checkpoint-plus-tail replay and full replay from
event zero.

**Files:** `src/shared/engine/game-engine.ts`,
`src/server/game-do/game-do.ts`,
`src/server/game-do/messages.ts`,
`src/shared/events.ts`

### Viewer-aware state filtering

Replace the current player-only hidden-information
filter with a viewer-aware model that supports player 0,
player 1, and spectator / public views.

Filtering rules must apply consistently to live
broadcasts, replay responses, catch-up payloads, and any
derived projection export so hidden data cannot leak
through an alternate path.

Definition of done: hidden-information tests cover live
play, replay fetches, and spectator joins.

**Files:** `src/shared/engine/game-engine.ts`,
`src/server/game-do/game-do.ts`,
`src/server/game-do/messages.ts`

### Post-game turn replay UI

Let players step backward and forward through recorded
turn history after game end using the new event /
projection history rather than a bespoke renderer path.

Initial scope: previous / next, jump to start / end,
timeline labels, exit back to the finished-match
screen, and explicit `gameId` selection when a room has
multiple completed matches.

Definition of done: client tests cover stepping
controls, rematch selection, and exit back to the
finished-match screen rather than assuming "latest
match" implicitly.

**Files:** `src/client/main.ts`,
`src/client/game/`, `src/client/ui/overlay-view.ts`,
`src/client/ui/ui.ts`

### Spectator mode

Allow read-only third-party connections backed by
public / spectator projections. Spectators may receive
live state broadcasts and replay / catch-up history but
cannot submit actions, occupy seats, or affect
disconnect-forfeit logic.

This depends on viewer-aware filtering and projection
catch-up being correct first. Default spectator
visibility should be public-state only unless an
explicit omniscient debug mode is added later.

Definition of done: join / auth, live updates, replay /
catch-up, and no-action enforcement are all covered by
integration tests.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/protocol.ts`,
`src/shared/types/protocol.ts`,
`src/shared/engine/game-engine.ts`,
`src/client/main.ts`, client spectator UI

### Replay retention and archive storage

Once event streams and checkpoints exist, decide how
long raw events, checkpoints, and derived replay payloads
should live and where they should be stored.

For short-lived replay while a room remains active,
Durable Object storage may be sufficient. For
persistent replay links that outlive room inactivity
cleanup, archive completed matches to R2 and keep only
lightweight metadata in D1 or room storage.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/index.ts`, deployment / storage config

---

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

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

---

## Security & Abuse Prevention

### Verify and document global room creation rate limiting

`/create` throttling is implemented in worker code and
supports an optional Cloudflare rate-limit binding.
What remains is to confirm the production deployment is
actually backed by edge-global Cloudflare enforcement
and to document that setup alongside the worker config.

If a Cloudflare WAF or rate-limit rule is already in
place outside this repo, remove this item after adding
the relevant deployment notes. If not, provision that
rule so enforcement is not dependent on worker instance
locality, fallback behavior, or process lifetime.

**Files:** deployment / Cloudflare config,
`docs/SECURITY.md`, `src/server/index.ts`,
`wrangler.toml`
