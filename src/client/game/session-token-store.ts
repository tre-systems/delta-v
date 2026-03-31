import { pickBy } from '../../shared/util';

export interface TokenStoreEntry {
  playerToken?: string;
  ts: number;
}

export type TokenStore = Record<string, TokenStoreEntry>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TOKEN_STORE_KEY = 'delta-v:tokens';
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const loadTokenStore = (
  storage: Pick<StorageLike, 'getItem'>,
  key = TOKEN_STORE_KEY,
): TokenStore => {
  try {
    return JSON.parse(storage.getItem(key) || '{}');
  } catch {
    return {};
  }
};

export const pruneExpiredTokens = (
  store: TokenStore,
  now: number,
  ttlMs = TOKEN_TTL_MS,
): TokenStore => {
  return pickBy(store, (entry) => now - entry.ts <= ttlMs) as TokenStore;
};

export const saveTokenStore = (
  storage: Pick<StorageLike, 'setItem'>,
  store: TokenStore,
  now: number,
  key = TOKEN_STORE_KEY,
  ttlMs = TOKEN_TTL_MS,
): TokenStore => {
  const prunedStore = pruneExpiredTokens(store, now, ttlMs);

  try {
    storage.setItem(key, JSON.stringify(prunedStore));
  } catch {
    // Ignore storage failures.
  }

  return prunedStore;
};

export const getStoredPlayerToken = (
  store: TokenStore,
  code: string,
  now = Date.now(),
  ttlMs = TOKEN_TTL_MS,
): string | null => {
  const entry = store[code];

  if (!entry || now - entry.ts > ttlMs) {
    return null;
  }

  return entry.playerToken ?? null;
};

export const deleteStoredPlayerToken = (
  store: TokenStore,
  code: string,
): TokenStore => {
  const { [code]: _removed, ...rest } = store;

  return rest;
};

export const setStoredPlayerToken = (
  store: TokenStore,
  code: string,
  playerToken: string,
  now: number,
): TokenStore => {
  return {
    ...store,
    [code]: {
      ...store[code],
      playerToken,
      ts: now,
    },
  };
};
