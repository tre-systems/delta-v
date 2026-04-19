import {
  deleteStoredPlayerToken,
  getStoredPlayerToken,
  loadTokenStore,
  pruneExpiredTokens,
  type StorageLike,
  saveTokenStore,
  setStoredPlayerToken,
  type TokenStore,
} from './session-token-store';

export interface SessionTokenService {
  getStoredPlayerToken: (code: string) => string | null;
  storePlayerToken: (code: string, token: string) => void;
  clearStoredPlayerToken: (code: string) => void;
  clearAllStoredPlayerTokens: () => void;
}

export interface SessionTokenServiceDeps {
  storage: StorageLike;
  now?: () => number;
}

export const createSessionTokenService = (
  deps: SessionTokenServiceDeps,
): SessionTokenService => {
  const now = deps.now ?? (() => Date.now());

  const readTokenStore = (): TokenStore => {
    const store = loadTokenStore(deps.storage);
    const prunedStore = pruneExpiredTokens(store, now());

    if (Object.keys(prunedStore).length !== Object.keys(store).length) {
      saveTokenStore(deps.storage, prunedStore, now());
    }

    return prunedStore;
  };

  const writeTokenStore = (store: TokenStore): void => {
    saveTokenStore(deps.storage, store, now());
  };

  return {
    getStoredPlayerToken: (code) =>
      getStoredPlayerToken(readTokenStore(), code, now()),
    storePlayerToken: (code, token) => {
      writeTokenStore(
        setStoredPlayerToken(readTokenStore(), code, token, now()),
      );
    },
    clearStoredPlayerToken: (code) => {
      writeTokenStore(deleteStoredPlayerToken(readTokenStore(), code));
    },
    clearAllStoredPlayerTokens: () => {
      writeTokenStore({});
    },
  };
};
