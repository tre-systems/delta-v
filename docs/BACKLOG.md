# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

### Continue mobile HUD/layout polish
The HUD now measures its live top/bottom offsets instead of relying on fixed `rem` guesses, and the mobile top bar/action cluster have been tightened. There is still follow-up work to validate real-device behavior and finish any remaining overlap or clipping issues on very small screens.

**Files:** `static/style.css`, `src/client/ui/ui.ts`, `src/client/renderer/renderer.ts`

## P2 — Code Quality

### 2f. Serialisation codec *(deferred — not currently needed)*
`GameState` contains only JSON-serializable primitives (no Map/Set/Date). `deserializeState()` is `return raw`. A codec would add overhead with zero current benefit. Revisit if Map or Set fields are added to GameState.

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

P3 items are independent of each other. They can be interleaved freely.

## Done

- ~~Decompose game-engine.ts~~ — Extracted into `engine/util.ts`, `engine/victory.ts`, `engine/ordnance.ts`, `engine/combat.ts` with backward-compatible re-exports (681 lines, down from 1957)
- ~~Add map-data.test.ts~~ — 23 tests covering map builder, body gravity, base placement, scenarios
- ~~Add processEmplacement tests~~ — 10 tests covering emplacement validation and success paths
- ~~Add constants validation tests~~ — 15 tests covering ship stats sanity, ordnance mass, combat/cost scaling
- ~~Shrink renderer.ts~~ — Extracted `renderer/draw.ts`, `renderer/effects.ts`, `renderer/scene.ts`, `renderer/overlay.ts` (1,771 → 1,011 lines)
- ~~Shrink ui.ts and input.ts~~ — Already under 1,000 lines (661 and 313 respectively)
- ~~Reorganise into folders~~ — Flat prefixed filenames replaced with `game/`, `renderer/`, `ui/`, `engine/`, `game-do/` subfolders
- ~~20. Adopt utility helpers~~ — Swept codebase to use `src/shared/util.ts` helpers and `src/client/dom.ts` DOM helpers; refactored imperative patterns to declarative/functional style
- ~~2a. Pull PlanningState out of the Renderer~~ — `PlanningState` moved to `src/client/game/planning.ts`, owned by `GameClient`, passed to Renderer and InputHandler as references
- ~~2b. Transport adapter~~ — `GameTransport` interface with `createLocalTransport` and `createWebSocketTransport` in `src/client/game/transport.ts`; eliminated all `isLocalGame` branching in action handlers
- ~~2e. Async AI turn loop~~ — Replaced recursive callback chain with async/await loop in `runAITurn`; extracted `resolveAIPlan` and `isGameOver` helpers
- ~~2c. Command dispatch~~ — `GameCommand` discriminated union in `src/client/game/commands.ts`; single `dispatch(cmd)` bottleneck in GameClient; `keyboardActionToCommand()` bridges KeyboardAction → GameCommand
- ~~2d. Typed UI event bus~~ — `UIEvent` union in `src/client/ui/events.ts`; UIManager's 15 nullable callbacks replaced with single `onEvent` emitter; `handleUIEvent()` in GameClient routes menu events directly, game events through `dispatch()`
