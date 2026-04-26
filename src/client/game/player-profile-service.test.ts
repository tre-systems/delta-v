import { describe, expect, it } from 'vitest';

import {
  createPlayerProfileService,
  type PlayerProfileServiceDeps,
} from './player-profile-service';

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
};

const createService = (overrides: Partial<PlayerProfileServiceDeps> = {}) => {
  const storage = createMemoryStorage();
  const service = createPlayerProfileService({
    storage,
    createPlayerKey: () => 'generated-key-123',
    now: () => 1234,
    ...overrides,
  });
  return { service, storage };
};

describe('PlayerProfileService', () => {
  it('restores a recovered profile into storage', () => {
    const { service, storage } = createService();

    const restored = service.restoreProfile({
      playerKey: 'human_alpha-v1',
      username: 'Zephyr',
    });

    expect(restored).toEqual({
      playerKey: 'human_alpha-v1',
      username: 'Zephyr',
    });
    expect(service.getProfile()).toEqual(restored);
    expect([...storage.values.values()]).toEqual([
      JSON.stringify({
        playerKey: 'human_alpha-v1',
        username: 'Zephyr',
        updatedAt: 1234,
      }),
    ]);
  });

  it('falls back to the current profile when recovered playerKey is invalid', () => {
    const { service } = createService();

    expect(
      service.restoreProfile({
        playerKey: 'bad',
        username: 'Zephyr',
      }),
    ).toEqual({
      playerKey: 'generated-key-123',
      username: 'Pilot Y123',
    });
  });
});
