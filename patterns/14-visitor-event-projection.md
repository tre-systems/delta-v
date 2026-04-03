# Visitor (Event Projection)

## Category

Behavioral

## Intent

Reconstruct game state from an ordered stream of domain events by dispatching each event to a type-specific projection handler. This is a variant of the Visitor pattern where the "visitor" is a projection function that visits each event node and accumulates state, enabling event sourcing, replay, and server-client state synchronization.

## How It Works in Delta-V

The event projection system is the foundation of Delta-V's state management. Rather than sending full game state snapshots, the server emits granular `EngineEvent` values. The client (and server for verification) can reconstruct the complete `GameState` by projecting events sequentially.

### Event Types (`engine-events.ts`)

`EngineEvent` is a discriminated union with 30+ event types organized by domain:

- **Lifecycle**: `gameCreated`, `phaseChanged`, `turnAdvanced`, `gameOver`, `fleetPurchased`, `astrogationOrdersCommitted`, `ordnanceLaunchesCommitted`, `logisticsTransfersCommitted`, `surrenderDeclared`, `fugitiveDesignated`, `identityRevealed`, `checkpointVisited`
- **Ship**: `shipMoved`, `shipLanded`, `shipCrashed`, `shipDestroyed`, `shipCaptured`, `asteroidDestroyed`, `baseDestroyed`, `shipResupplied`, `fuelTransferred`, `cargoTransferred`, `passengersTransferred`, `shipSurrendered`, `baseEmplaced`
- **Conflict**: `ordnanceLaunched`, `ordnanceMoved`, `ordnanceExpired`, `ordnanceDetonated`, `ramming`, `ordnanceDestroyed`, `combatAttack`

Events are wrapped in `EventEnvelope` with metadata (gameId, sequence number, timestamp, actor).

### Projection Dispatch (`event-projector/index.ts`)

The top-level `projectEvent` function uses a switch on `event.type` to dispatch to one of three category-specific projectors. A `default` branch with `never` typing ensures exhaustive coverage -- adding a new event type without a handler is a compile error.

### Category Projectors

Each projector is a pure function: `(state: GameState | null, event: E) => Result<GameState>`.

- **`projectLifecycleEvent`** (`lifecycle.ts`) -- Handles game creation, phase changes, turn advancement, fleet purchases, and game over. The `gameCreated` event bootstraps state from scratch.
- **`projectShipEvent`** (`ships.ts`) -- Handles all ship state mutations: movement, landing, crashing, destruction, capture, resupply, fuel/cargo/passenger transfers, surrender, and base emplacement.
- **`projectConflictEvent`** (`conflict.ts`) -- Handles ordnance lifecycle (launch, move, expire, detonate, destroy), ramming, and combat attacks.

### Support Utilities (`support.ts`)

- `requireState` -- Validates that state exists before non-creation events
- `requireShip` / `requireOrdnance` -- Safe entity lookup returning `Result`
- `migrateGameState` -- Handles schema version migration
- `cloneGravityEffects` -- Deep clones gravity effect arrays
- `resolveScenarioByName` -- Maps scenario name to definition

### Stream Projection (`index.ts`)

