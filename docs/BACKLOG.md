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

### ~~Phase 0. Reliability fixes~~ *(done)*

- Persist authoritative game state before broadcasting.
- Intentional client disconnects bypass reconnect logic.
- Docs alignment (ongoing).

### ~~Phase 1. Client shell decomposition~~ *(done)*

`main.ts` reduced from ~1500 to ~1040 LOC. Extracted modules:
command routing (`game/command-router.ts`), UI event routing
(`game/ui-event-router.ts`), phase flow (`game/phase.ts`,
`game/phase-entry.ts`), phase telemetry
(`game/turn-telemetry.ts`). Coordination stays in the shell;
decision logic in pure `derive*` / `resolve*` helpers.

### ~~Phase 2. UI shell decomposition~~ *(done)*

`ui.ts` reduced from ~800 to ~590 LOC. Extracted modules:
button bindings (`ui/button-bindings.ts`), game log view
(`ui/game-log-view.ts`), fleet building view
(`ui/fleet-building-view.ts`), ship list view
(`ui/ship-list-view.ts`), overlay view
(`ui/overlay-view.ts`). Declarative button registry replaces
repeated wiring.

### Reactive signals note

`src/client/reactive.ts` is a standalone signals library
(signal, computed, effect, batch, DOM helpers) with 26 tests
including property-based coverage. Known limitations:

- Nested effects created inside an outer effect are not
  auto-disposed when the outer re-runs.
- `computed()` has no dispose — its internal effect stays
  permanently subscribed.
- Diamond dependencies can emit glitchy intermediate states
  outside of `batch()`.

These are acceptable for the current standalone/experimental
scope. Address lifecycle gaps before wiring into core UI
state (PlanningState, HUD).

### ~~Phase 3. Shared model boundaries~~ *(done)*

Split `src/shared/types.ts` into `src/shared/types/` directory:
`domain.ts` (entities, actions, map, combat, movement),
`protocol.ts` (C2S/S2C), `scenario.ts` (ScenarioDefinition,
ScenarioPlayer). Barrel `index.ts` preserves all existing
import paths.

### ~~Phase 4. Rules consolidation~~ *(done)*

Centralized ordnance launch rules into shared helpers in
`engine/util.ts`: `validateShipOrdnanceLaunch` (per-ship
per-type eligibility) and `canLaunchOrdnance` (quick boolean
filter). Client `ordnance.ts` and engine `game-engine.ts`
both use the shared helpers. Fixes: client now correctly
allows orbital bases to launch at D1 damage and includes
orbital base exception in torpedo rules.

### Phase 5. Stronger entity state models

- Replace growing optional-flag bags on entities with clearer
  status/capability models where invalid combinations are harder
  to represent.
- Do this incrementally, starting with the most heavily used
  shapes such as `Ship`.

### Delivery order

1. ~~Reliability fixes.~~
2. ~~`main.ts` coordinator extraction.~~
3. ~~`ui.ts` view extraction.~~
4. ~~Shared type/module split.~~
5. ~~Rules consolidation.~~
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
