# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

---

## P1 — Architecture & Production Safety

### 1a. Clone-on-entry at engine entry points

Engine functions mutate `GameState` in place. This works because the server holds a single reference, but it:

- **Breaks the server if the engine throws mid-mutation** — the DO's in-memory state is left inconsistent, permanently breaking the room.
- **Prevents replay, spectator, undo** — no previous-state snapshot to diff against or store.
- **Limits AI search** — speculative branching requires manual clone gymnastics.

**Approach:** Wrap every engine entry point (`processAstrogation`, `processCombat`, `processOrdnance`, `beginCombatPhase`, `skipCombat`, `skipOrdnance`, `processLogistics`, `skipLogistics`, `processFleetReady`) with `structuredClone(state)` before calling the mutation logic. On success, return the mutated clone. On exception, the original state is untouched.

This is already done in `client/game/local.ts` for animation diffing. Extending it to all entry points is mechanical.

**Unlocks:** server-side rollback safety (1b), event log (1c), turn history, spectator mode, better AI search.

**Files:** `src/shared/engine/game-engine.ts`, engine sub-modules, `src/server/game-do/game-do.ts`

### 1b. Server-side state rollback

With clone-on-entry (1a) in place, the server wraps engine calls in try/catch. On exception: log the error, restore the pre-mutation state, send an error message to the client. The game continues instead of permanently breaking.

Currently mitigated by high test coverage, but a safety net is essential for production with real users.

**Depends on:** 1a (clone-on-entry)

**Files:** `src/server/game-do/game-do.ts` (`runGameStateAction`)

### 1c. Event log for network protocol

The server sends full `GameState` snapshots over WebSocket after every action. This works but:

- **No replay capability** — there's no history of what happened, just the current state.
- **No spectator catch-up** — a late joiner would need the full game history.
- **Reconnection is lossy** — a reconnecting client gets a snapshot but misses the animation/events that led to it.
- **Payload size grows with state** — every broadcast includes the full ship array, ordnance array, etc.

**Approach:** After each engine call, the server appends a lightweight event to an in-memory log (e.g. `{ turn: 5, phase: 'combat', type: 'COMBAT_RESOLVED', data: combatResult }`). The log is persisted alongside the state snapshot. On reconnect or spectator join, send the snapshot + event log. Clients can replay events for animation.

This is not full event sourcing — snapshots remain the source of truth. The event log is an append-only complement for replay, reconnection, and spectator mode.

**Depends on:** 1a (clone-on-entry provides the before/after snapshots that generate events)

**Unlocks:** turn replay, spectator mode, smooth reconnection.

**Files:** `src/server/game-do/game-do.ts`, new `src/shared/events.ts` (event type definitions), `src/client/game/message-handler.ts`

### 1d. Error reporting

No visibility into production errors. When the engine throws, a WebSocket drops, or a client hits an unhandled exception, we currently have no signal.

**Approach:** Lightweight error boundary on the client (catch unhandled rejections, report to a `/error` endpoint or external service). Server-side: log engine exceptions in `runGameStateAction` catch block (naturally falls out of 1b). Start simple — structured JSON logs that Cloudflare captures — and add an external service (Sentry, LogFlare) later if needed.

**Files:** `src/client/main.ts` (error boundary), `src/server/game-do/game-do.ts` (catch logging), `src/server/index.ts` (error endpoint)

### 1e. Analytics / telemetry for user testing

Before user testing starts, we need basic visibility into how people play: which scenarios they pick, how long games last, where they get stuck, when they quit.

**Approach:** Emit lightweight events (game created, phase entered, game ended, scenario selected, AI difficulty chosen) to a `/telemetry` endpoint. Store in Cloudflare Analytics Engine or D1. No PII. Keep the client-side instrumentation minimal — a single `track(event, props)` function called from key points in `main.ts` and `ui.ts`.

**Files:** new `src/client/telemetry.ts`, `src/server/index.ts` (endpoint), `src/client/main.ts` and `src/client/ui/ui.ts` (call sites)

---

## P2 — Code Quality & Extensibility

### 2a. Client integration tests

Shared engine rules are well covered (84% statements, 75% branches). The bigger risk for rapid iteration sits in client coordination code — `main.ts` dispatch, phase transitions, message handling, UI wiring. Changes to these during user-testing iteration could break flows that unit tests don't cover.

**Approach:** Add integration-style tests that exercise `GameClient` dispatch + message handler flows end-to-end with a mock transport. Test scenarios like: "player sets burns, confirms, receives movement result, transitions to combat phase." These don't need a real DOM or canvas — just the state machine and command flow.

