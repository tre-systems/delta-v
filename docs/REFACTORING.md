# Delta-V: Architectural Patterns & Refactoring Guide

This document captures the architectural patterns in the Delta-V codebase and remaining refactoring opportunities. The codebase is well-structured — the pure functional engine in `shared/`, the extraction of helper modules on the client side, the typed message protocol, and the recent refactorings below are solid foundations.

The overarching theme: you don't need a framework, you need to keep the surface area of `GameClient` thin by pulling state and logic out of the class and into composable pure functions and a thin transport layer.

## Established Patterns

These patterns are already strong and should be preserved:

- **Pure functional game engine.** `shared/engine/game-engine.ts` takes state + actions and returns new state + events with no side effects. This is exactly right for a turn-based game and makes the rules unit-testable in isolation.
- **The "derive plan, then execute" pattern.** Files like `game/phase.ts`, `game/messages.ts`, and `game/phase-entry.ts` return plain data objects describing what should happen, and the caller executes them. This keeps logic testable and side effects contained.
- **Shared types as the contract.** `types.ts` as the single source of truth for `GameState`, `Ship`, network messages, etc. ensures client and server never drift.
- **Decomposed renderer.** At ~1000 lines with well-extracted sub-modules (`renderer/combat.ts`, `renderer/entities.ts`, `renderer/vectors.ts`, etc.), the renderer is doing what a game renderer should.
- **PlanningState as a standalone object.** `GameClient` owns `PlanningState` (defined in `src/client/game/planning.ts`), passing it by reference to both the renderer and input handler. Mutations go through helper functions. The renderer just reads it each frame.
- **Transport adapter.** `GameTransport` interface (`src/client/game/transport.ts`) with `createWebSocketTransport` and `createLocalTransport` eliminates all `isLocalGame` branching from action handlers.
- **Command dispatch.** `GameCommand` discriminated union (`src/client/game/commands.ts`) routes all user-initiated actions through a single `dispatch(cmd)` bottleneck. `keyboardActionToCommand()` bridges the keyboard input layer.
- **Typed UI event bus.** `UIEvent` union (`src/client/ui/events.ts`) replaces 15 nullable callbacks on UIManager with a single `onEvent` emitter. `handleUIEvent()` in GameClient maps menu events directly and in-game events through `dispatch()`.
- **Async AI turn loop.** `runAITurn` uses `async/await` with a `while` loop instead of recursive `setTimeout` callback chains.

---

## Completed: Centralise mutable client state

The `GameClient` state has been centralized into a single `ClientContext` object (`this.ctx`). This provides a single source of truth for all mutable client-side data (game state, planning state, session info, connection status).

## Completed: InputHandler produces commands, not mutations

The `InputHandler` now translates all user interactions into `GameCommand` objects. It no longer mutates `PlanningState` or `Camera` directly. All actions flow through a single `dispatch(cmd)` bottleneck in `GameClient`.

---

## Remaining Refactoring: Reduce InputHandler's knowledge (longer-term)

Instead of giving `InputHandler` references to everything, have it produce raw spatial events:

```typescript
type InputEvent =
  | { type: 'clickHex'; hex: HexCoord }
  | { type: 'clickMinimap'; worldPos: PixelCoord }
  | { type: 'doubleClickWorld'; worldPos: PixelCoord }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; cx: number; cy: number; factor: number };
```

A separate interpretation layer (a pure function) maps `InputEvent` + current state → `GameCommand`. This makes the input handler trivially testable (it just translates coordinates) and puts all the game-aware click logic in a pure function that's also easy to test.

---

## Deferred: Serialisation codec

`GameState` contains only JSON-serializable primitives (no Map/Set/Date). `deserializeState()` is `return raw`. A codec would add overhead with zero current benefit. Revisit if Map or Set fields are added to GameState. See BACKLOG.md for tracking.
