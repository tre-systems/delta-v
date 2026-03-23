import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import {
  filterStateForPlayer,
  type ViewerId,
} from '../../shared/engine/game-engine';
import {
  buildMatchId,
  createReplayArchive,
  type ReplayArchive,
  type ReplayEntry,
  type ReplayMessage,
  toReplayEntry,
} from '../../shared/replay';
import type { Phase } from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';

type Storage = DurableObjectStorage;

const MAX_EVENTS = 500;

const replayKey = (gameId: string): string => `replayArchive:${gameId}`;

// --- Event log ---

export const getEventLog = async (storage: Storage): Promise<EngineEvent[]> =>
  (await storage.get<EngineEvent[]>('eventLog')) ?? [];

export const appendEvents = async (
  storage: Storage,
  ...events: EngineEvent[]
): Promise<void> => {
  const log = await getEventLog(storage);
  log.push(...events);

  if (log.length > MAX_EVENTS) {
    log.splice(0, log.length - MAX_EVENTS);
  }
  await storage.put('eventLog', log);
};

export const resetEventLog = async (storage: Storage): Promise<void> => {
  await storage.put('eventLog', []);
};

// --- Match-scoped event stream ---

const eventStreamKey = (gameId: string): string => `events:${gameId}`;
const eventSeqKey = (gameId: string): string => `eventSeq:${gameId}`;
const matchCreatedAtKey = (gameId: string): string =>
  `matchCreatedAt:${gameId}`;

export const getEventStream = async (
  storage: Storage,
  gameId: string,
): Promise<EventEnvelope[]> =>
  (await storage.get<EventEnvelope[]>(eventStreamKey(gameId))) ?? [];

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

  const stream = await getEventStream(storage, gameId);
  let seq = (await storage.get<number>(eventSeqKey(gameId))) ?? 0;
  const now = Date.now();

  for (const event of events) {
    seq++;
    stream.push({ gameId, seq, ts: now, actor, event });
  }

  await storage.put(eventStreamKey(gameId), stream);
  await storage.put(eventSeqKey(gameId), seq);
};

// --- Checkpoints ---

const checkpointKey = (gameId: string): string => `checkpoint:${gameId}`;

export interface Checkpoint {
  gameId: string;
  seq: number;
  turn: number;
  phase: string;
  state: import('../../shared/types/domain').GameState;
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
    state: structuredClone(state),
    savedAt: Date.now(),
  };
  await storage.put(checkpointKey(gameId), checkpoint);
};

export const getCheckpoint = async (
  storage: Storage,
  gameId: string,
): Promise<Checkpoint | null> =>
  (await storage.get<Checkpoint>(checkpointKey(gameId))) ?? null;

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

// --- Replay archive ---

export const getReplayArchive = async (
  storage: Storage,
  gameId: string,
): Promise<ReplayArchive | null> =>
  (await storage.get<ReplayArchive>(replayKey(gameId))) ?? null;

export const saveReplayArchive = async (
  storage: Storage,
  archive: ReplayArchive,
): Promise<void> => {
  await storage.put(replayKey(archive.gameId), archive);
};

export const appendReplayMessage = async (
  storage: Storage,
  roomCode: string,
  matchNumber: number,
  message: ReplayMessage,
): Promise<void> => {
  const recordedAt = Date.now();
  const existing = await getReplayArchive(storage, message.state.gameId);

  if (!existing) {
    await saveReplayArchive(
      storage,
      createReplayArchive(roomCode, matchNumber, message, recordedAt),
    );
    return;
  }

  existing.entries.push(
    toReplayEntry(existing.entries.length + 1, message, recordedAt),
  );
  await saveReplayArchive(storage, existing);
};

// --- Replay viewer identity ---

export const getReplayViewerId = (
  roomConfig: RoomConfig,
  presentedTokenRaw: string | null,
): 0 | 1 | null => {
  if (!presentedTokenRaw || !isValidPlayerToken(presentedTokenRaw)) {
    return null;
  }

  if (roomConfig.playerTokens[0] === presentedTokenRaw) {
    return 0;
  }

  if (roomConfig.playerTokens[1] === presentedTokenRaw) {
    return 1;
  }

  return null;
};

export const filterReplayArchiveForPlayer = (
  archive: ReplayArchive,
  viewerId: ViewerId,
): ReplayArchive => ({
  ...archive,
  entries: archive.entries.map((entry) => ({
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

export const projectReplayArchive = (
  archive: ReplayArchive | null,
  checkpoint: Checkpoint | null,
  viewerId: ViewerId,
): ReplayArchive | null => {
  const baseArchive =
    archive ??
    (checkpoint
      ? {
          gameId: checkpoint.gameId,
          roomCode: '',
          matchNumber: 0,
          scenario: checkpoint.state.scenario,
          createdAt: checkpoint.savedAt,
          entries: [toCheckpointReplayEntry(checkpoint)],
        }
      : null);

  if (!baseArchive) {
    return null;
  }

  return filterReplayArchiveForPlayer(baseArchive, viewerId);
};

export const getProjectedReplayArchive = async (
  storage: Storage,
  gameId: string,
  viewerId: ViewerId,
): Promise<ReplayArchive | null> => {
  const [archive, checkpoint] = await Promise.all([
    getReplayArchive(storage, gameId),
    getCheckpoint(storage, gameId),
  ]);

  return projectReplayArchive(archive, checkpoint, viewerId);
};

// --- Match identity ---

export const allocateMatchIdentity = async (
  storage: Storage,
  code: string,
): Promise<{
  gameId: string;
  matchNumber: number;
}> => {
  const matchNumber = ((await storage.get<number>('matchNumber')) ?? 0) + 1;
  await storage.put('matchNumber', matchNumber);
  return {
    gameId: buildMatchId(code, matchNumber),
    matchNumber,
  };
};
