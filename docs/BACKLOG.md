# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Event-Sourced Match Architecture

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
