# Chunked Event Storage

**Category:** Persistence & State

## Intent

Avoid storing an ever-growing array of events in a single Durable Object storage key. Cloudflare Durable Object storage has per-key size limits and serialization costs that scale with value size. By splitting the event stream into fixed-size chunks, each storage read/write only touches a bounded amount of data. Appending new events only rewrites the current (partially full) chunk rather than the entire stream.

## How It Works in Delta-V

The event stream for each match is stored across multiple storage keys following a naming convention:

- `events:{gameId}:chunk:{chunkIndex}` -- each chunk holds up to `EVENT_CHUNK_SIZE` (64) event envelopes.
- `eventChunkCount:{gameId}` -- tracks how many chunks exist.
- `eventSeq:{gameId}` -- the highest sequence number in the stream.

**Appending events** (`appendEventsToChunkedStream`):
1. Reads the current chunk count and sequence number.
2. For each new event, computes which chunk it belongs to based on `Math.floor((seq - 1) / EVENT_CHUNK_SIZE)`.
3. Loads the target chunk if it has not already been loaded in this batch.
4. Pushes the new envelope onto the chunk.
5. Writes all modified chunks, the updated chunk count, and the new sequence number in a **single batched `storage.put` call**.

**Reading the full stream** (`readChunkedEventStream`):
Loads all chunks sequentially from index 0 to `chunkCount - 1` and concatenates them.

**Reading a tail** (`readChunkedEventStreamTail`):
Computes the starting chunk index from the requested `afterSeqExclusive` value, then only loads chunks from that index onward, filtering individual envelopes by sequence number.

**Legacy migration** (`migrateLegacyEventStreamIfNeeded`):
Detects streams stored under the old single-key format (`events:{gameId}`) and rewrites them into chunks. This is called lazily before any stream read or write via `ensureArchiveStreamCompatibility`.

