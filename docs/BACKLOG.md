# Delta-V Backlog

Remaining work only. Completed items are in git history.

This backlog is ordered by near-term delivery priority,
not by subsystem ownership. The immediate slice comes
first even when it crosses protocol, security, client,
and server boundaries. Replay and spectator tests are
part of each item's definition of done and should land
with the feature, not as a cleanup pass afterward.

---

## Client Boundary Cleanup

### Continue shrinking `GameClient` into a composition root

Keep `main.ts` focused on bootstrap, ownership, and
wiring rather than growing a larger class-shaped
coordinator.

`GameClient` still owns runtime context, controller
wiring, lazy deps objects, presentation callbacks, and
several user-flow branches. Replacing the class with a
closure today would mostly move the same responsibilities
into a giant factory; the real work is extracting more
focused client controllers first.

Near-term slice: continue pushing session flow,
local/network resolution handling, HUD/logistics UI
coordination, and other side-effect clusters behind
focused modules so the remaining shell owns lifecycle
and composition only.

Definition of done: `main.ts` is smaller, newly
extracted modules have focused tests, and the remaining
top-level shell could stay a class or later become a
factory without another large semantic rewrite.

**Files:** `src/client/main.ts`,
`src/client/game/`, `src/client/ui/ui.ts`,
new or extracted client controller module(s)

### Convert optional client view/helper classes to factory managers

Reduce stylistic class usage where instance inheritance
or platform lifecycle is not required.

Several smaller DOM/helper modules currently use classes
mainly as method bags around private state: overlay,
lobby, fleet-building, ship-list, tutorial, and turn
telemetry. These are better aligned with the existing
`createXxx(deps): XxxManager` pattern used elsewhere in
the client.

Near-term slice: convert one coherent slice of these
modules to factory managers with explicit `dispose()`
ownership and stable public interfaces, then use that
pattern for new similar code.

Definition of done: the covered modules export
`createXxx()` factories instead of classes, `UIManager`
consumes them through narrow interfaces, and tests cover
lifecycle/disposal behavior for the converted slice.

**Files:** `src/client/ui/overlay-view.ts`,
`src/client/ui/lobby-view.ts`,
`src/client/ui/fleet-building-view.ts`,
`src/client/ui/ship-list-view.ts`,
`src/client/tutorial.ts`,
`src/client/game/turn-telemetry.ts`,
`src/client/ui/ui.ts`

### Decompose renderer/input state before any class-to-factory rewrite

Treat `Renderer`, `Camera`, and `InputHandler` as
acceptable imperative shells for now, but keep pressure
on internal decomposition.

These modules own canvas state, camera interpolation,
DOM event listeners, animation timers, and per-frame
mutable caches. They are the strongest current case for
classes, but their size still creates review and testing
friction.

Near-term slice: extract more pure scene/view builders
and small stateful helpers around animation, caching,
overlays, and pointer interpretation before
reconsidering whether the outer shells should remain
classes.

Definition of done: `renderer.ts` and `input.ts` shrink
through focused extractions, new helper seams have
targeted tests, and any future class removal would be
optional cleanup rather than a blocker for
maintainability.

**Files:** `src/client/renderer/renderer.ts`,
`src/client/renderer/camera.ts`,
`src/client/input.ts`,
`src/client/renderer/`

---

## Event-Sourced Match Architecture

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

## Performance & UX

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
