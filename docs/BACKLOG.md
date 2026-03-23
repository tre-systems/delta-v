# Delta-V Backlog

Remaining work only. Completed items are in git history.

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
