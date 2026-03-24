import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';

type Storage = DurableObjectStorage;

const eventStreamKey = (gameId: string): string => `events:${gameId}`;
const eventChunkKey = (gameId: string, chunkIndex: number): string =>
  `events:${gameId}:chunk:${chunkIndex}`;
const eventChunkCountKey = (gameId: string): string =>
  `eventChunkCount:${gameId}`;
const eventSeqKey = (gameId: string): string => `eventSeq:${gameId}`;

export const matchCreatedAtKey = (gameId: string): string =>
  `matchCreatedAt:${gameId}`;
export const matchSeedKey = (gameId: string): string => `matchSeed:${gameId}`;

const EVENT_CHUNK_SIZE = 64;

const getEventChunkCount = async (
  storage: Storage,
  gameId: string,
): Promise<number> =>
  (await storage.get<number>(eventChunkCountKey(gameId))) ?? 0;

const getEventChunk = async (
  storage: Storage,
  gameId: string,
  chunkIndex: number,
): Promise<EventEnvelope[]> =>
  (await storage.get<EventEnvelope[]>(eventChunkKey(gameId, chunkIndex))) ?? [];

const writeChunkedEventStream = async (
  storage: Storage,
  gameId: string,
  stream: EventEnvelope[],
): Promise<void> => {
  const chunkCount =
    stream.length === 0 ? 0 : Math.ceil(stream.length / EVENT_CHUNK_SIZE);

  const entries: Record<string, unknown> = {};

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const start = chunkIndex * EVENT_CHUNK_SIZE;
    const end = start + EVENT_CHUNK_SIZE;
    entries[eventChunkKey(gameId, chunkIndex)] = stream.slice(start, end);
  }

  entries[eventChunkCountKey(gameId)] = chunkCount;
  entries[eventSeqKey(gameId)] = stream.at(-1)?.seq ?? 0;

  await storage.put(entries);
};

export const migrateLegacyEventStreamIfNeeded = async (
  storage: Storage,
  gameId: string,
): Promise<void> => {
  const chunkCount = await getEventChunkCount(storage, gameId);

  if (chunkCount > 0) {
    return;
  }

  const legacyStream = await storage.get<EventEnvelope[]>(
    eventStreamKey(gameId),
  );

  if (!legacyStream || legacyStream.length === 0) {
    return;
  }

  await writeChunkedEventStream(storage, gameId, legacyStream);
};

export const readChunkedEventStream = async (
  storage: Storage,
  gameId: string,
): Promise<EventEnvelope[]> => {
  const chunkCount = await getEventChunkCount(storage, gameId);

  if (chunkCount === 0) {
    return [];
  }

  const stream: EventEnvelope[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    stream.push(...(await getEventChunk(storage, gameId, chunkIndex)));
  }

  return stream;
};

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

export const getEventStreamLength = async (
  storage: Storage,
  gameId: string,
): Promise<number> => (await storage.get<number>(eventSeqKey(gameId))) ?? 0;

export const appendEventsToChunkedStream = async (
  storage: Storage,
  gameId: string,
  actor: number | null,
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
