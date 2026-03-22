import { describe, expect, it, vi } from 'vitest';

import {
  buildGameRoute,
  buildJoinCheckUrl,
  buildWebSocketUrl,
  getStoredPlayerToken,
  loadTokenStore,
  pruneExpiredTokens,
  saveTokenStore,
  setStoredPlayerToken,
  TOKEN_STORE_KEY,
} from './session';

describe('game client session helpers', () => {
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

    expect(getStoredPlayerToken(store, 'ABCDE')).toBe('pt-1');
    expect(store.ABCDE.ts).toBe(100);
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

  it('builds routes and websocket URLs with optional tokens', () => {
    expect(buildGameRoute('ABCDE')).toBe('/?code=ABCDE');

    expect(
      buildJoinCheckUrl(
        {
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        'player token',
      ),
    ).toBe('https://delta-v.example/join/ABCDE?playerToken=player+token');

    expect(
      buildJoinCheckUrl(
        {
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        null,
      ),
    ).toBe('https://delta-v.example/join/ABCDE');

    expect(
      buildWebSocketUrl(
        {
          protocol: 'https:',
          host: 'delta-v.example',
          origin: 'https://delta-v.example',
        },
        'ABCDE',
        'player token',
      ),
    ).toBe('wss://delta-v.example/ws/ABCDE?playerToken=player%20token');

    expect(
      buildWebSocketUrl(
        {
          protocol: 'http:',
          host: 'localhost:8787',
          origin: 'http://localhost:8787',
        },
        'ABCDE',
        null,
      ),
    ).toBe('ws://localhost:8787/ws/ABCDE');
  });
});
