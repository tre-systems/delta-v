# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Reliability & Architecture

### Replay history integrity with checkpoints

Preserve full replay history even after checkpoints are
introduced for recovery. The current replay projection
path should not collapse earlier state transitions into
a single synthetic checkpoint entry once a later
checkpoint exists.

Definition of done: replay projection returns the same
historical sequence before and after checkpoint writes,
and tests cover multi-turn matches with at least one
mid-match checkpoint.

**Files:** `src/server/game-do/archive.ts`,
`src/server/game-do/archive.test.ts`,
`src/shared/engine/event-projector.ts`

### Spectator path completion

Finish the end-to-end spectator transport path so the
public worker, Durable Object routing, and replay
endpoints all expose the spectator behavior that already
exists in lower layers.

Definition of done: spectator replay requests can flow
through the public worker, spectator websocket joins are
explicitly supported or explicitly rejected at the top
boundary, and integration tests cover the chosen
contract.

**Files:** `src/server/index.ts`,
`src/server/game-do/game-do.ts`,
`src/server/index.test.ts`,
`src/server/game-do/game-do.test.ts`

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

### Reactive DOM listener cleanup

Audit rerendered client views that bind event listeners
inside reactive effects and ensure listeners tied to
detached DOM nodes are cleaned up on each rerender, not
only on final view disposal.

Definition of done: list-style views can rerender
repeatedly without accumulating stale listener cleanup
callbacks, and tests cover at least one rerender-heavy
view.

**Files:** `src/client/reactive.ts`,
`src/client/dom.ts`,
`src/client/ui/ship-list-view.ts`,
`src/client/ui/fleet-building-view.ts`

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