**Files:** new `src/client/game/integration.test.ts`, existing action/message-handler test files

### 2b. Centralise phase validation

Phase-locking checks (`if (state.activePlayer === playerId && state.phase === 'astrogation')`) are scattered across engine entry points and the server's message handlers. Adding a new phase means remembering to add guards in multiple places.

**Approach:** Extract a `canPerformAction(state, playerId, actionType): boolean` helper that centralises all phase/player validation. Engine entry points and server handlers call this instead of ad-hoc checks.

**Files:** `src/shared/engine/util.ts`, engine entry points, `src/server/game-do/game-do.ts`

### ~~Serialisation codec~~ *(deferred — not currently needed)*
`GameState` contains only JSON-serializable primitives (no Map/Set/Date). A codec would add overhead with zero current benefit. Revisit if Map or Set fields are added to GameState.

### ~~User accounts / auth~~ *(deferred — adds friction)*
Requiring login hurts adoption during user testing. The current anonymous token-in-localStorage model is frictionless and sufficient. Revisit when the app moves to native app store distribution or needs payment integration.

---

## P3 — Test Coverage

### 3a. Client coordination test coverage

The `dispatch()` switch in `main.ts` has ~60 cases. Phase transitions in `setState()` have implicit coupling to renderer, UI, and timer. These are the highest-risk areas during rapid iteration but currently have no direct tests.

**Approach:** Test the dispatch → state transition → side-effect flow with injectable dependencies. The existing DI pattern (astrogationDeps, combatDeps, etc.) makes this feasible.

**Files:** `src/client/main.ts` (test harness), new `src/client/game/dispatch.test.ts`

---

## Features

### Turn replay

Allow players to review past turns after a game ends (or during, stepping back through history).

**Depends on:** 1a (clone-on-entry for snapshots), 1c (event log for animation data).

### Spectator mode

Third-party WebSocket connections that receive state broadcasts but cannot submit actions.

**Depends on:** 1c (event log for catch-up).

**Files:** `src/server/game-do/game-do.ts` (spectator seat type), `src/server/protocol.ts`, client spectator UI

### 3c. New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics beyond what's currently implemented (rescue/passenger transfer, fleet mutiny trigger, advanced reinforcement waves).

### 3d. Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios. Extends the logistics phase with a new transfer type.

---

## Done

- ~~2j. Decompose `main.ts`~~ — Extracted 7 modules: presentation, message-handler, connection, timer, astrogation-actions, combat-actions, ordnance-actions, local-game-flow. `main.ts` 1397 → 1023 LOC.
- ~~2l. Eliminate map singleton~~ — Removed `getSolarSystemMap()` lazy singleton. All callers now use `buildSolarSystemMap()` directly or cache the map as a field.
- ~~Multiplayer chat~~ — Inline chat in game log with text input. C2S/S2C `chat` message type, 200-char limit, 500ms rate limit, XSS-safe via textContent. Hidden in AI games. 6 protocol tests.
- ~~2m. Make RNG fully injectable~~ — All engine entry points now require mandatory `rng: () => number`. No `Math.random` fallbacks in the turn-resolution path. `createGame` and AI functions accept optional `rng` with default.
- ~~2n. Fix `local.ts` state aliasing~~ — `structuredClone(state)` before engine calls makes `previousState` semantics honest for animation diffing.
- ~~Spec divergence audit~~ — Cross-referenced all 6 SPEC.md divergences against Triplanetary 2018 PDF rulebook. Edge-of-gravity and asteroid hexside rules already resolved via `analyzeHexLine()`. Dreadnaught fires-while-disabled exception already implemented. Added 33 new tests (897 total) covering `analyzeHexLine` edge cases, `queueAsteroidHazards` unit tests, gravity edge-grazing, dreadnaught exception, and `isAsteroidHex`/`resolvePendingAsteroidHazards`.
- ~~Mobile HUD/layout polish~~ — Compact 2-line flex top bar on mobile (47px, down from 107px); constrained game log/ship list on short viewports to prevent full-view occlusion; fixed help/SFX button overlap with game log at ≤560px height
- ~~Decompose game-engine.ts~~ — Extracted `engine/util.ts`, `engine/victory.ts`, `engine/ordnance.ts`, `engine/combat.ts` with backward-compatible re-exports. `game-engine.ts` reduced to ~720 LOC.
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
