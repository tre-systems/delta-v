# Pipeline / Chain of Responsibility

## Category

Behavioral

## Intent

Structure complex multi-step operations as ordered sequences of independent stages, where each stage transforms or acts on data before passing it to the next. This makes each stage independently testable, allows stages to be added or reordered, and makes the overall flow visible as a named sequence of steps.

## How It Works in Delta-V

Delta-V uses the pipeline pattern in three major areas:

### 1. Publication Pipeline (Server)

The most explicitly named pipeline in the codebase. `runPublicationPipeline` in `publication.ts` executes six named steps every time game state changes on the server:

1. **Append events** -- Write engine events to the event stream
2. **Checkpoint** -- Save a state checkpoint at turn boundaries or game end
3. **Verify projection parity** -- Re-project events and compare with authoritative state
4. **Archive** -- Schedule R2 archival if the match ended
5. **Restart turn timer** -- Reset the turn timer for the next player
6. **Broadcast** -- Send state change to all connected clients

Each step is extracted as a named function (`appendEvents`, `checkpointIfNeeded`, `archiveIfGameOver`). The runner calls them in order, threading shared context (`deps`, `state`, `events`).

### 2. Input Pipeline (Client)

User input flows through a chain of transformations:

1. **DOM events** (`input.ts`) -- Raw mouse/touch/keyboard events captured via `listen()`
2. **Pointer interaction** (`input-interaction.ts`) -- Drag detection, pinch zoom, click classification
3. **Hex resolution** -- Screen coordinates converted to hex coordinates via `pixelToHex`
4. **Input events** -- Typed `InputEvent` values (`clickHex`, `hoverHex`)
5. **Command interpretation** (`input-events.ts`) -- `interpretInput` maps input events + interaction mode to `GameCommand[]`
6. **Command dispatch** (`command-router.ts`) -- `dispatchGameCommand` routes to domain handlers
7. **Domain action** -- Handler mutates state, sends network message, or updates UI

For keyboard: DOM `keydown` -> `deriveKeyboardAction` -> `keyboardActionToCommand` -> `dispatchGameCommand`.

### 3. Render Pipeline (Client)

Each frame follows a fixed rendering order in `scene.ts` and the renderer:

1. **Clear canvas**
2. **Stars** (`renderStars`) -- Background star field
3. **Hex grid** (`renderHexGrid`) -- Grid overlay
4. **Gravity indicators** (`renderGravityIndicators`) -- Directional arrows
5. **Bodies** (`renderBodies`) -- Celestial bodies with glow effects
6. **Asteroids** (`renderAsteroids`) -- Asteroid debris
7. **Base markers** (`renderBaseMarkers`) -- Friendly/enemy base indicators
8. **Map border** (`renderMapBorder`) -- Boundary rectangle
9. **Landing targets** (`renderLandingTarget`) -- Objective markers
10. **Detection ranges** (`renderDetectionRanges`) -- Circle overlays
11. **Trails** -- Ship and ordnance movement trails
12. **Velocity vectors** -- Ship velocity arrows
13. **Ships/ordnance** -- Entity sprites and labels
14. **Course previews** -- Burn direction previews
15. **Combat effects** -- Attack animations
16. **Minimap** -- Picture-in-picture overview
17. **Toasts/overlays** -- Transient notifications

Each stage uses `build*` functions to construct view data, then Canvas drawing functions to render it. The ordering is critical: later stages draw on top of earlier ones.

### 4. Server Message Pipeline (Client)

Incoming server messages flow through:

1. **WebSocket receive** -- Raw JSON message
2. **Protocol parsing** -- Typed `S2C` message
3. **Plan derivation** (`deriveClientMessagePlan`) -- Pure function producing a `ClientMessagePlan`
4. **Plan execution** -- Switch on plan kind, calling state updates, UI changes, sound effects

### 5. Authoritative Update Pipeline (Client)

Game state updates from server or local engine:

1. **Resolution** -- Engine produces `MovementResult` or `StateUpdateResult`
2. **Conversion** (`toLocalAuthoritativeUpdate`) -- Map to `AuthoritativeUpdate` union
3. **Application** (`applyAuthoritativeUpdate`) -- Switch on kind, calling presenters and state writers
4. **Continuation** -- Check for game over, trigger phase transition

## Key Locations

| File | Pipeline | Role |
|------|----------|------|
| `src/server/game-do/publication.ts` | Publication | `runPublicationPipeline` with named steps |
| `src/client/input.ts` | Input | DOM -> pointer interaction -> hex -> input events |
| `src/client/input-interaction.ts` | Input | Pointer state machine (drag, pinch, click) |
| `src/client/game/input-events.ts` | Input | `interpretInput` -> `GameCommand[]` |
| `src/client/game/command-router.ts` | Input | `dispatchGameCommand` |
| `src/client/game/keyboard.ts` | Input | `deriveKeyboardAction` |
| `src/client/renderer/scene.ts` | Render | Scene-level rendering functions |
| `src/client/game/client-message-plans.ts` | Server message | `deriveClientMessagePlan` |
| `src/client/game/authoritative-updates.ts` | Auth update | `applyAuthoritativeUpdate` |

## Code Examples

Publication pipeline (`publication.ts`):

