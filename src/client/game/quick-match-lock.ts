export interface QuickMatchLockStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface QuickMatchLock {
  claim: (playerKey: string) => { ok: true } | { ok: false };
  heartbeat: (playerKey: string, ticket: string | null) => void;
  release: () => void;
}

interface QuickMatchLockRecord {
  ownerTabId: string;
  playerKey: string;
  ticket: string | null;
  heartbeatAt: number;
}

export interface QuickMatchLockDeps {
  localStorage: QuickMatchLockStorageLike;
  sessionStorage: QuickMatchLockStorageLike;
  now?: () => number;
  createTabId?: () => string;
  ttlMs?: number;
}

const QUICK_MATCH_LOCK_KEY = 'delta-v:quick-match-lock';
const QUICK_MATCH_TAB_ID_KEY = 'delta-v:quick-match-tab-id';
const QUICK_MATCH_LOCK_TTL_MS = 15_000;

const createGeneratedTabId = (): string => {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return Math.random().toString(36).slice(2, 18);
};

const loadLockRecord = (
  storage: Pick<QuickMatchLockStorageLike, 'getItem'>,
  key = QUICK_MATCH_LOCK_KEY,
): QuickMatchLockRecord | null => {
  try {
    const raw = JSON.parse(
      storage.getItem(key) ?? 'null',
    ) as Partial<QuickMatchLockRecord> | null;

    if (
      !raw ||
      typeof raw.ownerTabId !== 'string' ||
      raw.ownerTabId.length === 0 ||
      typeof raw.playerKey !== 'string' ||
      raw.playerKey.length === 0 ||
      (raw.ticket !== null && typeof raw.ticket !== 'string') ||
      typeof raw.heartbeatAt !== 'number' ||
      !Number.isFinite(raw.heartbeatAt)
    ) {
      return null;
    }

    return {
      ownerTabId: raw.ownerTabId,
      playerKey: raw.playerKey,
      ticket: raw.ticket,
      heartbeatAt: raw.heartbeatAt,
    };
  } catch {
    return null;
  }
};

const isActiveLockRecord = (
  record: QuickMatchLockRecord,
  now: number,
  ttlMs: number,
): boolean => now - record.heartbeatAt <= ttlMs;

const getOrCreateTabId = (
  storage: QuickMatchLockStorageLike,
  createTabId: () => string,
): string => {
  const existing = storage.getItem(QUICK_MATCH_TAB_ID_KEY);

  if (existing && existing.length > 0) {
    return existing;
  }

  const next = createTabId();
  storage.setItem(QUICK_MATCH_TAB_ID_KEY, next);
  return next;
};

export const createQuickMatchLock = (
  deps: QuickMatchLockDeps,
): QuickMatchLock => {
  const now = deps.now ?? (() => Date.now());
  const createTabId = deps.createTabId ?? createGeneratedTabId;
  const ttlMs = deps.ttlMs ?? QUICK_MATCH_LOCK_TTL_MS;

  const tabId = (): string =>
    getOrCreateTabId(deps.sessionStorage, createTabId);

  const write = (record: QuickMatchLockRecord): void => {
    deps.localStorage.setItem(QUICK_MATCH_LOCK_KEY, JSON.stringify(record));
  };

  return {
    claim: (playerKey) => {
      const current = loadLockRecord(deps.localStorage);
      const ownerTabId = tabId();
      const ts = now();

      if (
        current &&
        current.ownerTabId !== ownerTabId &&
        isActiveLockRecord(current, ts, ttlMs)
      ) {
        return { ok: false };
      }

      write({
        ownerTabId,
        playerKey,
        ticket: current?.ownerTabId === ownerTabId ? current.ticket : null,
        heartbeatAt: ts,
      });
      return { ok: true };
    },
    heartbeat: (playerKey, ticket) => {
      const current = loadLockRecord(deps.localStorage);
      const ownerTabId = tabId();

      if (current && current.ownerTabId !== ownerTabId) {
        return;
      }

      write({
        ownerTabId,
        playerKey,
        ticket,
        heartbeatAt: now(),
      });
    },
    release: () => {
      const current = loadLockRecord(deps.localStorage);

      if (!current || current.ownerTabId !== tabId()) {
        return;
      }

      deps.localStorage.removeItem(QUICK_MATCH_LOCK_KEY);
    },
  };
};
