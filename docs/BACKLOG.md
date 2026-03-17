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

No open P3 items currently.

## Done

- ~~2f. Serialisation codec~~ *(deferred — not currently needed)* — GameState contains only JSON-serializable primitives
- ~~3f. Centralise mutable client state~~ — `GameClient` state grouped into a unified `ClientContext` (`this.ctx`)
- ~~3g. InputHandler command-based refactor~~ — `InputHandler` now avoids direct mutations and emits `GameCommand` objects via `onCommand` callback
