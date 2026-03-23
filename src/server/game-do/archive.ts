import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import { projectGameStateFromStream } from '../../shared/engine/event-projector';
import {
  filterStateForPlayer,
  type ViewerId,
} from '../../shared/engine/game-engine';
import { buildSolarSystemMap } from '../../shared/map-data';
import {
  buildMatchId,
  parseMatchId,
  type ReplayEntry,
  type ReplayMessage,
  type ReplayTimeline,
  toReplayEntry,
} from '../../shared/replay';
import {
  CURRENT_GAME_STATE_SCHEMA_VERSION,
  type GameState,
  type Phase,
} from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';

type Storage = DurableObjectStorage;
const map = buildSolarSystemMap();

// --- Match-scoped event stream ---

const eventStreamKey = (gameId: string): string => `events:${gameId}`;
const eventChunkKey = (gameId: string, chunkIndex: number): string =>
  `events:${gameId}:chunk:${chunkIndex}`;
const eventChunkCountKey = (gameId: string): string =>
  `eventChunkCount:${gameId}`;
const eventSeqKey = (gameId: string): string => `eventSeq:${gameId}`;
const matchCreatedAtKey = (gameId: string): string =>
  `matchCreatedAt:${gameId}`;
const matchSeedKey = (gameId: string): string => `matchSeed:${gameId}`;
const EVENT_CHUNK_SIZE = 64;

const migrateGameState = (state: GameState): GameState => ({
  ...state,
  schemaVersion: state.schemaVersion ?? CURRENT_GAME_STATE_SCHEMA_VERSION,
});

const migrateCheckpoint = (checkpoint: Checkpoint | null): Checkpoint | null =>
  checkpoint
    ? {
        ...checkpoint,
        state: migrateGameState(checkpoint.state),
      }
    : null;

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

const migrateLegacyEventStreamIfNeeded = async (
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

const readChunkedEventStream = async (
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

const readChunkedEventStreamTail = async (
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

export const getEventStream = async (
  storage: Storage,
  gameId: string,
): Promise<EventEnvelope[]> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);

  const chunkedStream = await readChunkedEventStream(storage, gameId);

  if (chunkedStream.length > 0) {
    return chunkedStream;
  }

  return (await storage.get<EventEnvelope[]>(eventStreamKey(gameId))) ?? [];
};

export const getEventStreamTail = async (
  storage: Storage,
  gameId: string,
  afterSeqExclusive: number,
): Promise<EventEnvelope[]> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);

  const chunkCount = await getEventChunkCount(storage, gameId);

  if (chunkCount > 0) {
    return readChunkedEventStreamTail(storage, gameId, afterSeqExclusive);
  }

  return (await getEventStream(storage, gameId)).filter(
    (envelope) => envelope.seq > afterSeqExclusive,
  );
};

export const getEventStreamLength = async (
  storage: Storage,
  gameId: string,
): Promise<number> => (await storage.get<number>(eventSeqKey(gameId))) ?? 0;

export const appendEnvelopedEvents = async (
  storage: Storage,
  gameId: string,
  actor: number | null,
  ...events: EngineEvent[]
): Promise<void> => {
  if (events.length === 0) return;

  await migrateLegacyEventStreamIfNeeded(storage, gameId);
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

// --- Checkpoints ---

const checkpointKey = (gameId: string): string => `checkpoint:${gameId}`;

export interface Checkpoint {
  gameId: string;
  seq: number;
  turn: number;
  phase: string;
  state: GameState;
  savedAt: number;
}

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
    state: migrateGameState(structuredClone(state)),
    savedAt: Date.now(),
  };
  await storage.put(checkpointKey(gameId), checkpoint);
};

export const getCheckpoint = async (
  storage: Storage,
  gameId: string,
): Promise<Checkpoint | null> =>
  migrateCheckpoint(
    (await storage.get<Checkpoint>(checkpointKey(gameId))) ?? null,
  );

