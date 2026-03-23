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
  type ProjectionFrame,
  parseMatchId,
  type ReplayArchive,
  type ReplayEntry,
  type ReplayMessage,
  toProjectionFrame,
  toReplayEntryFromProjectionFrame,
} from '../../shared/replay';
import type { Phase } from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';

type Storage = DurableObjectStorage;

const MAX_EVENTS = 500;

const projectionFramesKey = (gameId: string): string => `projection:${gameId}`;

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

export const getProjectionFrames = async (
  storage: Storage,
  gameId: string,
): Promise<ProjectionFrame[]> =>
  (await storage.get<ProjectionFrame[]>(projectionFramesKey(gameId))) ?? [];

export const saveProjectionFrames = async (
  storage: Storage,
  gameId: string,
  frames: ProjectionFrame[],
): Promise<void> => {
  await storage.put(projectionFramesKey(gameId), frames);
};

export const appendProjectionMessage = async (
  storage: Storage,
  gameId: string,
  eventSeq: number,
  message: ReplayMessage,
): Promise<void> => {
  const recordedAt = Date.now();
  const frames = await getProjectionFrames(storage, gameId);

  frames.push(
    toProjectionFrame(frames.length + 1, eventSeq, message, recordedAt),
  );
  await saveProjectionFrames(storage, gameId, frames);
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

const getLatestProjectedState = (
  projectionFrames: ProjectionFrame[],
  checkpoint: Checkpoint | null,
): import('../../shared/types/domain').GameState | null =>
  projectionFrames.at(-1)?.message.state ??
  (projectionFrames.length > 0 ? null : checkpoint?.state) ??
  null;

export const getProjectedCurrentState = async (
  storage: Storage,
  gameId: string,
  viewerId: ViewerId,
): Promise<import('../../shared/types/domain').GameState | null> => {
  const [projectionFrames, checkpoint] = await Promise.all([
    getProjectionFrames(storage, gameId),
    getCheckpoint(storage, gameId),
  ]);

  const latestState = getLatestProjectedState(projectionFrames, checkpoint);

  if (!latestState) {
    return null;
  }

  return filterStateForPlayer(latestState, viewerId);
};

export const getProjectedCurrentStateRaw = async (
  storage: Storage,
  gameId: string,
): Promise<import('../../shared/types/domain').GameState | null> => {
  const [projectionFrames, checkpoint] = await Promise.all([
    getProjectionFrames(storage, gameId),
    getCheckpoint(storage, gameId),
  ]);

  return getLatestProjectedState(projectionFrames, checkpoint);
};

export const hasProjectionParity = async (
  storage: Storage,
  gameId: string,
  liveState: import('../../shared/types/domain').GameState,
): Promise<boolean> => {
  const projectedState = await getProjectedCurrentStateRaw(storage, gameId);

  return (
    projectedState !== null &&
    JSON.stringify(projectedState) === JSON.stringify(liveState)
  );
};

const toReplayEntriesFromFrames = (
  frames: ProjectionFrame[],
  checkpoint: Checkpoint | null,
): ReplayEntry[] => {
  const startIndex =
    checkpoint === null
      ? 0
      : frames.findIndex((frame) => frame.eventSeq > checkpoint.seq);
  const visibleFrames =
    checkpoint === null
      ? frames
      : startIndex === -1
        ? []
        : frames.slice(startIndex);

  const entries = checkpoint ? [toCheckpointReplayEntry(checkpoint)] : [];

  for (const frame of visibleFrames) {
    entries.push({
      ...toReplayEntryFromProjectionFrame(frame),
      sequence: entries.length + 1,
    });
  }

  return entries;
};

const createProjectedArchiveMetadata = (
  gameId: string,
  projectionFrames: ProjectionFrame[],
  checkpoint: Checkpoint | null,
): Pick<
  ReplayArchive,
  'gameId' | 'roomCode' | 'matchNumber' | 'scenario' | 'createdAt'
> | null => {
  const parsed = parseMatchId(gameId);
  const firstFrame = projectionFrames[0];
  const scenario =
    firstFrame?.message.state.scenario ?? checkpoint?.state.scenario ?? '';
  const createdAt = firstFrame?.recordedAt ?? checkpoint?.savedAt ?? 0;

  if (!parsed && !checkpoint && !firstFrame) {
    return null;
  }

  return {
    gameId,
    roomCode: parsed?.roomCode ?? '',
    matchNumber: parsed?.matchNumber ?? 0,
    scenario,
    createdAt,
  };
};

export const projectReplayArchive = (
  checkpoint: Checkpoint | null,
  projectionFrames: ProjectionFrame[],
  viewerId: ViewerId,
): ReplayArchive | null => {
  const baseArchive = (() => {
    if (projectionFrames.length > 0) {
      const metadata = createProjectedArchiveMetadata(
        projectionFrames[0].message.state.gameId,
        projectionFrames,
        checkpoint,
      );

      if (!metadata) {
        return null;
      }

      return {
        ...metadata,
        entries: toReplayEntriesFromFrames(projectionFrames, checkpoint),
      };
    }

    return checkpoint
      ? {
          gameId: checkpoint.gameId,
          roomCode: '',
          matchNumber: 0,
          scenario: checkpoint.state.scenario,
          createdAt: checkpoint.savedAt,
          entries: [toCheckpointReplayEntry(checkpoint)],
        }
      : null;
  })();

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
  const [checkpoint, projectionFrames] = await Promise.all([
    getCheckpoint(storage, gameId),
    getProjectionFrames(storage, gameId),
  ]);

  return projectReplayArchive(checkpoint, projectionFrames, viewerId);
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
