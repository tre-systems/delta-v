import type { PlayerId } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';

export interface HostedMcpBufferedEvent {
  id: number;
  message: S2C;
  receivedAt: number;
  type: S2C['type'];
}

const MAX_BUFFERED_EVENTS_PER_SEAT = 200;

const eventsKey = (playerId: PlayerId): string => `mcpEvents:${playerId}`;
const eventSeqKey = (playerId: PlayerId): string => `mcpEventSeq:${playerId}`;
const enabledKey = (playerId: PlayerId): string => `mcpEnabled:${playerId}`;

export const enableHostedMcpSeatEvents = async (
  storage: DurableObjectStorage,
  playerId: PlayerId,
): Promise<void> => {
  await storage.put(enabledKey(playerId), true);
};

export const appendHostedMcpSeatEvent = async (
  storage: DurableObjectStorage,
  playerId: PlayerId,
  message: S2C,
): Promise<void> => {
  const [enabled, current, nextIdRaw] = await Promise.all([
    storage.get<boolean>(enabledKey(playerId)),
    storage.get<HostedMcpBufferedEvent[]>(eventsKey(playerId)),
    storage.get<number>(eventSeqKey(playerId)),
  ]);
  if (!enabled) {
    return;
  }
  const nextId = nextIdRaw ?? 1;
  const events = current ?? [];
  events.push({
    id: nextId,
    receivedAt: Date.now(),
    type: message.type,
    message,
  });
  const trimmed = events.slice(-MAX_BUFFERED_EVENTS_PER_SEAT);
  await storage.put({
    [eventsKey(playerId)]: trimmed,
    [eventSeqKey(playerId)]: nextId + 1,
  });
};

export const readHostedMcpSeatEvents = async (
  storage: DurableObjectStorage,
  playerId: PlayerId,
  options?: {
    afterEventId?: number;
    limit?: number;
    clear?: boolean;
  },
): Promise<{
  bufferedRemaining: number;
  events: HostedMcpBufferedEvent[];
  latestEventId: number;
}> => {
  const [stored, nextIdRaw] = await Promise.all([
    storage.get<HostedMcpBufferedEvent[]>(eventsKey(playerId)),
    storage.get<number>(eventSeqKey(playerId)),
  ]);
  const events = stored ?? [];
  const filtered = events.filter((event) =>
    options?.afterEventId === undefined
      ? true
      : event.id > options.afterEventId,
  );
  const selected = filtered.slice(-(options?.limit ?? 50));
  if (options?.clear) {
    await storage.put(eventsKey(playerId), []);
  }
  return {
    events: selected,
    bufferedRemaining: options?.clear ? 0 : events.length,
    latestEventId: (nextIdRaw ?? 1) - 1,
  };
};

export const clearHostedMcpSeatEvents = async (
  storage: DurableObjectStorage,
  playerId: PlayerId,
): Promise<void> => {
  await storage.put(eventsKey(playerId), []);
};

export const clearAllHostedMcpSessionState = async (
  storage: DurableObjectStorage,
): Promise<void> => {
  await storage.put({
    [eventsKey(0)]: [],
    [eventsKey(1)]: [],
    [eventSeqKey(0)]: 1,
    [eventSeqKey(1)]: 1,
    [enabledKey(0)]: false,
    [enabledKey(1)]: false,
  });
};
