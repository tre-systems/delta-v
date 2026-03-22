# Delta-V Backlog

Remaining work only. Completed items are in git history.

This backlog is ordered by architectural priority for the
next phase. Replay and spectator tests are part of each
item's definition of done and should land with the
feature, not as a cleanup pass afterward.

---

## Reliability & Simplification

### Reconnect seat reclamation without socket races

Allow a valid stored player token to reclaim its seat
even when the old WebSocket has not closed yet.

Today seat assignment treats a still-open socket as a
hard blocker, which makes refresh / reconnect flows race
the old connection teardown and reject valid tokens.
Seat reclamation should be keyed off player identity,
with duplicate sockets replaced only after the reclaim
decision is accepted.

Definition of done: reconnect tests cover refresh while
the old socket is still open, reconnect during the
disconnect grace window, and rejection of truly invalid
tokens without regressing duplicate-socket cleanup.

**Files:** `src/server/protocol.ts`,
`src/server/game-do/game-do.ts`,
`src/server/protocol.test.ts`,
`src/server/game-do/game-do.test.ts`

### Robust astrogation timeout auto-advance

Make turn-timeout astrogation orders derive from the
same "orderable ship" rules as the normal engine path.

The timeout helper should not synthesize no-op orders
for destroyed, captured, or otherwise non-orderable
ships, or it can fail to advance the match in damaged
late-game states.

Definition of done: timeout tests cover destroyed ships,
captured ships, emplaced bases, and mixed-fleet cases
without returning `null` for otherwise recoverable
turns.

**Files:** `src/server/game-do/turns.ts`,
`src/shared/engine/astrogation.ts`,
`src/shared/engine/util.ts`,
`src/server/game-do/turns.test.ts`

### Deterministic client phase-entry state application

Apply planning resets and default ship selection before
deriving HUD state on client phase entry.

Right now phase-entry effects can compute HUD state from
stale planning data, which risks showing outdated burn,
selection, and ordnance controls until another
interaction forces a refresh.

Definition of done: state-transition tests assert the
ordering of planning reset, selection, and HUD refresh
for astrogation, ordnance, and combat entry.

**Files:** `src/client/game/state-transition.ts`,
`src/client/game/helpers.ts`,
`src/client/game/state-transition.test.ts`,
`src/client/game/helpers.test.ts`

### Decide whether invite tokens stay or go

Either finish the invite-token flow end to end or remove
the dormant abstraction.

The codebase still carries invite-token storage and seat
assignment logic, but the create flow currently issues
only the creator token. Keeping an incomplete branch of
join semantics increases protocol and session complexity
without current product value.

Definition of done: the chosen direction is reflected in
worker create responses, client session helpers, join
validation, and docs, with no dead invite-token path
left behind.

**Files:** `src/server/index.ts`,
`src/server/protocol.ts`,
`src/client/game/session.ts`,
`README.md`, `docs/ARCHITECTURE.md`

### Consolidate engine-result adaptation

Reduce the number of places that translate shared engine
results into client-local resolutions and server
broadcast messages.

Movement / state-update / combat result adaptation is
currently spread across the local transport path, the
local resolution helpers, timeout helpers, and Durable
Object message construction. A thinner shared adapter
layer would reduce drift between local play, multiplayer,
and timeout automation.

Definition of done: local play, timeout automation, and
server broadcasts all use the same result-shape
classification helpers, and duplicate result branching is
removed from the coordinator modules.

**Files:** `src/client/game/local.ts`,
`src/client/game/transport.ts`,
`src/server/game-do/messages.ts`,
`src/server/game-do/turns.ts`,
`src/server/game-do/game-do.ts`

### Imperative-shell coverage and smoke tests

Add targeted tests around the runtime shells that still
carry most of the coordination risk.

The shared engine is well-covered; the main remaining
blind spots are reconnect flow, `GameClient` bootstrap
and phase entry, renderer / UI coordination, and Durable
Object orchestration.

Definition of done: targeted tests or smoke harnesses
cover reconnect, phase-entry HUD refresh, timeout
automation, and one end-to-end multiplayer happy path,
with coverage improving on `main.ts`, `ui.ts`,
`renderer.ts`, and `game-do.ts`.

**Files:** `src/client/main.ts`,
`src/client/ui/ui.ts`,
`src/client/renderer/renderer.ts`,
`src/server/game-do/game-do.ts`, related tests

---

## Architecture & Platform

### Event-sourced match persistence

The engine already emits granular `EngineEvent[]` (22
types) from all entry points, and the server stores
them in an event log. The next step is making the event
stream authoritative: versioned event envelopes with
`gameId`, sequence number, actor identity, and
timestamp. Snapshots become checkpoints, not the source
of truth.

Definition of done: rematches create isolated streams,
append ordering is enforced, duplicate / out-of-order
writes are rejected or ignored safely, and rebuild-from-
events tests exist for the covered flows.

**Files:** `src/shared/engine/engine-events.ts`,
`src/server/game-do/archive.ts`,
`src/server/game-do/game-do.ts`

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
`src/shared/engine/engine-events.ts`

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
`src/shared/engine/engine-events.ts`

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
