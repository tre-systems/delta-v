import { describe, expect, it, vi } from 'vitest';

import { createSessionTokenService } from './session-token-service';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
};

describe('session token service', () => {
  it('prunes expired entries while reading stored tokens', () => {
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        FRESH: { playerToken: 'pt-1', ts: 99_999_950 },
        STALE: { playerToken: 'pt-2', ts: 0 },
      }),
    });
    const tokens = createSessionTokenService({
      storage,
      now: () => 100_000_000,
    });

    expect(tokens.getStoredPlayerToken('FRESH')).toBe('pt-1');
    expect(tokens.getStoredPlayerToken('STALE')).toBeNull();
    expect(storage.setItem).toHaveBeenCalledWith(
      'delta-v:tokens',
      JSON.stringify({
        FRESH: { playerToken: 'pt-1', ts: 99_999_950 },
      }),
    );
  });

  it('stores and clears player tokens', () => {
    const storage = createStorage();
    const tokens = createSessionTokenService({
      storage,
      now: () => 123,
    });

    tokens.storePlayerToken('ABCDE', 'player-token');

    expect(storage.setItem).toHaveBeenLastCalledWith(
      'delta-v:tokens',
      JSON.stringify({
        ABCDE: { playerToken: 'player-token', ts: 123 },
      }),
    );
    expect(tokens.getStoredPlayerToken('ABCDE')).toBe('player-token');

    tokens.clearStoredPlayerToken('ABCDE');

    expect(storage.setItem).toHaveBeenLastCalledWith(
      'delta-v:tokens',
      JSON.stringify({}),
    );
    expect(tokens.getStoredPlayerToken('ABCDE')).toBeNull();
  });

  it('clears every stored token at once', () => {
    const storage = createStorage({
      'delta-v:tokens': JSON.stringify({
        ABCDE: { playerToken: 'pt-1', ts: 100 },
        FGHIJ: { playerToken: 'pt-2', ts: 101 },
      }),
    });
    const tokens = createSessionTokenService({
      storage,
      now: () => 123,
    });

    tokens.clearAllStoredPlayerTokens();

    expect(storage.setItem).toHaveBeenLastCalledWith(
      'delta-v:tokens',
      JSON.stringify({}),
    );
  });
});
