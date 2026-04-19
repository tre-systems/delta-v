import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { type LiveMatchEntry, LiveRegistryDO } from './live-registry-do';

// Minimal DurableObjectState stub backed by a Map.
const createStubCtx = () => {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;

  const storage = {
    get: vi.fn(async (keyOrKeys: string | string[]) => {
      if (Array.isArray(keyOrKeys)) {
        const map = new Map<string, unknown>();
        for (const k of keyOrKeys) {
          if (data.has(k)) map.set(k, data.get(k));
        }
        return map;
      }
      return data.get(keyOrKeys);
    }),
    put: vi.fn(
      async (keyOrObj: string | Record<string, unknown>, value?: unknown) => {
        if (typeof keyOrObj === 'string') {
          data.set(keyOrObj, value);
        } else {
          for (const [k, v] of Object.entries(keyOrObj)) {
            data.set(k, v);
          }
        }
      },
    ),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
      return true;
    }),
    getAlarm: vi.fn(async () => alarm),
    setAlarm: vi.fn(async (ts: number) => {
      alarm = ts;
    }),
  } as unknown as DurableObjectStorage;

  return {
    storage,
    waitUntil: vi.fn(),
    getWebSockets: vi.fn(() => []),
    getTags: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
  } as unknown as DurableObjectState;
};

const createDO = () => {
  const ctx = createStubCtx();
  const env = {} as Record<string, unknown>;
  const doObj = new LiveRegistryDO(ctx, env as never);
  return { doObj, ctx };
};

const register = (doObj: LiveRegistryDO, entry: LiveMatchEntry) =>
  doObj.fetch(
    new Request('https://live-registry.internal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }),
  );

const deregister = (doObj: LiveRegistryDO, code: string) =>
  doObj.fetch(
    new Request(`https://live-registry.internal/deregister/${code}`, {
      method: 'DELETE',
    }),
  );

const list = async (doObj: LiveRegistryDO) => {
  const res = await doObj.fetch(
    new Request('https://live-registry.internal/list', { method: 'GET' }),
  );
  return (await res.json()) as { matches: LiveMatchEntry[] };
};

describe('LiveRegistryDO', () => {
  it('registers a match and returns it from the listing', async () => {
    const { doObj } = createDO();
    const entry: LiveMatchEntry = {
      code: 'ABCDE',
      scenario: 'duel',
      startedAt: Date.now(),
    };

    const regRes = await register(doObj, entry);
    expect(regRes.status).toBe(200);

    const { matches } = await list(doObj);
    expect(matches).toHaveLength(1);
    expect(matches[0].code).toBe('ABCDE');
    expect(matches[0].scenario).toBe('duel');
  });

  it('reports whether a player key is currently active', async () => {
    const { doObj } = createDO();
    await doObj.fetch(
      new Request('https://live-registry.internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'ABCDE',
          scenario: 'duel',
          startedAt: Date.now(),
          playerKeys: ['player_a', 'player_b'],
        }),
      }),
    );

    const active = await doObj.fetch(
      new Request('https://live-registry.internal/active-player/player_a', {
        method: 'GET',
      }),
    );
    const inactive = await doObj.fetch(
      new Request('https://live-registry.internal/active-player/player_z', {
        method: 'GET',
      }),
    );

    await expect(active.json()).resolves.toEqual({
      active: true,
      code: 'ABCDE',
      scenario: 'duel',
    });
    await expect(inactive.json()).resolves.toEqual({ active: false });
  });

  it('deregisters a match and removes it from the listing', async () => {
    const { doObj } = createDO();
    await register(doObj, {
      code: 'FGHIJ',
      scenario: 'convoy',
      startedAt: Date.now(),
    });

    const deregRes = await deregister(doObj, 'FGHIJ');
    expect(deregRes.status).toBe(200);

    const { matches } = await list(doObj);
    expect(matches).toHaveLength(0);
  });

  it('deregister is idempotent for non-existent codes', async () => {
    const { doObj } = createDO();
    const res = await deregister(doObj, 'ZZZZZ');
    expect(res.status).toBe(200);
  });

  it('duplicate register replaces the previous entry', async () => {
    const { doObj } = createDO();
    const now = Date.now();
    await register(doObj, {
      code: 'ABCDE',
      scenario: 'duel',
      startedAt: now - 60000,
    });
    await register(doObj, {
      code: 'ABCDE',
      scenario: 'convoy',
      startedAt: now,
    });

    const { matches } = await list(doObj);
    expect(matches).toHaveLength(1);
    expect(matches[0].scenario).toBe('convoy');
    expect(matches[0].startedAt).toBe(now);
  });

  it('filters out stale entries older than 2 hours', async () => {
    const { doObj } = createDO();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 - 1;
    await register(doObj, {
      code: 'STALE',
      scenario: 'duel',
      startedAt: twoHoursAgo,
    });
    await register(doObj, {
      code: 'FRESH',
      scenario: 'duel',
      startedAt: Date.now(),
    });

    const { matches } = await list(doObj);
    expect(matches).toHaveLength(1);
    expect(matches[0].code).toBe('FRESH');
  });

  it('returns entries sorted newest-first', async () => {
    const { doObj } = createDO();
    await register(doObj, {
      code: 'OLDER',
      scenario: 'duel',
      startedAt: Date.now() - 60000,
    });
    await register(doObj, {
      code: 'NEWER',
      scenario: 'convoy',
      startedAt: Date.now(),
    });

    const { matches } = await list(doObj);
    expect(matches[0].code).toBe('NEWER');
    expect(matches[1].code).toBe('OLDER');
  });

  it('returns 400 for a register with missing fields', async () => {
    const { doObj } = createDO();
    const res = await doObj.fetch(
      new Request('https://live-registry.internal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'X' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    const { doObj } = createDO();
    const res = await doObj.fetch(
      new Request('https://live-registry.internal/unknown', { method: 'GET' }),
    );
    expect(res.status).toBe(404);
  });

  it('alarm sweeps stale entries and reschedules when entries remain', async () => {
    const { doObj } = createDO();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 - 1;
    await register(doObj, {
      code: 'STALE',
      scenario: 'duel',
      startedAt: twoHoursAgo,
    });
    await register(doObj, {
      code: 'FRESH',
      scenario: 'duel',
      startedAt: Date.now(),
    });

    await doObj.alarm();

    const { matches } = await list(doObj);
    expect(matches).toHaveLength(1);
    expect(matches[0].code).toBe('FRESH');
  });

  it('persists entries across fresh loads (simulated cold start)', async () => {
    const ctx = createStubCtx();
    const env = {} as Record<string, unknown>;

    // First instance: register a match.
    const do1 = new LiveRegistryDO(ctx, env as never);
    await register(do1, {
      code: 'ABCDE',
      scenario: 'duel',
      startedAt: Date.now(),
    });

    // Second instance: simulates cold start — new in-memory map, same storage.
    const do2 = new LiveRegistryDO(ctx, env as never);
    const { matches } = await list(do2);
    expect(matches).toHaveLength(1);
    expect(matches[0].code).toBe('ABCDE');
  });
});
