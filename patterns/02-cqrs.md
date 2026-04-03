# CQRS (Command Query Responsibility Segregation)

**Category:** Architectural

## Intent

Separate the write path (commands that mutate game state) from the read path (queries that project state for display), allowing each to be optimized independently. Commands flow through the engine and publication pipeline; queries are served from projected state, checkpoints, or filtered views.

## How It Works in Delta-V

Delta-V implements CQRS across the client-server boundary:

**Command side (writes):**

1. The client sends a command message (C2S protocol) through `GameTransport` -- either via WebSocket (`createWebSocketTransport`) or locally (`createLocalTransport`).
2. On the server, `handleGameDoWebSocketMessage` in `ws.ts` parses the message and routes it based on `isGameStateActionMessage`.
3. Game-state actions are dispatched through `dispatchGameStateAction` in `actions.ts`, which runs the pure engine function (`handler.run`) and then publishes the result (`handler.publish`).
4. The engine function produces a new `GameState` plus `EngineEvent[]`, never reading from storage.
5. Publication (`runPublicationPipeline`) appends events, saves checkpoints, and broadcasts the new state.

**Query side (reads):**

1. Clients receive state updates as `S2C` messages containing the full (filtered) `GameState`.
2. The `applyClientGameState` function in `game-state-store.ts` is the single write path into the client's reactive state model.
3. Replay queries use `getProjectedReplayTimeline` which rebuilds state from the event stream.
4. Reconnecting clients receive the current projected state via `getProjectedCurrentState`.
5. State is filtered per-viewer through `filterStateForPlayer` before delivery, hiding information (e.g., fugitive identity) that a player should not see.

**The command model (server) and query model (client) use different representations:**

- The server holds the authoritative `GameState` as projected from events, plus the event stream itself.
- The client holds a reactive `ClientSession` with signals (`gameStateSignal`, `stateSignal`, etc.) that drive UI rendering.
- The client never writes events -- it only receives projected state.

## Key Locations

| Purpose | File | Lines |
|---|---|---|
| Command types (C2S protocol) | `src/shared/types/protocol.ts` | (C2S type) |
| Command classification | `src/server/game-do/actions.ts` | 42-56 |
| Command dispatch (server) | `src/server/game-do/actions.ts` | 381-407 |
| Command routing (WebSocket) | `src/server/game-do/ws.ts` | 64-84 |
| Write path: publication pipeline | `src/server/game-do/publication.ts` | 90-125 |
| Read path: projected current state | `src/server/game-do/archive.ts` | 152-183 |
| Read path: replay timeline | `src/server/game-do/projection.ts` | 165-189 |
| Client state application | `src/client/game/game-state-store.ts` | 63-86 |
| Client transport interface (command) | `src/client/game/transport.ts` | 35-51 |
| Viewer filtering (read model) | `src/shared/engine/resolve-movement.ts` | 33-50 |
| Broadcast with filtering | `src/server/game-do/broadcast.ts` | 31-80 |

## Code Examples

The `GAME_STATE_ACTION_TYPES` set explicitly enumerates the command vocabulary (`src/server/game-do/actions.ts`):

```typescript
// src/server/game-do/actions.ts lines 42-56
export const GAME_STATE_ACTION_TYPES = new Set([
  'fleetReady',
  'astrogation',
  'surrender',
  'ordnance',
  'emplaceBase',
  'skipOrdnance',
  'beginCombat',
  'combat',
  'combatSingle',
  'endCombat',
  'skipCombat',
  'logistics',
  'skipLogistics',
] as const satisfies readonly C2S['type'][]);
```

Commands are split from auxiliary messages at the WebSocket level (`src/server/game-do/ws.ts`):

```typescript
// src/server/game-do/ws.ts lines 64-84
const dispatchPlayerSocketMessage = async (
  deps: Pick<GameDoWebSocketMessageDeps, ...>,
  ws: WebSocket,
  playerId: PlayerId,
  msg: C2S,
): Promise<void> => {
  await deps.touchInactivity();

  if (deps.isGameStateActionMessage(msg)) {
    await deps.dispatchGameStateAction(playerId, ws, msg);
    return;
  }

  await deps.dispatchAuxMessage(ws, playerId, msg);
};
```

On the read side, `applyClientGameState` is the sole entry point for updating the client's view model (`src/client/game/game-state-store.ts`):

```typescript
// src/client/game/game-state-store.ts lines 63-86
export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  const visibleState = projectClientVisibleState(state, deps.isSpectator);

  batch(() => {
    deps.ctx.gameState = visibleState;
    // ... selection reconciliation ...
    deps.renderer?.setGameState(visibleState);
  });
};
```

## Consistency Analysis

**Strengths:**

- The split between game-state actions and auxiliary messages is enforced by the type system (`GameStateActionMessage` vs `AuxMessage`), so the command vocabulary is closed and exhaustive.
- The `GameTransport` interface on the client mirrors the server's command set exactly, creating a clean command boundary.
- The server never returns raw engine results to the client -- everything goes through the publication pipeline, which applies viewer filtering and event persistence before broadcast.

**Weaknesses:**

- The local transport (`createLocalTransport`) blurs the CQRS boundary because it runs the engine directly on the client and applies state via `applyGameState`. There is no event persistence or projection for local games -- the command result is immediately applied as the query model. This is an intentional simplification for single-player, but it means local games lack replay and event-sourced recovery.
- The server's `getCurrentGameState` method reconstructs state from events on every read (`getProjectedCurrentStateRaw`). There is no in-memory read model cache, so high-frequency reads (e.g., during WebSocket close handling) re-project from storage each time. The checkpoint optimization helps, but a cached projection would be more efficient.
- Chat and ping messages (`AuxMessage`) bypass the command pipeline but can still trigger state-adjacent effects (opponent status, latency tracking). These are not strictly CQRS violations but they create a parallel communication channel.

## Completeness Check

- **Query optimization.** A common CQRS enhancement is materialized views that are pre-computed for specific query patterns. Delta-V partially does this with viewer-filtered broadcasts, but the replay timeline is computed on-demand rather than incrementally maintained.
- **Command validation.** All commands are validated by the engine before state mutation, which is correct. However, there is no client-side command validation (optimistic locking), so invalid commands result in server error responses rather than being prevented locally.
- **Eventual consistency model.** In online play, the client's view model is always behind the server by one network round trip. The architecture handles this gracefully -- there is no client-side prediction or speculative execution.

## Related Patterns

- **Event Sourcing** (01) -- The write-side persistence mechanism that CQRS commands feed into.
- **SRP Choke Points** (06) -- `publishStateChange` and `applyClientGameState` are the choke points for the write and read sides respectively.
- **Hexagonal Architecture** (05) -- `GameTransport` is the port through which commands flow from client to server.
