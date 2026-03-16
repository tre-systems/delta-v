# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

### Continue mobile HUD/layout polish
The HUD now measures its live top/bottom offsets instead of relying on fixed `rem` guesses, and the mobile top bar/action cluster have been tightened. There is still follow-up work to validate real-device behavior and finish any remaining overlap or clipping issues on very small screens.

**Files:** `static/style.css`, `src/client/ui.ts`, `src/client/renderer.ts`

## P2 — Code Quality

### Shrink main.ts further (1,286 lines)
`main.ts` is the only coordinator still over 1,000 lines. Its methods are mostly 5-20 line glue between extracted helpers — no single block is large enough for easy extraction. Consider whether a second-level split (e.g., separating local-game orchestration from network orchestration) is worthwhile.

**Files:** `src/client/main.ts`

## P3 — Test Coverage

### Improve branch coverage on decomposed engine modules
`engine-combat.ts` (70.5% branches) has coverage gaps. Add tests for edge cases in combat phase validation.

## Done

- ~~Decompose game-engine.ts~~ — Extracted into `engine-util.ts`, `engine-victory.ts`, `engine-ordnance.ts`, `engine-combat.ts` with backward-compatible re-exports (681 lines, down from 1957)
- ~~Add map-data.test.ts~~ — 23 tests covering map builder, body gravity, base placement, scenarios
- ~~Add processEmplacement tests~~ — 10 tests covering emplacement validation and success paths
- ~~Add constants validation tests~~ — 15 tests covering ship stats sanity, ordnance mass, combat/cost scaling
- ~~Shrink renderer.ts~~ — Extracted `renderer-draw.ts`, `renderer-effects.ts`, `renderer-scene.ts`, `renderer-overlay.ts` (1,771 → 1,011 lines)
- ~~Shrink ui.ts and input.ts~~ — Already under 1,000 lines (661 and 313 respectively)
