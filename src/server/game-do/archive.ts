import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import { filterStateForPlayer } from '../../shared/engine/game-engine';
import {
  buildMatchId,
  createReplayArchive,
  type ReplayArchive,
  type ReplayMessage,
  toReplayEntry,
} from '../../shared/replay';
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
  playerId: number,
): ReplayArchive => ({
  ...archive,
  entries: archive.entries.map((entry) => ({
    ...entry,
    message: {
      ...entry.message,
      state: filterStateForPlayer(entry.message.state, playerId),
    },
  })),
});

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
