# Event Sourcing

**Category:** Architectural

## Intent

Capture every state-changing operation as an immutable domain event so that the full game state can be reconstructed from the event stream alone. This enables match replay, projection parity verification, and a durable audit trail without storing mutable snapshots as the primary source of truth.

## How It Works in Delta-V

Delta-V records every meaningful game mutation as an `EngineEvent` wrapped in an `EventEnvelope`. The envelope adds metadata -- a monotonic sequence number, timestamp, actor (player ID), and game ID -- so events can be stored, streamed, and replayed deterministically.

The flow works as follows:

1. **Event emission at the engine layer.** Every engine entry point (`processAstrogation`, `processCombat`, `processFleetReady`, etc.) returns an `engineEvents: EngineEvent[]` array alongside the new `GameState`. The engine itself is pure -- it never persists events.

2. **Enveloping and persistence.** The server's publication pipeline (`publication.ts`) calls `appendEnvelopedEvents` in `archive.ts`, which wraps raw events in `EventEnvelope` objects (assigning `seq`, `ts`, `actor`) and writes them to chunked Durable Object storage via `archive-storage.ts`.

3. **Projection.** The event projector (`event-projector/index.ts`) can rebuild `GameState` from a stream of `EventEnvelope` objects. It delegates to category-specific projectors -- `lifecycle.ts`, `ships.ts`, `conflict.ts` -- through an exhaustive switch over event types.

4. **Checkpointing.** At turn boundaries and game-over, `saveCheckpoint` persists a full `GameState` snapshot. Projection can start from the most recent checkpoint rather than replaying the entire stream, via `getEventStreamTail`.

5. **Parity verification.** After every state publication, the server verifies that the event-projected state matches the live engine state (`hasProjectedStateParity`), catching any drift between the two representations.

6. **Replay.** The `projectReplayTimeline` function builds a `ReplayTimeline` from the full event stream, filtering per-player hidden information via `filterStateForPlayer`.

## Key Locations

| Purpose | File | Lines |
|---|---|---|
| Event type definitions | `src/shared/engine/engine-events.ts` | 1-240 |
| Event envelope (seq, ts, actor) | `src/shared/engine/engine-events.ts` | 234-240 |
| Archive (append, checkpoint, replay) | `src/server/game-do/archive.ts` | 33-206 |
| Chunked storage implementation | `src/server/game-do/archive-storage.ts` | full file |
| Publication pipeline (Steps 1-6) | `src/server/game-do/publication.ts` | 37-125 |
| Event projector dispatch | `src/shared/engine/event-projector/index.ts` | 9-98 |
| Lifecycle projector | `src/shared/engine/event-projector/lifecycle.ts` | 14-245 |
| Ship projector | `src/shared/engine/event-projector/ships.ts` | full file |
| Conflict projector | `src/shared/engine/event-projector/conflict.ts` | full file |
| Projection parity check | `src/server/game-do/projection.ts` | 191-206 |
| Replay timeline builder | `src/server/game-do/projection.ts` | 165-189 |
| RNG capture test (dice in events) | `src/shared/engine/rng-capture.test.ts` | full file |

## Code Examples

Every engine function returns events alongside state. For example, `processAstrogation` in `src/shared/engine/astrogation.ts`:

```typescript
// src/shared/engine/astrogation.ts lines 123-177
export const processAstrogation = (
  inputState: GameState,
  playerId: PlayerId,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  // ... validation ...

  engineEvents.push({
    type: 'astrogationOrdersCommitted',
    playerId,
    orders: structuredClone(orders),
  });

  // ... movement resolution adds more events ...
  return {
    ...result,
    engineEvents: [...engineEvents, ...result.engineEvents],
  };
};
```

Events are appended to storage in the publication pipeline (`src/server/game-do/publication.ts`):

```typescript
// src/server/game-do/publication.ts lines 37-48
const appendEvents = async (
  storage: DurableObjectStorage,
  gameId: string,
  actor: PlayerId | null,
  events: EngineEvent[],
): Promise<number> => {
  if (events.length === 0) {
    return getEventStreamLength(storage, gameId);
  }
  await appendEnvelopedEvents(storage, gameId, actor, ...events);
  return getEventStreamLength(storage, gameId);
};
```

The projector rebuilds state by folding events (`src/shared/engine/event-projector/index.ts`):

```typescript
// src/shared/engine/event-projector/index.ts lines 65-93
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
    if (!projected.ok) {
      return projected;
    }
    state = projected.value;
  }

  return state === null
    ? { ok: false, error: 'empty event stream' }
    : { ok: true, value: state };
};
```

## Consistency Analysis

**Strengths:**

- Every engine entry point consistently returns `engineEvents` alongside state. The pattern is uniform across all 13 game-state action types defined in `actions.ts`.
- The `rng-capture.test.ts` file explicitly verifies that all non-deterministic outcomes (dice rolls, damage) are captured as explicit facts in emitted events, so replay never depends on re-running the same random sequence.
- The `clone-on-entry.test.ts` file verifies that engine functions do not mutate their input state, which is critical for event sourcing correctness.
- Parity verification runs after every publication, catching drift early.

**Potential gaps:**

- The `createGame` function (game-creation.ts) does not emit events for the initial game creation. Instead, the `gameCreated` event is emitted separately by the server match initialization flow. The projector handles this by calling `createGame` inside the `gameCreated` event projection, but it means game creation is a special case outside the normal engine-returns-events pattern.
- The `advanceTurn` function in `turn-advance.ts` mutates state directly (damage recovery, player rotation, reinforcement spawning) and emits a single `turnAdvanced` event. The projector for `turnAdvanced` reimplements the damage recovery logic independently. If turn-advance logic changes, both the engine and projector must be updated in sync -- there is no shared implementation.
- Fleet conversion (`applyFleetConversion` in `turn-advance.ts`) changes ship ownership but does not emit a dedicated event for this mutation. The turn-advance projector does not account for it either, which could cause projection parity drift in scenarios using fleet conversion.

## Completeness Check

- **Snapshotting strategy is sound.** Checkpoints at turn boundaries plus tail replay from the latest checkpoint is a standard optimization.
- **Missing: event versioning.** Events do not carry a schema version field. The `archive-compat.ts` module handles state migration, but event schema evolution would benefit from explicit versioning.
- **Missing: event compaction.** There is no mechanism to compact old event streams. For long matches, the full event stream grows unboundedly within Durable Object storage.
- **Missing: explicit `gameCreated` emission from the engine.** Having the server emit this event separately creates a coupling between server initialization and the event model.

## Related Patterns

- **CQRS** (02) -- Event sourcing is the write-side mechanism; projections serve the read side.
- **Stateless Pure Engine** (07) -- The engine emits events without persisting them; purity enables deterministic replay.
- **SRP Choke Points** (06) -- `publishStateChange` is the single entry point for event persistence and broadcast.
