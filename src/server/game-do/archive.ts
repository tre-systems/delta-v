import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import type { ViewerId } from '../../shared/engine/game-engine';
import { buildMatchId, type ReplayTimeline } from '../../shared/replay';
import {
  CURRENT_GAME_STATE_SCHEMA_VERSION,
  type GameState,
  type PlayerId,
} from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';
import {
  appendEventsToChunkedStream,
  getEventStreamLength as getChunkedEventStreamLength,
  matchCreatedAtKey,
  matchSeedKey,
  migrateLegacyEventStreamIfNeeded,
  readChunkedEventStream,
  readChunkedEventStreamTail,
} from './archive-storage';
import {
  getProjectedCurrentStateForViewer,
  getProjectedCurrentState as getProjectedCurrentStateFromEvents,
  hasProjectedStateParity,
  projectReplayTimeline,
} from './projection';

type Storage = DurableObjectStorage;

export { projectReplayTimeline };

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

export const getEventStream = async (
  storage: Storage,
  gameId: string,
): Promise<EventEnvelope[]> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);

  const chunkedStream = await readChunkedEventStream(storage, gameId);

  if (chunkedStream.length > 0) {
    return chunkedStream;
  }

  return [];
};

export const getEventStreamTail = async (
  storage: Storage,
  gameId: string,
  afterSeqExclusive: number,
): Promise<EventEnvelope[]> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);
  return readChunkedEventStreamTail(storage, gameId, afterSeqExclusive);
};

export const getEventStreamLength = async (
  storage: Storage,
  gameId: string,
): Promise<number> => getChunkedEventStreamLength(storage, gameId);

export const appendEnvelopedEvents = async (
  storage: Storage,
  gameId: string,
  actor: PlayerId | null,
  ...events: EngineEvent[]
): Promise<void> => {
  await migrateLegacyEventStreamIfNeeded(storage, gameId);
  await appendEventsToChunkedStream(storage, gameId, actor, events);
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

  return getProjectedCurrentStateForViewer(
    eventStreamTail,
    checkpoint,
    viewerId,
  );
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

  return getProjectedCurrentStateFromEvents(eventStreamTail, checkpoint);
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

export const hasProjectionParity = async (
  storage: Storage,
  gameId: string,
  liveState: import('../../shared/types/domain').GameState,
): Promise<boolean> => {
  const projectedState = await getProjectedCurrentStateRaw(storage, gameId);
  return hasProjectedStateParity(projectedState, liveState);
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
