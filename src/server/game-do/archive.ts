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
import type { Phase } from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';

type Storage = DurableObjectStorage;
const map = buildSolarSystemMap();

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
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
): import('../../shared/types/domain').GameState | null => {
  const tail =
    checkpoint === null
      ? eventStream
      : eventStream.filter((envelope) => envelope.seq > checkpoint.seq);
  const projected = projectGameStateFromStream(
    tail,
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
  const [eventStream, checkpoint] = await Promise.all([
    getEventStream(storage, gameId),
    getCheckpoint(storage, gameId),
  ]);

  const latestState = projectCurrentStateFromStream(eventStream, checkpoint);

  if (!latestState) {
    return null;
  }

  return filterStateForPlayer(latestState, viewerId);
};

export const getProjectedCurrentStateRaw = async (
  storage: Storage,
  gameId: string,
): Promise<import('../../shared/types/domain').GameState | null> => {
  const [eventStream, checkpoint] = await Promise.all([
    getEventStream(storage, gameId),
    getCheckpoint(storage, gameId),
  ]);

  return projectCurrentStateFromStream(eventStream, checkpoint);
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

const toReplayEntriesFromStream = (
  eventStream: EventEnvelope[],
  checkpoint: Checkpoint | null,
): ReplayEntry[] => {
  const visibleEvents =
    checkpoint === null
      ? eventStream
      : eventStream.filter((envelope) => envelope.seq > checkpoint.seq);
  const entries = checkpoint ? [toCheckpointReplayEntry(checkpoint)] : [];
  let currentState = checkpoint?.state ?? null;

  for (const envelope of visibleEvents) {
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
  const [checkpoint, eventStream, createdAt] = await Promise.all([
    getCheckpoint(storage, gameId),
    getEventStream(storage, gameId),
    getMatchCreatedAt(storage, gameId),
  ]);

  return projectReplayTimeline(checkpoint, eventStream, viewerId, createdAt);
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
