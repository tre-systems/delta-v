# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Open issues

#### 26. Minimap is not interactive

The minimap shows planet/ship positions but clicking it
doesn't pan the main camera. Click-to-navigate would solve
the "can't find my ship" problem.

---

## Maintenance and refactor plan

The project is in a good place mechanically. The next work
should focus on reducing shell complexity and tightening
authority boundaries rather than rewriting the engine.

### Phase 0. Reliability fixes

- Persist authoritative game state before broadcasting it to clients.
- Make intentional client disconnects bypass reconnect logic.
- Keep docs aligned with the current file layout and feature set.

### Phase 1. Client shell decomposition

- Split `src/client/main.ts` into a thin coordinator plus focused modules:
  command routing, UI event routing, phase flow, and client state storage.
- Keep coordination in the shell; keep decision logic in pure
  `derive*` / `resolve*` helpers.

### Phase 2. UI shell decomposition

- Break `src/client/ui/ui.ts` into focused menu, HUD, fleet,
  log, and overlay modules behind the existing `UIManager`
  facade.
- Replace repeated button wiring with a small declarative
  registry.

### Reactive experiment note

- `src/client/reactive.ts` should stay experimental until it has
  owner-scoped cleanup for nested effects, a disposal strategy for
  `computed()`, and clearer propagation semantics.
- Current review findings: nested effects leak subscriptions,
  `computed()` stays permanently hot, and shared-dependency updates
  can emit glitchy intermediate states.
- Do not make it a core UI pattern yet; reconsider after those
  lifecycle and scheduling gaps are closed with tests.

### Phase 3. Shared model boundaries

- Split `src/shared/types.ts` into separate domain, protocol,
  and scenario type modules.
- Reduce the number of unrelated changes that currently collide
  in a single cross-layer file.

### Phase 4. Rules consolidation

- Centralize scenario capability checks and ordnance launch
  legality so client helpers and engine validation do not
  encode the same rules in different places.
- Continue preferring extracted pure helpers over larger
  architectural moves.

### Phase 5. Stronger entity state models

- Replace growing optional-flag bags on entities with clearer
  status/capability models where invalid combinations are harder
  to represent.
- Do this incrementally, starting with the most heavily used
  shapes such as `Ship`.

### Delivery order

1. Reliability fixes with tests.
2. `main.ts` coordinator extraction.
3. `ui.ts` view extraction.
4. Shared type/module split.
5. Rules consolidation.
6. Optional stronger state-model refactors.

---

## Features

### Turn replay

Allow players to review past turns after a game ends (or during, stepping back through history).

### Spectator mode

Third-party WebSocket connections that receive state broadcasts but cannot submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat type), `src/server/protocol.ts`, client spectator UI

### New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics beyond what's currently implemented (rescue/passenger transfer, fleet mutiny trigger, advanced reinforcement waves).

### Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios. Extends the logistics phase with a new transfer type.
