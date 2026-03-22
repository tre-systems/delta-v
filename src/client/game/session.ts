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

export interface LocationLike {
  protocol: string;
  host: string;
  origin: string;
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
): string | null => {
  return store[code]?.playerToken ?? null;
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

export const buildGameRoute = (code: string): string => {
  return `/?code=${code}`;
};

export const buildJoinCheckUrl = (
  location: Pick<LocationLike, 'origin'>,
  code: string,
  playerToken: string | null,
): string => {
  const url = new URL(`/join/${code}`, location.origin);

  if (playerToken) {
    url.searchParams.set('playerToken', playerToken);
  }

  return url.toString();
};

export const buildWebSocketUrl = (
  location: LocationLike,
  code: string,
  playerToken: string | null,
): string => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

  const tokenSuffix = playerToken
    ? `?playerToken=${encodeURIComponent(playerToken)}`
    : '';

  return `${protocol}//${location.host}/ws/${code}${tokenSuffix}`;
};
