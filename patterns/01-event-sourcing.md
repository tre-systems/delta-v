# Event Sourcing

**Category:** Architectural

## Intent

Capture state changes as an append-only stream of domain events so the system can reconstruct match state, verify replay correctness, and retain an audit trail without treating mutable snapshots as the source of truth.

## How It Works in Delta-V

Delta-V persists `EngineEvent` values inside `EventEnvelope` records. The envelope adds:

- `gameId`
- `seq`
- `ts`
- `actor`

The write path is:

1. engine functions return `state` plus `engineEvents`
2. the server publication pipeline wraps and appends those events
3. checkpoints are saved at turn boundaries and game over
4. the event projector rebuilds state from checkpoint + tail or full history
5. parity verification compares projected state with live state after publication

## Key Locations

| File | Role |
|---|---|
| `src/shared/engine/engine-events.ts` | event and envelope definitions |
| `src/server/game-do/publication.ts` | append/checkpoint/parity/broadcast pipeline |
| `src/server/game-do/archive.ts` | append, checkpoint, replay, storage access |
| `src/shared/engine/event-projector/` | projection handlers |
| `src/server/game-do/projection.ts` | parity and replay timeline helpers |

## Code Examples

Engine actions return events alongside state:

```typescript
engineEvents.push({
  type: 'astrogationOrdersCommitted',
  playerId,
  orders: structuredClone(orders),
});

return {
  ...result,
  engineEvents: [...engineEvents, ...result.engineEvents],
};
```

Publication appends the emitted events:

```typescript
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

Projection folds the stream:

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
    const projected = projectEvent(state, envelope.event, envelope.gameId, map);

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

- Incremental engine actions consistently emit facts rather than persisting state directly.
- Replay, parity, and archive tooling all consume the same event model.
- Checkpoints are an optimization layered on top of the event stream, not a replacement for it.

**Current gaps:**

- Initial game creation is still a special case: the server emits `gameCreated` and any `fugitiveDesignated` events outside the normal engine-action return path.
- `turnAdvanced` currently under-specifies some scenario-rule mutations. `advanceTurn()` applies reinforcements and fleet conversion in memory, but the projector's `turnAdvanced` handling replays only player rotation and damage recovery.
- The event model carries `matchSeed` on `gameCreated`, but the current setup path does not fully use that seed to rebuild initial randomized setup.

## Completeness Check

- The next improvement is to make turn-advance side effects explicit in the event model or to share the mutation logic between engine and projector.
- Setup-time randomness should be reproducible directly from the event stream rather than relying on corrective follow-up events.

## Related Patterns

- **Visitor (Event Projection)** (14) — the projector is the replay mechanism.
- **Event Stream + Checkpoint Recovery** (31) — checkpoints bound replay cost.
- **Parity Check** (32) — parity validates that event sourcing still matches live state.
