import { describe, expect, it } from 'vitest';

import { getOrCreateAnonId, type StorageLike } from './telemetry';

const mockStorage = (initial: Record<string, string> = {}): StorageLike => {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
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
