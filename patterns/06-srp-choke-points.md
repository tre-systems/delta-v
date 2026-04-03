# SRP Choke Points

**Category:** Architectural

## Intent

Route all instances of a cross-cutting concern through a single function (a "choke point") so that invariants, side effects, and policies are enforced uniformly. This prevents bypass paths where a caller might skip validation, event persistence, or state synchronization.

## How It Works in Delta-V

Delta-V has three primary choke points, each enforcing a critical invariant:

### 1. `publishStateChange` (Server Write Choke Point)

Every server-side game state mutation must flow through `publishStateChange`, which delegates to `runPublicationPipeline`. This pipeline enforces six ordered steps:

1. **Append events** to the event stream.
2. **Checkpoint** at turn boundaries.
3. **Verify projection parity** (event-projected state matches live state).
4. **Archive** if the game is over.
5. **Restart the turn timer.**
6. **Broadcast** state to connected clients.

No server code path bypasses this pipeline. The `GameDO` class exposes `publishStateChange` as a private method, and it is injected into the action handlers through deps. All 13 game-state action handlers call it through `publishForActor`.

### 2. `dispatchGameStateAction` / `runGameStateAction` (Server Command Choke Point)

All game-state commands from WebSocket messages flow through `dispatchGameStateAction` in `actions.ts`, which:

1. Looks up the handler by message type from the handlers map.
2. Calls `runGameStateAction`, which:
   - Reads the current game state.
   - Runs the engine function.
   - Handles errors (logs, reports telemetry, sends error to client).
   - On success, calls the handler's `publish` method.

This ensures that every command gets the same error handling, telemetry reporting, and state retrieval pattern.

### 3. `applyClientGameState` (Client Write Choke Point)

All client-side game state writes flow through `applyClientGameState` in `game-state-store.ts`. This function:

1. Projects visibility (spectator mode reveals all ships).
2. Batches reactive signal updates (preventing intermediate renders).
3. Reconciles selection state (clears selection if the selected ship is destroyed).
4. Optionally syncs the renderer.

The module header comment explicitly documents the ownership contract: who may call what, and why.

## Key Locations

| Purpose | File | Lines |
|---|---|---|
| Publication pipeline | `src/server/game-do/publication.ts` | 90-125 |
| publishStateChange binding | `src/server/game-do/game-do.ts` | 541-556 |
| Action handler registry | `src/server/game-do/actions.ts` | 107-323 |
| dispatchGameStateAction | `src/server/game-do/actions.ts` | 381-407 |
| runGameStateAction | `src/server/game-do/actions.ts` | 341-379 |
| applyClientGameState | `src/client/game/game-state-store.ts` | 63-86 |
| clearClientGameState | `src/client/game/game-state-store.ts` | 88-94 |
| WebSocket command routing | `src/server/game-do/ws.ts` | 64-84 |

## Code Examples

The server's publication choke point enforces all post-mutation invariants (`src/server/game-do/publication.ts`):

```typescript
// src/server/game-do/publication.ts lines 90-125
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

The command dispatch choke point ensures uniform error handling (`src/server/game-do/actions.ts`):

```typescript
// src/server/game-do/actions.ts lines 341-379
export const runGameStateAction = async <
  Success extends { state: GameState },
>(
  deps: RunActionDeps,
  ws: WebSocket,
  action: (gameState: GameState) => Success | EngineFailure | Promise<...>,
  onSuccess: (result: Success) => Promise<void> | void,
): Promise<void> => {
  const gameState = await deps.getCurrentGameState();
  if (!gameState) { return; }

  let result: Success | EngineFailure;
  try {
    result = await action(gameState);
  } catch (err) {
    const code = await deps.getGameCode();
    console.error(`Engine error in game ${code}`, ...);
    deps.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
    deps.sendError(ws, 'Engine error -- action rejected, game state preserved');
    return;
  }

  if ('error' in result) {
    deps.sendError(ws, result.error.message, result.error.code);
    return;
  }
  await onSuccess(result);
};
```

The client write choke point with batched reactivity (`src/client/game/game-state-store.ts`):

```typescript
// src/client/game/game-state-store.ts lines 63-86
export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  const visibleState = projectClientVisibleState(state, deps.isSpectator);

  batch(() => {
    deps.ctx.gameState = visibleState;

    const selectedId = deps.ctx.planningState.selectedShipId;
    if (selectedId) {
      const selectedShip = visibleState.ships.find(
        (ship) => ship.id === selectedId,
      );
      if (!selectedShip || selectedShip.lifecycle === 'destroyed') {
        deps.ctx.planningState.setSelectedShipId(null);
      }
    }

    deps.renderer?.setGameState(visibleState);
  });
};
```

## Consistency Analysis

**Strengths:**

- The `publishStateChange` choke point is used by all 13 game-state action handlers via `publishForActor`. There are no alternative publication paths.
- The turn timeout handler in `turns.ts` also routes through `publishStateChange` (via the alarm deps), ensuring timeout-triggered state changes get the same treatment as player-initiated ones.
- The `applyClientGameState` function has explicit documentation of its ownership contract in the module header comment, listing every authorized caller.
- The `runGameStateAction` choke point catches engine exceptions uniformly, preventing unhandled crashes from killing the Durable Object.

**Weaknesses:**

- The initial game creation (`initGameSession` in `match.ts`) has its own state publication path that does not go through `publishStateChange`. It calls `verifyProjectionParity` and `broadcastFiltered` directly. While this is a one-time initialization flow, it duplicates some of the publication pipeline's responsibilities.
- The `broadcastStateChange` function in `broadcast.ts` can be called directly (bypassing the publication pipeline) if code holds a reference to the `broadcastStateChange` deps callback. Currently only `createPublicationDeps` provides this callback, but the pattern is not structurally enforced.
- On the client side, the `clearClientGameState` function is a separate entry point for nulling game state during menu transitions. It is small and justified, but it means there are two client-side state write paths rather than one.

## Completeness Check

- **Consider: structural enforcement.** The choke-point pattern relies on developer discipline -- nothing prevents a new contributor from calling `appendEnvelopedEvents` directly without going through `publishStateChange`. Module-level visibility (e.g., only exporting the pipeline function) could make bypass structurally impossible.
- **Consider: middleware/interceptor pattern.** The publication pipeline's steps are hardcoded. A middleware chain would make it easier to add cross-cutting concerns (e.g., analytics, rate limiting) without modifying the pipeline runner.
- **Consider: unifying game init publication.** Routing initial game creation through the same publication pipeline (perhaps with a flag for "first publication") would eliminate the one known bypass path.

## Related Patterns

- **Event Sourcing** (01) -- The publication choke point is where events are persisted.
- **CQRS** (02) -- `publishStateChange` is the write-side choke point; `applyClientGameState` is the read-side choke point.
- **Composition Root** (04) -- The choke-point functions receive their dependencies through the composition root.
