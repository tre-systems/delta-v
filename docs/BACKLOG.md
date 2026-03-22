# Delta-V Backlog

Remaining work only. Completed items are in git history.

This backlog is ordered by near-term delivery priority,
not by subsystem ownership. The immediate slice comes
first even when it crosses protocol, security, client,
and server boundaries. Replay and spectator tests are
part of each item's definition of done and should land
with the feature, not as a cleanup pass afterward.

---

## Review Follow-ups

### Persist inactivity deadlines safely across DO hibernation

`touchInactivity()` currently relies on an in-memory
deadline cache between periodic storage flushes. That
is unsafe for a hibernatable Durable Object because the
newest deadline can be lost while an older stored alarm
remains scheduled.

Definition of done: the inactivity timeout survives
hibernation without expiring early after recent
traffic, and tests cover alarm behavior when the
persisted deadline lags behind the last observed
message.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/session.ts`,
`src/server/game-do/game-do.test.ts`

### Record authoritative event actors explicitly

`publishStateChange()` currently envelopes engine
events using the post-transition `activePlayer`. That
breaks actor provenance for turn-ending commands and
system-driven actions such as disconnect forfeits and
turn timeouts.

Definition of done: player actions record the acting
seat, system actions record `null`, and tests cover
turn advance, timeout, and disconnect-forfeit paths.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/archive.ts`,
`src/server/game-do/archive.test.ts`,
`src/shared/engine/engine-events.ts`

### Make archived replays retrievable after room cleanup

Completed matches are copied to R2, but replay fetches
still read only Durable Object local storage. Once
inactivity cleanup runs, archived matches become
unreachable even though a persisted copy exists.

Definition of done: replay fetch falls back to the
archived store after local cleanup, auth still respects
player visibility, and tests cover current-match and
archived-match retrieval.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/match-archive.ts`,
`src/server/game-do/game-do.test.ts`,
`src/server/index.ts`

### Store match creation time independently from checkpoints

Match archive metadata currently derives `createdAt`
from the latest checkpoint timestamp. That drifts
forward over long matches and makes duration analytics
incorrect.

Definition of done: match creation time is written once
at match init, reused by archive export, and covered by
tests across rematches and long-running games.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/match-archive.ts`,
`src/server/game-do/match-archive.test.ts`

---

## Client Boundary Cleanup

### Continue shrinking `GameClient` into a composition root

Keep `main.ts` focused on bootstrap, ownership, and
wiring rather than growing a larger class-shaped
coordinator.

Lazy deps, presentation delegates, session HTTP calls,
token persistence, and the local transport factory have
been extracted to `action-deps.ts`, `session-api.ts`,
and `transport.ts`. `main.ts` is now ~600 LOC. The
remaining code is imports, constructor wiring, event
routing, and thin delegation — appropriate for a
composition root.

Further shrinking would target `handleMessage()` deps
building (~35 LOC), `handleUIEvent()` routing (~25 LOC),
or the game-flow orchestration cluster (~55 LOC), but
these are diminishing returns since they are genuine
composition root responsibilities.

**Files:** `src/client/main.ts`,
`src/client/game/`, `src/client/ui/ui.ts`

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
