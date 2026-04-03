# Event Stream + Checkpoint Recovery

**Category:** Persistence & State

## Intent

Avoid replaying an unbounded event stream from the beginning when reconstructing current game state. By periodically saving a checkpoint (a full state snapshot at a known sequence number), recovery only requires loading the checkpoint and replaying the events that came after it. This bounds the replay cost to the number of events since the last checkpoint, regardless of total match length.

## How It Works in Delta-V

Delta-V persists every engine event as an `EventEnvelope` in an append-only chunked stream keyed by `gameId`. Each envelope carries a monotonically increasing `seq` number, a timestamp, the acting player, and the raw engine event.

At turn boundaries (when a `turnAdvanced` or `gameOver` event is produced), the publication pipeline saves a **checkpoint** -- a full `GameState` snapshot tagged with the current `seq`. The checkpoint state is deep-cloned via `structuredClone` and then run through `normalizeArchivedGameState` (a schema migration pass) before storage.

To recover current state, the system:

1. Loads the checkpoint for the game (if any).
2. Reads only the **tail** of the event stream -- events with `seq` greater than the checkpoint's `seq`.
3. Feeds the checkpoint state plus the tail events into `projectGameStateFromStream`, which replays each event through the event projector to produce the current state.

If no checkpoint exists, the full event stream is replayed from event 1. If neither exists, the state is null.

The same mechanism powers two distinct read paths:

- **Live state recovery** (`getProjectedCurrentStateRaw`): checkpoint + tail, used for parity checks and reconnection.
- **Replay timeline construction** (`getProjectedReplayTimeline`): loads the full event stream for complete history, but still uses the checkpoint as a fallback starting point when the archive is incomplete.

## Key Locations

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/game-do/archive.ts` | 72-108 | Checkpoint type, `saveCheckpoint`, `getCheckpoint` |
| `src/server/game-do/archive.ts` | 152-183 | `getProjectedCurrentState`, `getProjectedCurrentStateRaw` -- checkpoint + tail recovery |
| `src/server/game-do/archive.ts` | 33-55 | `getEventStream`, `getEventStreamTail` -- stream read APIs |
| `src/server/game-do/projection.ts` | 45-56 | `projectCurrentStateFromStream` -- feeds checkpoint state into event projector |
| `src/server/game-do/projection.ts` | 76-129 | `toReplayEntriesFromStream` -- handles checkpoint fallback for replay |
| `src/server/game-do/publication.ts` | 51-64 | `checkpointIfNeeded` -- triggers checkpoint on turn boundaries |
| `src/shared/engine/event-projector/index.ts` | 65-93 | `projectGameStateFromStream` -- replays events onto an initial state |
| `src/server/game-do/archive-compat.ts` | 1-26 | Schema migration on checkpoint load |

## Code Examples

Checkpoint save, triggered by the publication pipeline at turn boundaries:

```ts
// src/server/game-do/publication.ts, lines 51-64
const checkpointIfNeeded = async (
  storage: DurableObjectStorage,
  gameId: string,
  state: GameState,
  eventSeq: number,
  events: EngineEvent[],
): Promise<void> => {
  const hasTurnBoundary = events.some(
    (e) => e.type === 'turnAdvanced' || e.type === 'gameOver',
  );
  if (hasTurnBoundary) {
    await saveCheckpoint(storage, gameId, state, eventSeq);
  }
};
```

Checkpoint persistence with deep clone and normalization:

```ts
// src/server/game-do/archive.ts, lines 85-100
export const saveCheckpoint = async (
  storage: Storage,
  gameId: string,
  state: import('../../shared/types/domain').GameState,
  seq: number,
): Promise<void> => {
  const checkpoint: Checkpoint = {
    gameId,
    seq,
    turn: state.turnNumber,
    phase: state.phase,
    state: normalizeArchivedGameState(structuredClone(state)),
    savedAt: Date.now(),
  };
  await storage.put(checkpointKey(gameId), checkpoint);
};
```

Recovery via checkpoint + tail:

```ts
// src/server/game-do/archive.ts, lines 171-183
export const getProjectedCurrentStateRaw = async (
  storage: Storage,
  gameId: string,
): Promise<import('../../shared/types/domain').GameState | null> => {
  const checkpoint = await getCheckpoint(storage, gameId);
  const eventStreamTail = await getEventStreamTail(
    storage,
    gameId,
    checkpoint?.seq ?? 0,
  );

  return getProjectedCurrentStateFromEvents(eventStreamTail, checkpoint);
};
```

The event projector clones the checkpoint state before mutating:

```ts
// src/shared/engine/event-projector/index.ts, lines 65-74
export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    // ...project each event onto state
  }
```

## Consistency Analysis

The pattern is applied consistently:

- **Checkpoint triggers are centralized** in `checkpointIfNeeded`, called from the single `runPublicationPipeline` function. Every state change flows through this pipeline, so checkpoints cannot be accidentally skipped.
- **Both recovery paths** (live state and replay) correctly handle the case where no checkpoint exists, falling back to full stream replay.
- **Schema migration** is applied both when saving (`normalizeArchivedGameState` in `saveCheckpoint`) and when loading (`normalizeArchivedStateRecord` in `getCheckpoint`), ensuring forward compatibility.
- **Deep cloning** via `structuredClone` prevents the checkpoint from holding references to the live state object.

## Completeness Check

**Recovery is well tested.** The test suite (`archive.test.ts`) covers:
- Checkpoint save/retrieve round-trip
- Deep clone isolation (mutating original state does not affect checkpoint)
- Checkpoint + tail projection producing correct current state
- Stale checkpoint overridden by newer tail events
- Full game flow parity between live state and projected state
- Fallback when no checkpoint exists

**Potential edge cases:**

1. **Checkpoint frequency:** Checkpoints only fire at turn boundaries. A long turn with many within-turn events (e.g., many combat rounds) could accumulate a significant tail. This is acceptable because within-turn event counts are bounded by game mechanics.

2. **Checkpoint-event consistency:** The checkpoint is saved in the same publication pipeline call that appends the events, but they are separate `storage.put` calls rather than a single atomic batch. In theory, a crash between the event append and checkpoint save could leave the checkpoint stale -- but this is benign since the tail replay will cover the gap.

3. **No checkpoint pruning for old matches:** Old match checkpoints remain in storage indefinitely. The `archiveRoomState` cleanup handles room-level teardown but checkpoint data for individual matches persists until the Durable Object is evicted.

## Related Patterns

- **Chunked Event Storage (Pattern 33):** The event stream that this pattern reads from is stored in fixed-size chunks, affecting how tail reads are performed.
- **Parity Check (Pattern 32):** After every state publication, the projected state (recovered via checkpoint + tail) is compared against the live state to detect divergence.
- **Mutable Clone Pattern (Pattern 35):** The `structuredClone` call in `saveCheckpoint` and `projectGameStateFromStream` follows the same defensive cloning discipline used by engine entry points.
