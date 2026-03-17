# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

### Continue mobile HUD/layout polish
The HUD now measures its live top/bottom offsets instead of relying on fixed `rem` guesses, and the mobile top bar/action cluster have been tightened. There is still follow-up work to validate real-device behavior and finish any remaining overlap or clipping issues on very small screens.

**Files:** `static/style.css`, `src/client/ui/ui.ts`, `src/client/renderer/renderer.ts`

## P2 — Code Quality

### 20. Adopt utility helpers across the codebase
`src/shared/util.ts` provides functional collection helpers (`sumBy`, `minBy`, `maxBy`, `filterMap`, `compact`, `count`, `partition`, `indexBy`, `groupBy`, `cond`, etc.) and `src/client/dom.ts` provides declarative DOM helpers (`el`, `show`/`hide`/`visible`, `byId`). These are tested and documented in CODING_STANDARDS.md but not yet widely used. Sweep the codebase to replace manual reduce/loop/filter patterns with the util helpers, and replace verbose createElement/addEventListener chains with the DOM helpers.

**Benefit:** Reduces boilerplate, makes intent clearer, and establishes consistent patterns across the codebase.

**Files:** All files under `src/shared/` and `src/client/` — look for manual `reduce`, `for` loops building accumulators, `.filter().length`, `.map().filter(x => x != null)`, `document.createElement` chains, and `getElementById` with non-null assertions.

### 2a. Pull PlanningState out of the Renderer
`PlanningState` lives on the `Renderer` but is mutated by `InputHandler`, `main.ts`, and read by renderer sub-modules. Move ownership to `GameClient`. The renderer and input handler receive it as a read reference. Mutations go through existing helpers like `createClearedCombatPlan`.

**Benefit:** Eliminates the tightest coupling in the codebase — three systems reaching into the same mutable bag. Enables snapshotting for debugging/undo.

**Files:** `src/client/main.ts`, `src/client/renderer/renderer.ts`, `src/client/input.ts`

**Details:** See REFACTORING.md Priority 1.

### 2b. Transport adapter for local vs network play
9 `if (this.isLocalGame)` branches in `main.ts` duplicate logic. Define a `GameTransport` interface with `WebSocketTransport` and `LocalTransport` implementations.

**Benefit:** Eliminates all `isLocalGame` branching. Opens the door for replay playback and test harness transports.

**Files:** `src/client/main.ts`, new `src/client/game/transport.ts`

**Details:** See REFACTORING.md Priority 2.

### 2c. Command dispatch
Unify ~30 action-handler methods into a single `dispatch(cmd: GameCommand)` bottleneck. The existing `KeyboardAction` discriminated union maps almost directly to `GameCommand`.

**Benefit:** One place for logging, guard conditions, and input routing. Keyboard, UI, and input handler all produce the same command type.

**Files:** `src/client/main.ts`, `src/client/game/keyboard.ts`

**Details:** See REFACTORING.md Priority 3.

### 2d. Typed UI event bus
Replace `UIManager`'s ~15 nullable callback properties with a single typed `UIEvent` union and emitter. Events feed into the dispatch function from 2c.

**Benefit:** Makes the relationship between UI events and game actions visible and greppable.

**Files:** `src/client/ui/ui.ts`, `src/client/main.ts`

**Details:** See REFACTORING.md Priority 5.

### 2e. Async AI turn loop
Replace the recursive callback chain in `processAIPhases` with an explicit async loop. Animation callbacks resolve promises instead of recursing.

**Benefit:** AI turn becomes readable as a sequence, not a callback graph.

**Files:** `src/client/main.ts`, `src/client/game/ai-flow.ts`

**Details:** See REFACTORING.md Priority 7.

### 2f. Serialisation codec
Create `shared/codec.ts` with explicit serialise/deserialise functions for `GameState`. Add a round-trip test to catch new `Map`/`Set` fields.

**Benefit:** Prevents a class of bugs when adding new collection fields to game state.

**Files:** new `src/shared/codec.ts`

**Details:** See REFACTORING.md Priority 8.

## P3 — Test Coverage

### 3a. Improve branch coverage on engine/combat.ts
Currently 88.39% branches. Add tests for edge cases in combat phase validation (anti-nuke fire, split-fire edge cases, dreadnaught-when-disabled).

**Files:** `src/shared/engine/combat.ts`, `src/shared/engine/combat.test.ts`

### 3b. Improve AI test coverage
`ai.ts` is at 62.66% statements, 58.61% branches, 54.05% functions. Significant gaps in ordnance AI, combat target selection, and fleet-building decisions.

**Files:** `src/shared/ai.ts`, `src/shared/ai.test.ts`

### 3c. Improve victory.ts branch coverage
Currently 85.25% branches. Gaps around escape-edge detection, moral victory conditions, and checkpoint race completion.

**Files:** `src/shared/engine/victory.ts`, `src/shared/engine/victory.test.ts`

### 3d. Add movement.ts edge case tests
Currently 77% branches. Gaps around weak gravity consecutive rules, off-map elimination, and takeoff mechanics.

**Files:** `src/shared/movement.ts`, `src/shared/movement.test.ts`

### 3e. Add protocol validation tests
`server/protocol.ts` is at 46.77% branches. Add tests for malformed payloads, edge cases in fleet-ready validation, and ordnance launch validation.

**Files:** `src/server/protocol.ts`, `src/server/protocol.test.ts`

## Suggested Order of Work

The P2 items build on each other. Suggested sequencing:
1. **20** (Adopt utility helpers) — low-risk sweep that improves readability across the board
2. **2a** (PlanningState) — removes the tightest coupling, minimal disruption
2. **2b** (Transport) — eliminates isLocalGame branching, big main.ts shrink
3. **2c** (Command dispatch) — unifies all input routing
4. **2d** (UI event bus) — feeds naturally into 2c's dispatch
5. **2e** (Async AI) — standalone, can be done anytime
6. **2f** (Codec) — standalone, prevents future bugs

P3 items are independent of each other and of P2. They can be interleaved freely.

## Done

- ~~Decompose game-engine.ts~~ — Extracted into `engine/util.ts`, `engine/victory.ts`, `engine/ordnance.ts`, `engine/combat.ts` with backward-compatible re-exports (681 lines, down from 1957)
- ~~Add map-data.test.ts~~ — 23 tests covering map builder, body gravity, base placement, scenarios
- ~~Add processEmplacement tests~~ — 10 tests covering emplacement validation and success paths
- ~~Add constants validation tests~~ — 15 tests covering ship stats sanity, ordnance mass, combat/cost scaling
- ~~Shrink renderer.ts~~ — Extracted `renderer/draw.ts`, `renderer/effects.ts`, `renderer/scene.ts`, `renderer/overlay.ts` (1,771 → 1,011 lines)
- ~~Shrink ui.ts and input.ts~~ — Already under 1,000 lines (661 and 313 respectively)
- ~~Reorganise into folders~~ — Flat prefixed filenames replaced with `game/`, `renderer/`, `ui/`, `engine/`, `game-do/` subfolders
