import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  buildMatchId,
  createReplayArchive,
  type ReplayArchive,
  type ReplayMessage,
  toReplayEntry,
} from '../../shared/replay';

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
