import { describe, expect, it, vi } from 'vitest';

import type { PlayerId } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import {
  appendHostedMcpSeatEvent,
  clearAllHostedMcpSessionState,
  clearHostedMcpSeatEvents,
  readHostedMcpSeatEvents,
} from './mcp-session-state';

const buildStorageStub = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(
      async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') {
          data.set(key, value);
          return true;
        }
        for (const [entryKey, entryValue] of Object.entries(key)) {
          data.set(entryKey, entryValue);
        }
        return true;
      },
    ),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
      return true;
    }),
  } as unknown as DurableObjectStorage;
};

const chat = (text: string): S2C => ({
  type: 'chat',
  playerId: 0 as PlayerId,
  text,
});

describe('mcp-session-state', () => {
  it('appends events with monotonic ids and exposes latestEventId', async () => {
    const storage = buildStorageStub();

    await appendHostedMcpSeatEvent(storage, 0, chat('one'));
    await appendHostedMcpSeatEvent(storage, 0, chat('two'));

    const result = await readHostedMcpSeatEvents(storage, 0, { limit: 250 });
    expect(result.events.map((event) => event.id)).toEqual([1, 2]);
    expect(result.latestEventId).toBe(2);
    expect(result.bufferedRemaining).toBe(2);
  });

  it('filters afterEventId, enforces limit, and preserves bufferedRemaining when not clearing', async () => {
    const storage = buildStorageStub();
    await appendHostedMcpSeatEvent(storage, 0, chat('one'));
    await appendHostedMcpSeatEvent(storage, 0, chat('two'));
    await appendHostedMcpSeatEvent(storage, 0, chat('three'));

    const result = await readHostedMcpSeatEvents(storage, 0, {
      afterEventId: 1,
      limit: 1,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe(3);
    expect(result.bufferedRemaining).toBe(3);
    expect(result.latestEventId).toBe(3);
  });

  it('clears seat events without rewinding the sequence counter', async () => {
    const storage = buildStorageStub();
    await appendHostedMcpSeatEvent(storage, 0, chat('one'));
    await appendHostedMcpSeatEvent(storage, 0, chat('two'));

    const cleared = await readHostedMcpSeatEvents(storage, 0, { clear: true });
    expect(cleared.bufferedRemaining).toBe(0);
    expect(await storage.get('mcpEvents:0')).toEqual([]);

    await appendHostedMcpSeatEvent(storage, 0, chat('three'));
    const result = await readHostedMcpSeatEvents(storage, 0, { limit: 250 });
    expect(result.events.map((event) => event.id)).toEqual([3]);
    expect(result.latestEventId).toBe(3);
  });

  it('clearHostedMcpSeatEvents only clears the requested seat', async () => {
    const storage = buildStorageStub();
    await appendHostedMcpSeatEvent(storage, 0, chat('a'));
    await appendHostedMcpSeatEvent(storage, 1, chat('b'));

    await clearHostedMcpSeatEvents(storage, 0);

    expect(await storage.get('mcpEvents:0')).toEqual([]);
    const seatOne = await readHostedMcpSeatEvents(storage, 1);
    expect(seatOne.events).toHaveLength(1);
    expect(seatOne.events[0]?.id).toBe(1);
  });

  it('clearAllHostedMcpSessionState resets both seats and both counters', async () => {
    const storage = buildStorageStub();
    await appendHostedMcpSeatEvent(storage, 0, chat('a'));
    await appendHostedMcpSeatEvent(storage, 1, chat('b'));

    await clearAllHostedMcpSessionState(storage);

    expect(await storage.get('mcpEvents:0')).toEqual([]);
    expect(await storage.get('mcpEvents:1')).toEqual([]);
    expect(await storage.get('mcpEventSeq:0')).toBe(1);
    expect(await storage.get('mcpEventSeq:1')).toBe(1);
  });

  it('trims the buffered event window to the most recent 200 entries', async () => {
    const storage = buildStorageStub();
    for (let index = 0; index < 205; index += 1) {
      await appendHostedMcpSeatEvent(storage, 0, chat(`event-${index}`));
    }

    const result = await readHostedMcpSeatEvents(storage, 0, { limit: 250 });
    expect(result.events).toHaveLength(200);
    expect(result.events[0]?.id).toBe(6);
    expect(result.events.at(-1)?.id).toBe(205);
    expect(result.latestEventId).toBe(205);
  });
});
