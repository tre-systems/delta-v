import { describe, expect, it, vi } from 'vitest';

import {
  deleteStoredPlayerToken,
  getStoredPlayerToken,
  loadTokenStore,
  pruneExpiredTokens,
  saveTokenStore,
  setStoredPlayerToken,
  TOKEN_STORE_KEY,
} from './session-token-store';

describe('game client session token store', () => {
  it('loads token store safely and falls back on invalid JSON', () => {
    expect(
      loadTokenStore({
        getItem: () => '{"ABCDE":{"playerToken":"pt-1","ts":1}}',
      }),
    ).toEqual({
      ABCDE: { playerToken: 'pt-1', ts: 1 },
    });

    expect(
      loadTokenStore({
        getItem: () => '{bad json',
      }),
    ).toEqual({});
  });

  it('sets and reads player tokens', () => {
    const store = setStoredPlayerToken({}, 'ABCDE', 'pt-1', 100);

    expect(getStoredPlayerToken(store, 'ABCDE', 100)).toBe('pt-1');
    expect(store.ABCDE.ts).toBe(100);
  });

  it('treats expired stored tokens as missing and can delete them', () => {
    const store = {
      ABCDE: { playerToken: 'pt-1', ts: 100 },
    };

    expect(getStoredPlayerToken(store, 'ABCDE', 100)).toBe('pt-1');
    expect(getStoredPlayerToken(store, 'ABCDE', 1000, 200)).toBeNull();
    expect(deleteStoredPlayerToken(store, 'ABCDE')).toEqual({});
  });

  it('prunes expired entries before saving to storage', () => {
    const setItem = vi.fn();
    const store = {
      FRESH: { playerToken: 'pt-1', ts: 900 },
      STALE: { playerToken: 'pt-2', ts: 0 },
    };

    const pruned = saveTokenStore(
      { setItem },
      store,
      1000,
      TOKEN_STORE_KEY,
      200,
    );

    expect(pruned).toEqual({
      FRESH: { playerToken: 'pt-1', ts: 900 },
    });

    expect(pruneExpiredTokens(store, 1000, 200)).toEqual(pruned);

    expect(setItem).toHaveBeenCalledWith(
      TOKEN_STORE_KEY,
      JSON.stringify(pruned),
    );
  });
});
