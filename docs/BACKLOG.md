# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

---

## P1 — Architecture & Production Safety

### ~~1a. Clone-on-entry at engine entry points~~ *(done)*

All 11 engine entry points (`processAstrogation`, `processOrdnance`, `skipOrdnance`, `processFleetReady`, `beginCombatPhase`, `processCombat`, `skipCombat`, `processLogistics`, `skipLogistics`, `processSurrender`, `processEmplacement`) now `structuredClone(state)` on entry. The original state is never mutated — callers must use the returned `result.state`. 22 immutability tests added in `clone-on-entry.test.ts`.

### ~~1b. Server-side state rollback~~ *(done)*

`runGameStateAction` and `handleTurnTimeout` wrap engine calls in try/catch. On exception: log with game code, phase, and turn number; send error to client; state is never corrupted thanks to clone-on-entry (1a). The game continues from the last good state.

**Depends on:** ~~1a (clone-on-entry)~~ *(done)*

### ~~1c. Event log for network protocol~~ *(done)*

Server-side append-only event log persisted in DO storage alongside game state. 5 event types (`gameStarted`, `movementResolved`, `combatResolved`, `phaseChanged`, `gameOver`) defined in `src/shared/events.ts`. All 11 handler paths derive and append events. Reconnecting clients receive the full event log in the `gameStart` message. Snapshots remain the source of truth. 11 tests in `messages.test.ts` and `turns.test.ts`.

**Depends on:** ~~1a (clone-on-entry)~~ *(done)*

**Unlocks:** turn replay, spectator mode, smooth reconnection.

### 1d. Error reporting

No visibility into production errors. When the engine throws, a WebSocket drops, or a client hits an unhandled exception, we currently have no signal.

**Approach:** Global `window.onerror` and `unhandledrejection` handlers on the client POST structured JSON to a `/error` endpoint. The server endpoint logs the payload via `console.error` — Cloudflare Workers Logs captures all `console.*` output automatically (viewable in the dashboard or via `wrangler tail`). Server-side engine exceptions are already logged in `runGameStateAction` and `handleTurnTimeout` catch blocks (1b). No external services (Sentry, LogFlare) — unnecessary at current scale; upgrade path exists if needed.

**Files:** `src/client/main.ts` (global error handlers), `src/server/index.ts` (`/error` endpoint)

### 1e. Analytics / telemetry for user testing

Before user testing starts, we need basic visibility into how people play: which scenarios they pick, how long games last, where they get stuck, when they quit.

**Approach:** A lightweight `track(event, props)` function on the client POSTs structured JSON to a `/telemetry` endpoint. The server endpoint logs the payload via `console.log` — same Workers Logs sink as error reporting. No PII. No Analytics Engine or D1 — at current scale, structured logs are sufficient and queryable via `wrangler tail` or the dashboard. If proper querying is needed later, add a D1 table (`timestamp, event, json_props`).

**Files:** new `src/client/telemetry.ts`, `src/server/index.ts` (`/telemetry` endpoint), `src/client/main.ts` and `src/client/ui/ui.ts` (call sites)

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

**Depends on:** ~~1a (clone-on-entry)~~ *(done)*, ~~1c (event log)~~ *(done)*.

### Spectator mode

Third-party WebSocket connections that receive state broadcasts but cannot submit actions.

**Depends on:** ~~1c (event log for catch-up)~~ *(done)*.

**Files:** `src/server/game-do/game-do.ts` (spectator seat type), `src/server/protocol.ts`, client spectator UI

### 3c. New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics beyond what's currently implemented (rescue/passenger transfer, fleet mutiny trigger, advanced reinforcement waves).

### 3d. Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios. Extends the logistics phase with a new transfer type.

---

## Done

- ~~1c. Event log for network protocol~~ — 5 event types in `src/shared/events.ts`, server appends events after every action, reconnecting clients receive full log in `gameStart`. 11 tests.
- ~~1b. Server-side state rollback~~ — `runGameStateAction` and `handleTurnTimeout` wrap engine calls in try/catch. On exception: structured log with game code/phase/turn, error sent to client, state preserved via clone-on-entry.
- ~~1a. Clone-on-entry at engine entry points~~ — All 11 engine entry points `structuredClone(state)` on entry; callers use returned `result.state`. 22 immutability tests in `clone-on-entry.test.ts`. Unlocks 1b (rollback) and 1c (event log).
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