export const saveMatchCreatedAt = async (
  storage: Storage,
  gameId: string,
  createdAt: number,
): Promise<void> => {
  await storage.put(matchCreatedAtKey(gameId), createdAt);
};

export const getMatchCreatedAt = async (
  storage: Storage,
  gameId: string,
): Promise<number | null> =>
  (await storage.get<number>(matchCreatedAtKey(gameId))) ?? null;

export const getMatchSeed = async (
  storage: Storage,
  gameId: string,
): Promise<number | null> =>
  (await storage.get<number>(matchSeedKey(gameId))) ?? null;

// --- Replay viewer identity ---

export const getReplayViewerId = (
  roomConfig: RoomConfig,
  presentedTokenRaw: string | null,
  requestedViewerRaw: string | null = null,
): ViewerId | null => {
  if (!presentedTokenRaw || !isValidPlayerToken(presentedTokenRaw)) {
    return requestedViewerRaw === 'spectator' ? 'spectator' : null;
  }

  if (roomConfig.playerTokens[0] === presentedTokenRaw) {
    return 0;
  }

  if (roomConfig.playerTokens[1] === presentedTokenRaw) {
    return 1;
  }

  return requestedViewerRaw === 'spectator' ? 'spectator' : null;
};

export const filterReplayTimelineForViewer = (
  timeline: ReplayTimeline,
  viewerId: ViewerId,
): ReplayTimeline => ({
  ...timeline,
  entries: timeline.entries.map((entry) => ({
    ...entry,
    message: {
      ...entry.message,
      state: filterStateForPlayer(entry.message.state, viewerId),
    },
  })),
});

const toCheckpointReplayEntry = (checkpoint: Checkpoint): ReplayEntry => ({
  sequence: 1,
  recordedAt: checkpoint.savedAt,
  turn: checkpoint.turn,
  phase: checkpoint.phase as Phase,
  message: {
    type: 'stateUpdate',
    state: structuredClone(checkpoint.state),
  } satisfies ReplayMessage,
});

const projectCurrentStateFromStream = (
  eventStreamTail: EventEnvelope[],
  checkpoint: Checkpoint | null,
): import('../../shared/types/domain').GameState | null => {
  const projected = projectGameStateFromStream(
    eventStreamTail,
    map,
    checkpoint?.state ?? null,
  );

  return projected.ok ? projected.state : null;
};

export const getProjectedCurrentState = async (
  storage: Storage,
  gameId: string,
  viewerId: ViewerId,
): Promise<import('../../shared/types/domain').GameState | null> => {
  const checkpoint = await getCheckpoint(storage, gameId);
  const eventStreamTail = await getEventStreamTail(
    storage,
    gameId,
    checkpoint?.seq ?? 0,
  );

  const latestState = projectCurrentStateFromStream(
    eventStreamTail,
    checkpoint,
  );

  if (!latestState) {
    return null;
  }

  return filterStateForPlayer(latestState, viewerId);
};

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

  return projectCurrentStateFromStream(eventStreamTail, checkpoint);
};

const toReplayEntriesFromStream = (
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
): ReplayEntry[] => {
  const hasFullHistory = eventStream.some(
    (envelope) => envelope.event.type === 'gameCreated',
  );
  const replayStream =
    checkpoint && !hasFullHistory
      ? eventStream.filter((envelope) => envelope.seq > checkpoint.seq)
      : eventStream;
  const useCheckpointFallback = checkpoint !== null && !hasFullHistory;
  const entries = useCheckpointFallback
    ? [toCheckpointReplayEntry(checkpoint)]
    : [];
  let currentState = useCheckpointFallback ? checkpoint.state : null;

  for (const envelope of replayStream) {
    const projected = projectGameStateFromStream([envelope], map, currentState);

    if (!projected.ok) {
      continue;
    }

    const nextState = projected.state;
    const previousSerialized =
      currentState === null ? null : JSON.stringify(currentState);
    const nextSerialized = JSON.stringify(nextState);

    currentState = nextState;

    if (previousSerialized === nextSerialized) {
      continue;
    }

    entries.push(
      toReplayEntry(
        entries.length + 1,
        entries.length === 0
          ? {
              type: 'gameStart',
              state: nextState,
            }
          : {
              type: 'stateUpdate',
              state: nextState,
            },
        envelope.ts,
      ),
    );
  }

  return entries;
};

