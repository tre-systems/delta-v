# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Reliability & Architecture

### Seeded PRNG for server game logic

Server-side engine calls use `Math.random` for combat
dice, asteroid hazards, and ordnance detonation. This
prevents deterministic replay validation and server-side
simulation testing. Pass a seeded PRNG (or capture RNG
outputs in engine events) so matches can be
deterministically replayed.

**Files:** `src/server/game-do/game-do.ts`,
`src/shared/engine/astrogation.ts`,
`src/shared/engine/combat.ts`,
`src/shared/engine/ordnance.ts`

### Declarative DO handler table

The 11 `handle*` methods in `GameDO` all follow the same
`runGameStateAction → publishStateChange` pattern.
Replace with a declarative registration table mapping
message types to engine processors and broadcast
resolvers to reduce ~200 lines and enforce consistent
wiring.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/game-do.test.ts`

### Client composition-root lifecycle cleanup

Bring `GameClient` in line with the rest of the client
manager pattern by centralizing global listener binding
and teardown instead of leaving ad hoc browser listeners
attached in `main.ts`.

Definition of done: `GameClient` owns explicit teardown
for keyboard, tooltip, connectivity, and other global
listeners, and `main.ts` becomes a clearer composition
root rather than a second event-binding layer.

**Files:** `src/client/main.ts`,
`src/client/ui/ui.ts`,
`src/client/input.ts`

## Code Quality

### Typed engine error codes

Engine errors use `{ error: string }` with no error code
or enum. This prevents programmatic error handling on the
client. Add an `ErrorCode` enum and a structured
`EngineError` type.

**Files:** `src/shared/engine/`,
`src/shared/types/domain.ts`,
`src/server/game-do/game-do.ts`

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

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

---