`projectGameStateFromStream` folds the entire event array through `projectEvent`, threading state through each step. It supports starting from an existing checkpoint state for efficiency.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/shared/engine/engine-events.ts` | 1-241 | `EngineEvent` union + `EventEnvelope` |
| `src/shared/engine/event-projector/index.ts` | 1-99 | Dispatch + `projectGameStateFromStream` |
| `src/shared/engine/event-projector/lifecycle.ts` | 1-246 | Lifecycle event projection |
| `src/shared/engine/event-projector/ships.ts` | 1-348 | Ship event projection |
| `src/shared/engine/event-projector/conflict.ts` | 1-229 | Conflict event projection |
| `src/shared/engine/event-projector/support.ts` | 1-116 | Shared utilities |
| `src/shared/engine/event-projector.ts` | -- | Integration tests |
| `src/shared/engine/event-projector.test.ts` | -- | Tests |

## Code Examples

Top-level dispatch (`index.ts`):

```typescript
const projectEvent = (
  state: GameState | null,
  envelope: EventEnvelope,
  map: SolarSystemMap,
): Result<GameState> => {
  const event = envelope.event;

  switch (event.type) {
    case 'gameCreated':
    case 'fleetPurchased':
    case 'phaseChanged':
    case 'turnAdvanced':
    case 'gameOver':
      // ... lifecycle events
      return projectLifecycleEvent(state, event, envelope.gameId, map);

    case 'shipMoved':
    case 'shipLanded':
    case 'shipCrashed':
    case 'shipDestroyed':
      // ... ship events
      return projectShipEvent(state, event);

    case 'ordnanceLaunched':
    case 'combatAttack':
      // ... conflict events
      return projectConflictEvent(state, event);

    default: {
      const unreachable: never = event;
      return { ok: false, error: `unsupported event: ${String(unreachable)}` };
    }
  }
};
```

Ship movement projection (`ships.ts`):

```typescript
case 'shipMoved': {
  const baseState = requireState(state, event.type);
  if (!baseState.ok) return baseState;
  state = baseState.value;
  state.pendingAstrogationOrders = null;
  const projectedShip = requireShip(state, event.shipId);
  if (!projectedShip.ok) return projectedShip;

  projectedShip.value.position = { ...event.to };
  projectedShip.value.lastMovementPath = event.path.map((hex) => ({ ...hex }));
  projectedShip.value.velocity = { ...event.newVelocity };
  projectedShip.value.fuel = event.fuelRemaining;
  projectedShip.value.lifecycle = event.lifecycle;
  projectedShip.value.overloadUsed = event.overloadUsed;
  projectedShip.value.pendingGravityEffects =
    cloneGravityEffects(event.pendingGravityEffects);

  return { ok: true, value: state };
}
```

Stream projection:

```typescript
export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    const projected = projectEvent(state, envelope, map);
    if (!projected.ok) return projected;
    state = projected.value;
  }

  return state === null
    ? { ok: false, error: 'empty event stream' }
    : { ok: true, value: state };
};
```

## Consistency Analysis

**Strengths:**

- Every event type in `EngineEvent` is handled. The `never` guard in each projector's default case makes unhandled events a compile error.
- The `Result<T>` return type (`{ok: true, value: T} | {ok: false, error: string}`) provides consistent error handling without exceptions.
- State validation is consistent: every handler calls `requireState` first, then `requireShip`/`requireOrdnance` as needed. Invalid references produce typed errors rather than crashes.
- Each projector is a pure function of `(state, event) -> Result<state>`, making them individually testable.
- Event types are grouped into three categories by their `support.ts` type aliases (`LifecycleProjectionEvent`, `ShipProjectionEvent`, `ConflictProjectionEvent`), which enforces that each projector only handles its category.

**Are all event types handled?**

Yes. The three category type aliases in `support.ts` exactly partition the `EngineEvent` union:
- `LifecycleProjectionEvent`: 12 types
- `ShipProjectionEvent`: 13 types
- `ConflictProjectionEvent`: 7 types
- Total: 32 event types, matching the `EngineEvent` union

Each category projector has exhaustive switch statements with `never` defaults.

**Potential gaps:**

- The projectors mutate the `GameState` object in place (e.g., `projectedShip.value.position = { ...event.to }`). This is by design for performance in the fold, but callers must be careful not to reuse projected state across independent projections without cloning.
- `structuredClone` is used in `projectGameStateFromStream` when starting from a checkpoint, which is correct but expensive. For large game states, this could be a performance concern.
- The `fuelTransferred` / `cargoTransferred` / `passengersTransferred` events share a handler via fallthrough. This is clean but means adding a new transfer type requires updating this combined case.

## Completeness Check

- All 32 `EngineEvent` types have projection handlers.
- The system supports both full replay (from empty state) and incremental projection (from checkpoint).
- Error handling is consistent: every failure path returns `{ok: false, error: string}`.
- The `migrateGameState` function handles schema evolution, though currently it only sets a version field.
- Server-side verification (`verifyProjectionParity` in `publication.ts`) re-projects events and compares with the authoritative state, catching projection bugs in production.

## Related Patterns

- **Pipeline** (15) -- `projectGameStateFromStream` is a sequential pipeline that folds events through the projector.
- **Derive/Plan** (12) -- Each projector derives new state from events, similar to how derive functions compute plans from inputs.
- **State Machine** (09) -- The `phaseChanged` and `turnAdvanced` events drive the game's phase state machine through the projector.
- **Command** (08) -- Engine events are the server-side analog of client commands: they represent actions that have been validated and committed.