## Key Locations

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/game-do/archive-storage.ts` | 1-18 | Key naming functions, `EVENT_CHUNK_SIZE` constant |
| `src/server/game-do/archive-storage.ts` | 20-55 | `writeChunkedEventStream` -- bulk write for migration |
| `src/server/game-do/archive-storage.ts` | 57-76 | `migrateLegacyEventStreamIfNeeded` -- lazy migration |
| `src/server/game-do/archive-storage.ts` | 78-95 | `readChunkedEventStream` -- full stream read |
| `src/server/game-do/archive-storage.ts` | 97-126 | `readChunkedEventStreamTail` -- partial tail read |
| `src/server/game-do/archive-storage.ts` | 128-131 | `getEventStreamLength` -- reads seq counter |
| `src/server/game-do/archive-storage.ts` | 133-176 | `appendEventsToChunkedStream` -- incremental append |
| `src/server/game-do/archive-compat.ts` | 20-25 | `ensureArchiveStreamCompatibility` -- migration trigger |

## Code Examples

The append operation batches all writes into a single `storage.put`:

```ts
// src/server/game-do/archive-storage.ts, lines 133-176
export const appendEventsToChunkedStream = async (
  storage: Storage,
  gameId: string,
  actor: PlayerId | null,
  events: EngineEvent[],
): Promise<void> => {
  if (events.length === 0) return;

  const chunkCount = await getEventChunkCount(storage, gameId);
  let seq = (await storage.get<number>(eventSeqKey(gameId))) ?? 0;
  const now = Date.now();
  const updatedChunks = new Map<number, EventEnvelope[]>();
  let nextChunkCount = chunkCount;

  for (const event of events) {
    const nextSeq = seq + 1;
    const chunkIndex = Math.floor((nextSeq - 1) / EVENT_CHUNK_SIZE);
    const currentChunk =
      updatedChunks.get(chunkIndex) ??
      (await getEventChunk(storage, gameId, chunkIndex));

    currentChunk.push({
      gameId,
      seq: nextSeq,
      ts: now,
      actor,
      event,
    });
    updatedChunks.set(chunkIndex, currentChunk);
    seq = nextSeq;
    nextChunkCount = Math.max(nextChunkCount, chunkIndex + 1);
  }

  const entries: Record<string, unknown> = {};

  for (const [chunkIndex, chunk] of updatedChunks) {
    entries[eventChunkKey(gameId, chunkIndex)] = chunk;
  }

  entries[eventChunkCountKey(gameId)] = nextChunkCount;
  entries[eventSeqKey(gameId)] = seq;

  await storage.put(entries);
};
```

Tail read starting from the correct chunk:

```ts
// src/server/game-do/archive-storage.ts, lines 97-126
export const readChunkedEventStreamTail = async (
  storage: Storage,
  gameId: string,
  afterSeqExclusive: number,
): Promise<EventEnvelope[]> => {
  const chunkCount = await getEventChunkCount(storage, gameId);

  if (chunkCount === 0) {
    return [];
  }

  const stream: EventEnvelope[] = [];
  const startChunkIndex = Math.max(
    0,
    Math.floor(afterSeqExclusive / EVENT_CHUNK_SIZE),
  );

  for (
    let chunkIndex = startChunkIndex;
    chunkIndex < chunkCount;
    chunkIndex++
  ) {
    const chunk = await getEventChunk(storage, gameId, chunkIndex);
    stream.push(
      ...chunk.filter((envelope) => envelope.seq > afterSeqExclusive),
    );
  }

  return stream;
};
```

## Consistency Analysis

**Strengths:**

- **Atomic batch writes:** All modified chunks, the chunk count, and the sequence counter are written in a single `storage.put(entries)` call. This prevents partial writes from leaving the stream in an inconsistent state.
- **Lazy legacy migration:** Old single-array streams are automatically converted on first access, with no separate migration step needed.
- **Chunk boundary spill is correct:** The test suite verifies that appending 70 events (crossing the 64-event chunk boundary) preserves sequence continuity.

**The chunk size of 64 is a reasonable choice:**
- Each engine event is a small JSON object (typically 100-500 bytes serialized).
- A full chunk of 64 events is roughly 6-32 KB -- well within Durable Object storage value limits (128 KB).
- A typical match generates 100-300 events, meaning 2-5 chunks total, keeping full-stream reads to a small number of storage operations.

## Completeness Check

**Well tested.** The test suite covers:
- Spill across chunk boundaries (70 events, `archive.test.ts` line 320-341)
- Tail read from specific sequence (`archive.test.ts` line 343-361)
- Legacy migration on read and append (`archive.test.ts` lines 122-145, 363-393)
- Batched write verification via `put` spy (`archive.test.ts` lines 194-213)
- Empty event array no-op (`archive.test.ts` lines 298-305)
- Match isolation across rematches (`archive.test.ts` lines 268-296)

**Potential concerns:**

1. **Sequential chunk reads:** `readChunkedEventStream` loads chunks in a sequential `for` loop with `await` per iteration. For matches with many chunks, parallel reads via `Promise.all` would be faster. In practice, most matches produce fewer than 5 chunks, so this is not a significant concern.

2. **No chunk compaction:** Once written, chunks are never rewritten to consolidate partially-full trailing chunks. The last chunk of a completed match may be partially full. This wastes minimal storage since chunks are small.

3. **Tail read chunk index calculation:** The formula `Math.floor(afterSeqExclusive / EVENT_CHUNK_SIZE)` for `startChunkIndex` may read one extra chunk when `afterSeqExclusive` falls exactly on a boundary, since events in that chunk could all have `seq <= afterSeqExclusive`. The per-envelope filter ensures correctness regardless.

4. **No streaming/pagination API:** The full stream read loads all events into memory. For very long matches or replay construction, this could be significant, but is bounded by the game's natural event count limits.

## Related Patterns

- **Event Stream + Checkpoint Recovery (Pattern 31):** Checkpoints reduce the need to read the full chunked stream -- only the tail chunks after the checkpoint sequence are needed.
- **Parity Check (Pattern 32):** Parity verification reads the event stream through this chunked storage layer.
