# Facade

## Category

Structural

## Intent

Provide a single entry point that composes and wires together the many subsystems required to run a game client (renderer, UI, input, networking, session state, tutorials, telemetry, etc.) so that the bootstrap code only needs to call one function and receives a minimal public API in return.

## How It Works in Delta-V

`createGameClient` in `client-kernel.ts` is the application's composition root. It instantiates approximately 15 subsystems, connects them through dependency injection, and returns a deliberately narrow object containing only the renderer, a `showToast` helper, and a `dispose()` cleanup function. The vast majority of the internal wiring is hidden behind this facade.

The function follows a specific construction order driven by data dependencies:

1. **Foundation layer** -- Creates the `ClientSession` (reactive session model), obtains the canvas element, builds the renderer and UI manager.
2. **Infrastructure** -- Builds the solar system map, session token service, turn timer, and turn telemetry tracker.
3. **Controllers** -- Creates the HUD controller, camera controller, and action deps bundle. These depend on the foundation layer objects and on each other.
4. **Session shell** -- Delegates the complex lifecycle wiring (state transitions, message handling, replay, connection management, local transport bridging) to `createMainSessionShell`. This is itself a sub-facade that returns the mutable references `applyGameState`, `setState`, `transitionToPhase`, and `replayController`.
5. **Interaction layer** -- Creates the main interaction controller and input handler, wiring them to the session shell outputs.
6. **Runtime** -- Calls `setupClientRuntime` to attach browser event listeners (resize, keyboard, visibility, etc.).

The facade resolves a circular-reference problem: several subsystems (`actionDeps`, `sessionShell`) need references to functions that are only available after other subsystems are constructed. The facade uses `let` declarations with deferred assignment to break these cycles:

```ts
let applyGameState: (state: GameState) => void;
let setState: (newState: ClientState) => void;
let transitionToPhase: () => void;
let replayController: ReplayController;
```

These are assigned after `createMainSessionShell` returns, and are captured by closures that were created earlier (e.g. in `createActionDeps`). The closures use arrow functions like `() => transitionToPhase()` to ensure late binding.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/client-kernel.ts` | 47-221 | `createGameClient` facade function |
| `src/client/game/client-kernel.ts` | 206-218 | Returned public API (renderer, showToast, dispose) |
| `src/client/game/main-session-shell.ts` | all | Sub-facade for session lifecycle wiring |
| `src/client/game/action-deps.ts` | 61-206 | Action deps bundle (consumed by facade) |
| `src/client/game/session-model.ts` | all | Session model (consumed by facade) |

## Code Examples

The facade entry point and its narrow return type:

```ts
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();

  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const ui = createUIManager();
  const tutorial = createTutorial();
  tutorial.onTelemetry = (evt) => track(evt);
  const tooltipEl = byId('shipTooltip');
  const transferPanelEl = byId('transferPanel');
  const map = buildSolarSystemMap();
  // ... more subsystem construction ...

  return {
    renderer,
    showToast: interactions.showToast,
    dispose() {
      disposeSessionSubscriptions?.();
      connection.close();
      turnTimer.stop();
      disposeBrowserEvents();
      input.dispose();
      ui.dispose();
      tutorial.dispose();
    },
  };
};

export type GameClient = ReturnType<typeof createGameClient>;
```

The deferred-assignment pattern that resolves circular dependencies:

```ts
let applyGameState: (state: GameState) => void;
let setState: (newState: ClientState) => void;
let transitionToPhase: () => void;
let replayController: ReplayController;

// actionDeps captures these via closures:
const actionDeps = createActionDeps({
  // ...
  setState: (s) => setState(s),
  applyGameState: (s) => applyGameState(s),
  transitionToPhase: () => transitionToPhase(),
  onGameOverShown: () => replayController.onGameOverShown(),
  // ...
});

// Later, assign from the session shell:
const sessionShell = createMainSessionShell({ /* ... */ });
applyGameState = sessionShell.applyGameState;
replayController = sessionShell.replayController;
setState = sessionShell.setState;
transitionToPhase = sessionShell.transitionToPhase;
```

The reactive session subscriptions are wired in a single call:

```ts
const disposeSessionSubscriptions: Dispose = attachMainSessionEffects(ctx, {
  renderer,
  ui,
  hud,
  logistics: { renderLogisticsPanel },
});
```

## Consistency Analysis

The facade pattern is well-applied but concentrated in a single location:

- **Narrow public surface.** The returned object exposes only `renderer`, `showToast`, and `dispose`. This is excellent encapsulation -- the caller (likely `main.ts` or the app bootstrap) does not need to know about sessions, connections, transports, or any internal subsystem.
- **Dispose aggregation.** The `dispose()` method collects cleanup calls for every subsystem that holds resources (subscriptions, intervals, WebSocket connections, event listeners). This is thorough.
- **Sub-facade delegation.** The decision to push lifecycle wiring into `createMainSessionShell` keeps the top-level facade from growing too large. The shell itself returns a small surface.
- **Comment guidance.** The JSDoc at the top explicitly says "Prefer changing behavior in `game/*` modules rather than growing this closure," which is good architectural discipline.

**Consistency concern:** The facade uses `byId` to reach into the DOM for specific elements (`gameCanvas`, `shipTooltip`, `transferPanel`). This means the facade is coupled to specific HTML element IDs. If the HTML structure changes, the facade breaks. All other subsystem creation uses dependency injection cleanly.

## Completeness Check

**Strengths:**
- The facade completely hides construction order, circular-dependency resolution, and wiring details from callers.
- The `GameClient` type is derived via `ReturnType`, so the public API is always in sync with the implementation.
- The explicit `dispose()` method prevents resource leaks.

**Potential improvements:**
- **DOM coupling.** The three `byId` calls could be passed in as parameters (or a DOM container config) to make the facade testable without a real DOM. Currently, testing `createGameClient` requires the full HTML document.
- **Error handling during construction.** If any subsystem constructor throws, the facade has no cleanup path for already-constructed subsystems. A try/catch that calls dispose on partial construction could improve robustness.
- **The deferred-assignment pattern is fragile.** If a closure that captures `setState` is invoked before `sessionShell` is constructed, it would call `undefined`. TypeScript cannot catch this because the `let` variables are typed as their eventual type, not as `undefined | T`. Adding runtime guards or restructuring to remove the circular dependency would be safer.
- **Single responsibility.** The facade does both construction and wiring. Splitting these (a builder that constructs, and a wirer that connects) could make the code easier to modify, though this may be over-engineering for the current scale.

## Related Patterns

- **Adapter (pattern 16):** The facade wires up the transport adapter (local or WebSocket) as part of session shell construction. The choice of which adapter to use is hidden behind the facade.
- **Proxy / Lazy Evaluation (pattern 18):** `createActionDeps` uses lazy caching internally, and the facade passes it getters (`() => ctx.gameStateSignal.peek()`) rather than concrete values, enabling late binding throughout.
- **Composite (pattern 19):** The renderer created by the facade internally composes multiple rendering layers (static scene, ships, overlays, minimap) into a single `renderFrame` call.
- **Observer:** The `attachMainSessionEffects` call sets up reactive subscriptions that propagate session state changes to the renderer, UI, and HUD. The facade initiates this subscription wiring.
