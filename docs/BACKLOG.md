# Delta-V Backlog

Remaining work only. Completed items are in git history.

This backlog is ordered by near-term delivery priority,
not by subsystem ownership. The immediate slice comes
first even when it crosses protocol, security, client,
and server boundaries. Replay and spectator tests are
part of each item's definition of done and should land
with the feature, not as a cleanup pass afterward.

---

## Immediate Priorities

### Split `GameClient` orchestration out of `main.ts`

Reduce the number of concerns that still terminate in the
top-level client shell.

`main.ts` currently coordinates session lifecycle, transport
setup, message handling, local-AI flow, input routing, and HUD
refresh from one class. The extracted helper modules are moving
in the right direction, but new features still tend to thread
through the same large coordinator.

Definition of done: `main.ts` keeps bootstrap and composition-
root responsibilities, while session flow, message orchestration,
and HUD / renderer coordination are pushed behind smaller
controller modules with clear ownership and focused tests.

**Files:** `src/client/main.ts`,
`src/client/game/message-handler.ts`,
`src/client/game/session-controller.ts`,
`src/client/game/phase-controller.ts`,
new or extracted client controller module(s)

### Split `GameDO` coordination responsibilities

Break the Durable Object shell into narrower units before more
reconnect, replay, spectator, or public-lobby features pile onto
the same class.

`GameDO` currently owns HTTP routing, websocket lifecycle,
reconnect / seat assignment, alarm scheduling, persistence,
replay export, and engine-result publication. That is workable,
but it makes each new server-side feature more coupled than it
needs to be.

Definition of done: `GameDO` remains the composition point for
Cloudflare runtime hooks, but join / session policy, turn-timeout
handling, and state-publication / replay adaptation live behind
smaller helpers or modules with direct tests.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/session.ts`,
`src/server/game-do/turns.ts`,
`src/server/game-do/messages.ts`,
`src/server/protocol.ts`

### Unify local and networked game-flow orchestration

Reduce parity drift between AI/local execution and multiplayer
execution by converging on a smaller set of shared client-side
action / result handling paths.

The shared engine already prevents the worst rule divergence, but
client flow still branches between local execution and server-
driven execution in ways that make phase, presentation, and
session changes harder to evolve.

Definition of done: at least one phase-flow slice shares the same
client-side action/result orchestration between local and remote
play, and targeted parity tests cover local versus networked
behavior for the covered flow.

**Files:** `src/client/game/local.ts`,
`src/client/game/local-game-flow.ts`,
`src/client/game/message-handler.ts`,
`src/client/game/session-controller.ts`,
`src/client/main.ts`

### Reduce UI binding boilerplate

Trim the repetitive event-binding and pass-through wiring in
the imperative UI layer without introducing a heavyweight UI
framework.

The current view classes are functional, but they still pay
too much ceremony for `addEventListener` / cleanup pairs,
simple button forwarding, and repetitive disposal-scoped
handler setup. A small local helper layer should reduce that
cost while preserving explicit ownership.

Definition of done: UI views use a shared disposal-aware
event-binding helper (or equivalent local utility) for the
common add/remove-listener pattern, and the affected classes
become materially shorter or simpler without hiding control
flow.

**Files:** `src/client/ui/ui.ts`,
`src/client/ui/lobby-view.ts`,
`src/client/ui/fleet-building-view.ts`,
`src/client/ui/hud-chrome-view.ts`,
shared UI helper module(s)

### Narrow the `UIManager` surface

Reduce pass-through verbosity in `UIManager` so it remains a
coordinator, not a large forwarding facade.

`UIManager` currently owns the right boundaries, but it still
contains many thin methods that simply relay calls into
subviews. The next step is to group or collapse those
operations around clearer screen/view-model boundaries rather
than one-method-per-button/per-label style forwarding.

Definition of done: `UIManager` exposes a smaller, more
coherent API grouped around screen mode and major UI domains,
with no regression in ownership clarity or testability.

**Files:** `src/client/ui/ui.ts`,
`src/client/main.ts`,
affected UI subviews and tests

### Reduce repetitive UI collection rendering

Introduce a clearer pattern for list-like UI rendering where
the current code repeatedly clears DOM, rebuilds nodes, and
attaches fresh handlers.

This is most obvious in fleet-building and ship-list style
views. Even if the rendering remains imperative, a small
keyed render helper or view-model-to-DOM utility would make
the code easier to read and less error-prone.

Definition of done: at least one collection-heavy view uses
a shared rendering helper or extracted pattern for keyed or
structured item rendering, and that pattern is documented as
the preferred approach for similar UI lists.

**Files:** `src/client/ui/fleet-building-view.ts`,
`src/client/ui/ship-list-view.ts`,
shared UI helper module(s),
`docs/CODING_STANDARDS.md`

### Protocol contract fixtures and replay goldens

Freeze representative wire-level examples for validated
client messages, server responses, and replay payloads
before the event-sourced migration expands those contracts.

The runtime validators are explicit and well-tested, but the
project still leans more on behavioral tests than on durable
fixture-style contract coverage. A small corpus of canonical
payloads would make protocol and replay changes safer and more
reviewable.

Definition of done: fixture-based tests cover key C2S message
shapes, state-bearing S2C responses, and replay archive payloads,
with golden updates treated as explicit contract changes rather
than incidental test fallout.

**Files:** `src/shared/protocol.ts`,
`src/shared/protocol.test.ts`,
`src/shared/replay.ts`,
`src/server/game-do/messages.ts`,
related replay / protocol fixture tests

---

## Event-Sourced Match Architecture

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
