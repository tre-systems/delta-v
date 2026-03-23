# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Release Readiness & Operability

### Production hardening defaults

The codebase now supports global create-rate limiting and
match archiving, but the checked-in deployment config
still treats both as optional comments. Before broader
user onboarding, make the production path opinionated:
configured rate limiting, persistent archive storage where
replay / support need it, and an explicit documented
fallback story for lower environments.

Definition of done: production deployment config enables
the intended hardening features by default, docs describe
which environments may run without them, and deploy-time
checks fail loudly when required bindings are missing.

**Files:** `wrangler.toml`,
`.github/workflows/ci.yml`,
`docs/SECURITY.md`,
`docs/ARCHITECTURE.md`

### Network integration load / chaos tester

Add the planned headless PvP bot stress harness for the
Durable Object and websocket layer.

This should validate room creation, live message flow,
disconnect / reconnect behavior, and server stability
under many concurrent matches without relying on manual
multi-tab testing.

Definition of done: a scripted load path can create many
games, drive valid turns over websockets, inject
disconnects, and report crash / timeout / reconnect
failures clearly enough to use before releases.

**Files:** `scripts/`, `src/server/index.ts`,
`src/server/game-do/`

---

## Performance & UX

### Mobile HUD Margins & Crowding

The in-game HUD is extremely tight on 375px viewports (standard mobile).
- **Issue**: Top bar text (Turn, Fuel, Objective) has almost zero margin and may overflow with long objectives.
- **Issue**: Ship status cards are flush against the left edge, potentially conflicting with device "safe areas" (notches/rounded corners).
- **Fix**: Add padding to the top bar and status cards; use a more resilient layout for long objective text.

**Files:** `static/style.css`, `src/client/ui/ui.ts`

### Logistics Phase "Quality of Life"

Triggering the Logistics phase (fuel transfer) is currently too difficult for average players.
- **Issue**: Requires exact hex and velocity matching, which is tedious to plot across multiple turns.
- **Improvement**: Add a "Match Velocity" or "Plot Intercept" helper to the astrogation UI when a friendly ship is nearby.

**Files:** `src/client/game/planning.ts`, `src/client/renderer/vectors.ts`

### OffscreenCanvas layer caching for renderer

Pre-render static visual layers (starfield, hex grid,
gravity indicators, planetary bodies) to offscreen
canvases and composite via `drawImage()` instead of
redrawing from scratch every frame.

The starfield data is already generated once in the
`Renderer` constructor, but the actual canvas draw calls
repeat every frame. The hex grid, gravity wells, and
celestial bodies are similarly static within a given
camera position. Caching these layers reduces per-frame
draw-call overhead, especially on lower-end devices.

Invalidate cached layers only on camera pan, zoom, or
window resize.

Definition of done: static layers render to offscreen
canvases, `drawImage()` composites them per frame, and
invalidation fires on camera or viewport changes. No
visible rendering regression.

**Files:** `src/client/renderer/renderer.ts`,
`src/client/renderer/scene.ts`

---

## Event-Sourced Match Architecture

### Event-sourced server migration

Done for authoritative server recovery:
- no separate Durable Object `gameState` snapshot slot
- authoritative recovery from persisted event stream plus optional checkpoints
- parity checks against event-sourced recovery
- replay and reconnect derived from the persisted event stream plus checkpoints

Remaining follow-up work:
- extend the same viewer model to spectator delivery

**Files:** `src/server/game-do/archive.ts`,
`src/server/game-do/game-do.ts`,
`src/shared/replay.ts`,
`src/shared/engine/`

### Protocol and replay contract fixtures

The runtime validation layer is strong, but the project
still relies mostly on unit tests rather than stable
golden fixtures for the wire contracts. Add representative
fixtures for create / join / replay responses, websocket
state-bearing messages, and replay timeline entries so
future protocol or event changes fail loudly when payload
shapes drift.

Definition of done: fixture-backed tests cover the main
`C2S`, `S2C`, and replay payloads, fixture updates are
intentional and reviewed, and hidden-information views are
covered for at least one asymmetric scenario.

**Files:** `src/shared/protocol.ts`,
`src/server/protocol.ts`,
`src/server/game-do/messages.ts`,
`src/shared/replay.ts`,
`src/shared/types/protocol.ts`

### Replace array-backed event storage with append-friendly match persistence

The current event stream is persisted as a single
`EventEnvelope[]` blob per match and rewritten on each
append. That keeps the model simple, but it makes long
matches and replay-heavy rooms pay full-history read /
write costs that do not scale with usage.

Refactor match persistence behind a small repository /
event-store boundary so appends, tail reads, checkpoints,
and replay projection are explicit operations rather than
ad hoc storage-key conventions. Favor chunked / paged
event storage or another append-friendly layout that
avoids rewriting the full stream for every turn.

Definition of done: authoritative event append no longer
rewrites whole-match history, replay / reconnect can read
from checkpoint plus tail efficiently, and tests cover
long-match recovery without depending on full-array
storage behavior.

**Files:** `src/server/game-do/archive.ts`,
`src/server/game-do/game-do.ts`,
`src/shared/engine/event-projector.ts`

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

---

## Client Boundary Cleanup

### Continue shrinking `GameClient` into a composition root

Keep `main.ts` focused on bootstrap, ownership, and
wiring rather than growing a larger class-shaped
coordinator.

Lazy deps, presentation delegates, session HTTP calls,
token persistence, local transport creation, and the
main dependency-bag builders have been extracted to
`action-deps.ts`, `session-api.ts`, `transport.ts`, and
`main-deps.ts`. `main.ts` is now mostly bootstrap,
constructor wiring, event routing, and thin
delegation.

Further shrinking should only happen where a real seam
exists. The remaining candidates are UI-event routing,
the local game-flow cluster, or other repeated
composition glue that can move out without turning the
composition root into indirection for its own sake.

**Files:** `src/client/main.ts`,
`src/client/game/`, `src/client/ui/ui.ts`

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
