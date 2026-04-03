# Single State-Bearing Message

## Category

Protocol & Communication

## Intent

Ensure that every game-state mutation results in exactly one authoritative S2C message containing the full updated `GameState`, so clients never have to reconstruct state from a stream of deltas. This eliminates a whole class of sync bugs where partial updates are applied out of order or missed.

## How It Works in Delta-V

When a player action mutates game state, the server engine returns the next `GameState` plus optional side-channel data (movement paths, combat results, engine events). The server wraps that into a single S2C message and broadcasts it. The client receives the message, replaces its local `GameState` wholesale, and then uses the side-channel data for animations.

The key S2C messages that carry state are:

- `gameStart` -- initial state after fleet building / scenario setup
- `stateUpdate` -- generic state push (logistics, fleet ready, emplacement, etc.)
- `movementResult` -- state plus movement paths, ordnance movements, and events
- `combatResult` -- state plus an array of combat results
- `combatSingleResult` -- state plus a single combat result

Each of these has `state: GameState` as a required field. The `StatefulServerMessage` type in `message-builders.ts` unifies them.

The action handler pattern in `actions.ts` enforces this: every `GameStateActionHandler` has a `run` method that returns `{ state: GameState; engineEvents: EngineEvent[] }` and a `publish` method that broadcasts the state-bearing message. The `publishStateChange` pipeline in `publication.ts` then appends event envelopes, saves checkpoints, and broadcasts filtered state.

## Key Locations

- `src/shared/types/protocol.ts` (lines 66-91) -- S2C variants with `state: GameState`
- `src/server/game-do/message-builders.ts` -- `toStateUpdateMessage`, `toMovementResultMessage`, `toCombatSingleResultMessage`
- `src/server/game-do/actions.ts` (lines 107-323) -- action handlers returning `StatefulActionSuccess`
- `src/server/game-do/broadcast.ts` (lines 82-101) -- `broadcastStateChange`
- `src/server/game-do/publication.ts` -- `runPublicationPipeline`

## Code Examples

S2C message with embedded state:

```typescript
| {
    type: 'movementResult';
    movements: ShipMovement[];
    ordnanceMovements: OrdnanceMovement[];
    events: MovementEvent[];
    state: GameState;
  }
| {
    type: 'combatResult';
    results: CombatResult[];
    state: GameState;
  }
| {
    type: 'stateUpdate';
    state: GameState;
    transferEvents?: LogisticsTransferLogEvent[];
  }
```

Action handler structure enforcing one-state-per-action:

```typescript
export type GameStateActionHandler<T extends GameStateActionType> = {
  run: (
    gameState: GameState,
    playerId: PlayerId,
    message: GameStateActionMessageOf<T>,
  ) => StatefulActionSuccess | EngineFailure;
  publish: (playerId: PlayerId, result: StatefulActionSuccess) => Promise<void>;
};
```

## Consistency Analysis

The pattern is consistently applied across all game-state actions. Every handler's `run` method returns the full next `GameState`, and every `publish` method wraps it in an S2C message. Non-state messages (`error`, `pong`, `chat`, `opponentStatus`, `gameOver`) correctly do not carry a `GameState` field.

The `gameOver` message is intentionally separate from the state-bearing message. `broadcastStateChange` sends the state-bearing message first, then sends `gameOver` as a follow-up if the game has ended. This means two messages are sent at game end, but the state message still contains the authoritative terminal state.

## Completeness Check

- **Full state on every message**: This is bandwidth-heavy for large fleets. The architecture doc notes this is a deliberate trade-off: full-state messages are simpler and safer than delta patching. If bandwidth becomes a concern, delta compression is a future optimisation path.
- **No optimistic updates**: The client does not speculatively apply state changes. It waits for the authoritative response. This is correct for a turn-based game but means user actions feel as slow as the round trip.
- **Reconnection**: When a player reconnects, the server sends a fresh `stateUpdate` with current state. The single-state-bearing-message pattern means reconnection requires no special replay logic -- just one message.

## Related Patterns

- **47 -- Discriminated Union Messages**: The `type` discriminant determines which side-channel data accompanies the state.
- **49 -- Viewer-Aware Filtering**: The `state` field is filtered per-viewer before broadcast.
- **50 -- Hibernatable WebSocket**: State-bearing messages are what wake the DO from hibernation.