```typescript
export const runPublicationPipeline = async (
  deps: PublicationDeps,
  state: GameState,
  primaryMessage?: StatefulServerMessage,
  options?: PublicationOptions,
): Promise<void> => {
  const { actor = null, restartTurnTimer = true, events = [] } = options ?? {};
  const roomCode = await deps.getGameCode();
  const replayMessage = resolveStateBearingMessage(state, primaryMessage);

  // Step 1: Append events
  const eventSeq = await appendEvents(deps.storage, state.gameId, actor, events);

  // Step 2: Checkpoint
  await checkpointIfNeeded(deps.storage, state.gameId, state, eventSeq, events);

  // Step 3: Verify projection parity
  await deps.verifyProjectionParity(state);

  // Step 4: Archive if game over
  archiveIfGameOver(deps, state, roomCode, events);

  // Step 5: Restart turn timer
  if (restartTurnTimer) {
    await deps.startTurnTimer(state);
  }

  // Step 6: Broadcast
  deps.broadcastStateChange(state, replayMessage);
};
```

Input pipeline (composing stages in `main-interactions.ts`):

```typescript
// Stage 5-6: interpret input event and dispatch resulting commands
handleInput(event: InputEvent) {
  const commands = interpretInput(
    event,
    ctx.gameStateSignal.peek(),
    deriveInteractionMode(ctx.stateSignal.peek()),
    map,
    ctx.playerId as PlayerId,
    ctx.planningState.getInteractiveSnapshot(),
  );
  for (const cmd of commands) {
    dispatchGameCommand(commandRouterDeps, cmd);
  }
}
```

Authoritative update pipeline (`authoritative-updates.ts`):

```typescript
export const applyAuthoritativeUpdate = (
  deps: AuthoritativeUpdateDeps,
  update: AuthoritativeUpdate,
): void => {
  switch (update.kind) {
    case 'movementResult': {
      const state = deps.deserializeState(update.state);
      deps.presentMovementResult(state, update.movements, /* ... */, () =>
        showImmediateGameOverOrContinue(deps, update.kind, update.gameOver),
      );
      return;
    }
    case 'stateUpdate': {
      const state = deps.deserializeState(update.state);
      if (update.transferEvents?.length) {
        logTransferEvents(deps, update.transferEvents, state);
      }
      deps.applyGameState(state);
      if (update.gameOver) {
        deps.showGameOverOutcome(update.gameOver.won, update.gameOver.reason);
        return;
      }
      if (update.shouldContinue !== false) deps.onStateUpdateComplete();
      return;
    }
    // ...
  }
};
```

## Consistency Analysis

**Strengths:**

- The publication pipeline is the most explicit: named steps with comments, a clear runner function, and dependency injection for testability.
- The input pipeline has clean stage boundaries: each stage has a well-defined input/output type (`DOM event -> InputEvent -> GameCommand[]`).
- The render pipeline maintains strict ordering (background to foreground), with each render function independent of others.
- The authoritative update pipeline handles all update variants exhaustively with a `never` guard.

**Composability:**

- Publication pipeline stages are independently callable and testable. Adding a new step (e.g., analytics) just means adding another function call in the runner.
- Input pipeline stages are loosely coupled: `interpretInput` does not know about keyboard vs. mouse origin. Both feed into the same `GameCommand` interface.
- Render pipeline stages share only the Canvas context and camera state. Any stage can be skipped (e.g., `renderDetectionRanges` returns early during animation).

**Tightly coupled stages:**

- In the input pipeline, `createPointerInteractionManager` is a stateful stage (tracking drag state, pinch distance) rather than a pure transformation. This is necessary for drag detection but makes the stage harder to test in isolation.
- The render pipeline's ordering is implicit (sequential function calls) rather than explicit (a stage array). Reordering requires editing the render function body.
- The publication pipeline's `archiveIfGameOver` runs in the background (`waitUntil`) rather than blocking, which means Step 4 may not complete before Step 6. This is by design but could cause issues if the archive depends on the broadcast.

**Recommendations:**

- Consider expressing the render pipeline as an array of render functions that are called in order, making the ordering explicit and overridable.
- The publication pipeline could be made more composable by having each step return data for the next, rather than all steps reading from shared closure variables.

## Completeness Check

- **Publication pipeline**: All 6 steps are extracted and named. The pipeline handles both normal state changes and game-over scenarios.
- **Input pipeline**: Covers mouse, touch, and keyboard. All paths converge on `GameCommand` dispatch.
- **Render pipeline**: Covers all visual layers from background to foreground. Each layer has corresponding `build*` and `render*` functions.
- **Server message pipeline**: All `S2C` message types produce plans via `deriveClientMessagePlan`.
- **Authoritative update pipeline**: All update kinds (`movementResult`, `combatResult`, `combatSingleResult`, `stateUpdate`, `gameOver`) are handled.

## Related Patterns

- **Command** (08) -- The input pipeline terminates in command dispatch.
- **Visitor** (14) -- The publication pipeline's event appending feeds the event projection system.
- **Builder** (13) -- Render pipeline stages use builders (`build*`) to construct view data before drawing.
- **State Machine** (09) -- The input pipeline's `interpretInput` function reads the interaction mode (derived from the state machine) to determine which commands a click produces.
- **Derive/Plan** (12) -- The server message pipeline uses `deriveClientMessagePlan` as its planning stage.
