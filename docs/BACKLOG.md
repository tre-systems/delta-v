# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

### Continue mobile HUD/layout polish
The HUD now measures its live top/bottom offsets instead of relying on fixed `rem` guesses, and the mobile top bar/action cluster have been tightened. There is still follow-up work to validate real-device behavior and finish any remaining overlap or clipping issues on very small screens.

**Files:** `static/style.css`, `src/client/ui.ts`, `src/client/renderer.ts`

## P2 — Code Quality

### Continue shrinking large client coordinators
`main.ts`, `renderer.ts`, and `ui.ts` are cleaner than they were, but they still carry too much orchestration and DOM/render state. Keep extracting pure helpers and view-model builders until those files are mostly wiring.

**Files:** `src/client/main.ts`, `src/client/renderer.ts`, `src/client/ui.ts`

## P3 — Test Coverage

### Add constants validation tests
Add basic sanity tests for `SHIP_STATS` (e.g., no negative values, warships have `canOverload: true`, `defensiveOnly` ships have low combat ratings).

### Improve branch coverage on decomposed engine modules
`engine-util.ts` (60% branches) and `engine-combat.ts` (70.5% branches) have coverage gaps. Add tests for edge cases in utility predicates and combat phase validation.

## Done

- ~~Decompose game-engine.ts~~ — Extracted into `engine-util.ts`, `engine-victory.ts`, `engine-ordnance.ts`, `engine-combat.ts` with backward-compatible re-exports (681 lines, down from 1957)
- ~~Add map-data.test.ts~~ — 23 tests covering map builder, body gravity, base placement, scenarios
- ~~Add processEmplacement tests~~ — 10 tests covering emplacement validation and success paths
