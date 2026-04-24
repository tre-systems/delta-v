import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureTelemetryRuntime,
  getOrCreateAnonId,
  reportError,
  resetTelemetryRuntimeForTests,
  rotateAnonId,
  type StorageLike,
  track,
} from './telemetry';

const mockStorage = (initial: Record<string, string> = {}): StorageLike => {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
};

describe('getOrCreateAnonId', () => {
  it('generates a UUID when storage is empty', () => {
    const storage = mockStorage();
    const id = getOrCreateAnonId(storage);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('persists the ID to storage', () => {
    const storage = mockStorage();
    const id = getOrCreateAnonId(storage);

    expect(storage.getItem('deltav_anon_id')).toBe(id);
  });

  it('returns existing ID from storage', () => {
    const storage = mockStorage({
      deltav_anon_id: 'existing-id',
    });
    const id = getOrCreateAnonId(storage);

    expect(id).toBe('existing-id');
  });

  it('returns same ID on repeated calls', () => {
    const storage = mockStorage();
    const first = getOrCreateAnonId(storage);
    const second = getOrCreateAnonId(storage);

    expect(first).toBe(second);
  });

  it('falls back to random ID when storage throws', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const id = getOrCreateAnonId(storage);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

afterEach(() => {
  resetTelemetryRuntimeForTests();
});

describe('telemetry runtime injection', () => {
  it('uses the configured fetch implementation for track', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    configureTelemetryRuntime({
      fetchImpl,
      getStorage: () => mockStorage({ deltav_anon_id: 'anon-1' }),
      createUuid: () => 'anon-1',
      getLocationHref: () => 'https://delta-v.test/game/ABCDE',
      getUserAgent: () => 'test-agent',
      addGlobalListener: () => undefined,
    });

    track('join_game_attempted', { scenario: 'duel' });
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledWith(
      '/telemetry',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
      }),
    );
  });

  it('uses the configured location and user agent for reportError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    configureTelemetryRuntime({
      fetchImpl,
      getStorage: () => mockStorage({ deltav_anon_id: 'anon-2' }),
      createUuid: () => 'anon-2',
      getLocationHref: () => 'https://delta-v.test/replay/XYZ',
      getUserAgent: () => 'test-browser',
      addGlobalListener: () => undefined,
    });

    reportError('boom', { type: 'fatal' });
    await Promise.resolve();

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;

    expect(body).toMatchObject({
      error: 'boom',
      type: 'fatal',
      url: 'https://delta-v.test/replay/XYZ',
      ua: 'test-browser',
      anonId: 'anon-2',
    });
  });

  it('rotates the anonymous ID for the next telemetry event', async () => {
    const storage = mockStorage({ deltav_anon_id: 'anon-before' });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const uuid = 'anon-after';
    configureTelemetryRuntime({
      fetchImpl,
      getStorage: () => storage,
      createUuid: () => uuid,
      getLocationHref: () => 'https://delta-v.test/',
      getUserAgent: () => 'test-agent',
      addGlobalListener: () => undefined,
    });

    track('before_reset');
    await Promise.resolve();

    rotateAnonId();
    track('after_reset');
    await Promise.resolve();

    const bodies = fetchImpl.mock.calls.map(([, init]) =>
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null,
    );

    expect(bodies[0]).toMatchObject({ anonId: 'anon-before' });
    expect(bodies[1]).toMatchObject({ anonId: 'anon-after' });
    expect(storage.getItem('deltav_anon_id')).toBe('anon-after');
  });
});
