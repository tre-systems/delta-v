# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

### Continue mobile HUD/layout polish
The HUD now measures its live top/bottom offsets instead of relying on fixed `rem` guesses, and the mobile top bar/action cluster have been tightened. There is still follow-up work to validate real-device behavior and finish any remaining overlap or clipping issues on very small screens.

**Files:** `static/style.css`, `src/client/ui.ts`, `src/client/renderer.ts`

## P2 — Code Quality

### Decompose game-engine.ts
At over 1000 lines, `game-engine.ts` handles game creation, astrogation, ordnance, combat, and turn management. Extract into focused modules (e.g., `game-create.ts`, `game-ordnance.ts`, `game-combat-phase.ts`) while keeping the orchestrator thin.

**Files:** `src/shared/game-engine.ts`

### Continue shrinking large client coordinators
`main.ts`, `renderer.ts`, and `ui.ts` are cleaner than they were, but they still carry too much orchestration and DOM/render state. Keep extracting pure helpers and view-model builders until those files are mostly wiring.

**Files:** `src/client/main.ts`, `src/client/renderer.ts`, `src/client/ui.ts`

## P3 — Test Coverage

### Add map-data.test.ts
`src/shared/map-data.ts` has no unit tests. Cover `bodyHasGravity`, scenario generation, and hex map construction.

### Add processEmplacement tests
The orbital base emplacement logic in `game-engine.ts` is untested. Add tests for valid/invalid placements and cost validation.

### Add constants validation tests
Add basic sanity tests for `SHIP_STATS` (e.g., no negative values, warships have `canOverload: true`, `defensiveOnly` ships have low combat ratings).
