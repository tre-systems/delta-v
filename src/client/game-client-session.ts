export interface TokenStoreEntry {
  playerToken?: string;
  inviteToken?: string;
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

export function loadTokenStore(storage: Pick<StorageLike, 'getItem'>, key = TOKEN_STORE_KEY): TokenStore {
  try {
    return JSON.parse(storage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function pruneExpiredTokens(store: TokenStore, now: number, ttlMs = TOKEN_TTL_MS): TokenStore {
  return Object.fromEntries(Object.entries(store).filter(([, entry]) => now - entry.ts <= ttlMs));
}

export function saveTokenStore(
  storage: Pick<StorageLike, 'setItem'>,
  store: TokenStore,
  now: number,
  key = TOKEN_STORE_KEY,
  ttlMs = TOKEN_TTL_MS,
): TokenStore {
  const prunedStore = pruneExpiredTokens(store, now, ttlMs);
  try {
    storage.setItem(key, JSON.stringify(prunedStore));
  } catch {
    // Ignore storage failures.
  }
  return prunedStore;
}

export function getStoredPlayerToken(store: TokenStore, code: string): string | null {
  return store[code]?.playerToken ?? null;
}

export function getStoredInviteToken(store: TokenStore, code: string): string | null {
  return store[code]?.inviteToken ?? null;
}

export function setStoredPlayerToken(store: TokenStore, code: string, playerToken: string, now: number): TokenStore {
  return {
    ...store,
    [code]: {
      ...store[code],
      playerToken,
      ts: now,
    },
  };
}

export function setStoredInviteToken(store: TokenStore, code: string, inviteToken: string, now: number): TokenStore {
  return {
    ...store,
    [code]: {
      ...store[code],
      inviteToken,
      ts: now,
    },
  };
}

export function buildInviteLink(origin: string, code: string, inviteToken: string): string {
  return `${origin}/?code=${code}&playerToken=${encodeURIComponent(inviteToken)}`;
}

export function buildGameRoute(code: string): string {
  return `/?code=${code}`;
}

export function buildWebSocketUrl(location: LocationLike, code: string, playerToken: string | null): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenSuffix = playerToken ? `?playerToken=${encodeURIComponent(playerToken)}` : '';
  return `${protocol}//${location.host}/ws/${code}${tokenSuffix}`;
}