const createProjectedTimelineMetadata = (
  gameId: string,
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
  createdAt: number | null,
): Pick<
  ReplayTimeline,
  'gameId' | 'roomCode' | 'matchNumber' | 'scenario' | 'createdAt'
> | null => {
  const parsed = parseMatchId(gameId);
  const gameCreated = eventStream.find(
    (envelope) => envelope.event.type === 'gameCreated',
  );
  const scenario =
    checkpoint?.state.scenario ??
    (gameCreated?.event.type === 'gameCreated'
      ? gameCreated.event.scenario
      : '');
  const replayCreatedAt =
    createdAt ?? gameCreated?.ts ?? checkpoint?.savedAt ?? 0;

  if (!parsed && !checkpoint && !gameCreated) {
    return null;
  }

  return {
    gameId,
    roomCode: parsed?.roomCode ?? '',
    matchNumber: parsed?.matchNumber ?? 0,
    scenario,
    createdAt: replayCreatedAt,
  };
};

export const projectReplayTimeline = (
  checkpoint: Checkpoint | null,
  eventStream: EventEnvelope[],
  viewerId: ViewerId,
  createdAt: number | null = null,
): ReplayTimeline | null => {
  const baseTimeline = (() => {
    if (eventStream.length > 0 || checkpoint) {
      const metadata = createProjectedTimelineMetadata(
        checkpoint?.gameId ?? eventStream[0]?.gameId ?? '',
        eventStream,
        checkpoint,
        createdAt,
      );

      if (!metadata) {
        return null;
      }

      return {
        ...metadata,
        entries: toReplayEntriesFromStream(eventStream, checkpoint),
      };
    }
    return null;
  })();

  if (!baseTimeline) {
    return null;
  }

  return filterReplayTimelineForViewer(baseTimeline, viewerId);
};

export const getProjectedReplayTimeline = async (
  storage: Storage,
  gameId: string,
  viewerId: ViewerId,
): Promise<ReplayTimeline | null> => {
  const [checkpoint, createdAt] = await Promise.all([
    getCheckpoint(storage, gameId),
    getMatchCreatedAt(storage, gameId),
  ]);
  const eventStream = await getEventStream(storage, gameId);

  return projectReplayTimeline(checkpoint, eventStream, viewerId, createdAt);
};

const normalizeStateForParity = (
  state: import('../../shared/types/domain').GameState,
): import('../../shared/types/domain').GameState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    connected: false,
  })) as import('../../shared/types/domain').GameState['players'],
});

export const hasProjectionParity = async (
  storage: Storage,
  gameId: string,
  liveState: import('../../shared/types/domain').GameState,
): Promise<boolean> => {
  const projectedState = await getProjectedCurrentStateRaw(storage, gameId);

  return (
    projectedState !== null &&
    JSON.stringify(normalizeStateForParity(projectedState)) ===
      JSON.stringify(normalizeStateForParity(liveState))
  );
};

// --- Match identity ---

export const allocateMatchIdentity = async (
  storage: Storage,
  code: string,
): Promise<{
  gameId: string;
  matchNumber: number;
  matchSeed: number;
}> => {
  const matchNumber = ((await storage.get<number>('matchNumber')) ?? 0) + 1;
  const gameId = buildMatchId(code, matchNumber);
  const seedBuf = new Uint32Array(1);
  crypto.getRandomValues(seedBuf);
  const matchSeed = seedBuf[0];

  await storage.put('matchNumber', matchNumber);
  await storage.put(matchSeedKey(gameId), matchSeed);

  return { gameId, matchNumber, matchSeed };
};
