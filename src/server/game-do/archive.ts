import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import type { ViewerId } from '../../shared/engine/game-engine';
import type { GameId } from '../../shared/ids';
import { buildMatchId, type ReplayTimeline } from '../../shared/replay';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { isValidPlayerToken, type RoomConfig } from '../protocol';
import {
  ensureArchiveStreamCompatibility,
  normalizeArchivedGameState,
  normalizeArchivedStateRecord,
} from './archive-compat';
import {
  appendEventsToChunkedStream,
  getEventStreamLength as getChunkedEventStreamLength,
  matchCreatedAtKey,
  matchSeedKey,
  readChunkedEventStream,
  readChunkedEventStreamTail,
} from './archive-storage';
import {
  getProjectedCurrentStateForViewer,
  getProjectedCurrentState as getProjectedCurrentStateFromEvents,
  getProjectionParityDiff,
  hasProjectedStateParity,
  projectReplayTimeline,
} from './projection';

type Storage = DurableObjectStorage;

export { projectReplayTimeline };

export const getEventStream = async (
  storage: Storage,
  gameId: GameId,
): Promise<EventEnvelope[]> => {
  await ensureArchiveStreamCompatibility(storage, gameId);

  const chunkedStream = await readChunkedEventStream(storage, gameId);

  if (chunkedStream.length > 0) {
    return chunkedStream;
  }

  return [];
};

export const getEventStreamTail = async (
  storage: Storage,
  gameId: GameId,
  afterSeqExclusive: number,
): Promise<EventEnvelope[]> => {
  await ensureArchiveStreamCompatibility(storage, gameId);
  return readChunkedEventStreamTail(storage, gameId, afterSeqExclusive);
};

export const getEventStreamLength = async (
  storage: Storage,
  gameId: GameId,
): Promise<number> => getChunkedEventStreamLength(storage, gameId);

export const appendEnvelopedEvents = async (
  storage: Storage,
  gameId: GameId,
  actor: PlayerId | null,
  ...events: EngineEvent[]
): Promise<void> => {
  await ensureArchiveStreamCompatibility(storage, gameId);
  await appendEventsToChunkedStream(storage, gameId, actor, events);
};

// --- Checkpoints ---

const checkpointKey = (gameId: GameId): string => `checkpoint:${gameId}`;

export interface Checkpoint {
  gameId: GameId;
  seq: number;
  turn: number;
  phase: string;
  state: GameState;
  savedAt: number;
}

export const saveCheckpoint = async (
  storage: Storage,
  gameId: GameId,
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

export const getCheckpoint = async (
  storage: Storage,
  gameId: GameId,
): Promise<Checkpoint | null> =>
  normalizeArchivedStateRecord(
    (await storage.get<Checkpoint>(checkpointKey(gameId))) ?? null,
  );

// Drop the DO-side checkpoint for a game. Safe to call after the
// durable archive lands because the checkpoint is a rebuild-cache for
// the live projection path, not the source of truth — R2 holds the
// complete event stream plus checkpoint copy for replay via
// /api/matches, so nothing depends on this key after gameOver.
export const deleteCheckpoint = async (
  storage: Storage,
  gameId: GameId,
): Promise<void> => {
  await storage.delete(checkpointKey(gameId));
};

export const saveMatchCreatedAt = async (
  storage: Storage,
  gameId: GameId,
  createdAt: number,
): Promise<void> => {
  await storage.put(matchCreatedAtKey(gameId), createdAt);
};

export const getMatchCreatedAt = async (
  storage: Storage,
  gameId: GameId,
): Promise<number | null> =>
  (await storage.get<number>(matchCreatedAtKey(gameId))) ?? null;

export const getMatchSeed = async (
  storage: Storage,
  gameId: GameId,
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
  gameId: GameId,
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
  gameId: GameId,
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
  gameId: GameId,
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
  gameId: GameId,
  liveState: import('../../shared/types/domain').GameState,
): Promise<boolean> => {
  const projectedState = await getProjectedCurrentStateRaw(storage, gameId);
  return hasProjectedStateParity(projectedState, liveState);
};

export const getProjectionParityDiffFromStorage = async (
  storage: Storage,
  gameId: GameId,
  liveState: import('../../shared/types/domain').GameState,
) => {
  const projectedState = await getProjectedCurrentStateRaw(storage, gameId);
  return getProjectionParityDiff(projectedState, liveState);
};

// --- Match identity ---

export const allocateMatchIdentity = async (
  storage: Storage,
  code: string,
): Promise<{
  gameId: GameId;
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
