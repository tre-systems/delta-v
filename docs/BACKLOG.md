# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

No open P0 items currently.

## P1 — Robustness

No open P1 items currently.

## P2 — Code Quality

### 2f. Serialisation codec *(deferred — not currently needed)*
`GameState` contains only JSON-serializable primitives (no Map/Set/Date). `deserializeState()` is `return raw`. A codec would add overhead with zero current benefit. Revisit if Map or Set fields are added to GameState.

**Files:** new `src/shared/codec.ts`

### 2j. Decompose `main.ts` *(improvement opportunity)*
`GameClient` (~1400 LOC) owns rendering, input, UI, networking, game logic, audio, and tutorials — a fat controller. Decompose into a thin dispatcher that delegates to focused handlers per phase.

### 2k. Structural sharing in engine *(improvement opportunity — unlocks replay, undo, spectator)*
Engine functions mutate `GameState` and its entities in place: `game-engine.ts` directly mutates `state.phase`, `state.pendingAstrogationOrders`, ship fields, player objects; `combat.ts` mutates ships via `applyDamage()`, `target.destroyed = true`, heroism flags; `engine/combat.ts` mutates phase and state during combat progression.

This works because the server holds a single reference, but prevents: state diffing, undo, replay, spectator mode, and speculative AI branching. The pragmatic path is clone-on-entry at engine entry points (or Immer), not a rewrite to persistent data structures.

### 2l. Eliminate map singleton *(improvement opportunity)*
`getSolarSystemMap()` returns a lazy-cached global. The map is already passed as a parameter to most engine functions — remove the singleton escape hatch entirely.

### ~~2m. Make RNG fully injectable~~ *(done)*
RNG is now a required parameter at all engine entry points (`processAstrogation`, `processCombat`, `skipCombat`, `beginCombatPhase`, `processOrdnance`, `skipOrdnance`). Internal functions (`rollD6`, `resolveCombat`, `resolveBaseDefense`, `shuffle`, `randomChoice`, `checkRamming`, `moveOrdnance`, `resolvePendingAsteroidHazards`) also require `rng`. `createGame` accepts optional `rng` with `Math.random` default. AI functions (`aiAstrogation`, `aiOrdnance`) accept optional `rng` with `Math.random` default. All callers (game-do.ts, local.ts, turns.ts) pass `Math.random` at the boundary.

### ~~2n. Fix `local.ts` state aliasing~~ *(done)*
Investigation found the aliasing was not causing bugs (both references pointed to the same mutated object and the consuming code didn't rely on a true snapshot). Fixed anyway with `structuredClone(state)` before engine calls to make `previousState` semantics honest and safe for future animation diffing.

## P3 — Test Coverage

No open P3 items currently.

## Done

- ~~Spec divergence audit~~ — Cross-referenced all 6 SPEC.md divergences against Triplanetary 2018 PDF rulebook. Edge-of-gravity and asteroid hexside rules already resolved via `analyzeHexLine()`. Dreadnaught fires-while-disabled exception already implemented. Added 33 new tests (897 total) covering `analyzeHexLine` edge cases, `queueAsteroidHazards` unit tests, gravity edge-grazing, dreadnaught exception, and `isAsteroidHex`/`resolvePendingAsteroidHazards`.
- ~~Mobile HUD/layout polish~~ — Compact 2-line flex top bar on mobile (47px, down from 107px); constrained game log/ship list on short viewports to prevent full-view occlusion; fixed help/SFX button overlap with game log at ≤560px height
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
- ~~2g. Centralise mutable client state~~ — `GameClient` state grouped into a unified `ClientContext` (`this.ctx`)
- ~~2h. InputHandler command-based refactor~~ — `InputHandler` now avoids direct mutations and emits `GameCommand` objects via `onCommand` callback
- ~~2i. Reduce InputHandler to raw spatial events~~ — `InputHandler` stripped of `gameState`/`playerId`/`planningState`; emits `InputEvent` (`clickHex`/`hoverHex`); pure `interpretInput()` in `game/input-events.ts` maps events to `GameCommand[]`
- ~~3a. Improve combat.ts branch coverage~~ — 90% branches; added tests for duplicate targets, LOS-blocked attacks, anti-nuke through bodies, no-strength ordnance groups, asteroid hazard resolution
- ~~3b. Improve AI test coverage~~ — 85.7% statements, 79% branches (from 62%/58%); added 53 tests covering escape strategy, checkpoint races, easy AI randomization, mine-laying, nuke launch, anti-nuke targeting
- ~~3c. Improve victory.ts branch coverage~~ — 93% branches (from 85%); added 44 tests covering checkpoints, escape/moral victory, ramming, inspection, capture, orbital resupply, detection
- ~~3d. Add movement.ts edge case tests~~ — 87% branches (from 77%); added tests for takeoff fallback, overload, weak gravity consecutive rules
- ~~3e. Add protocol validation tests~~ — 100% branches (from 46%); added 90 tests covering all validation functions, seat assignment, message parsing
