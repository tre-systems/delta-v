// Shared Durable Object storage / state mocks for the game-do test suite.
//
// Each test file used to hand-roll its own createMockStorage / createCtx
// with subtly different contracts (some tracked alarms, some didn't; some
// implemented deleteAll, some didn't). This module centralises the shape
// so a) new DO fields are covered for every test once, and b) the mocks
// honour the same put / delete / setAlarm contract the production DO
// sees.
//
// This file has no tests of its own; it lives alongside the test files
// so imports stay short and the tsconfig picks it up through the regular
// src/** include. Tests that need extra fields can extend the returned
// objects locally — the helper returns a plain object literal, not a
// sealed class.

export type MockStorage = DurableObjectStorage & {
  /** Last-set alarm timestamp, or null if none set / cleared. */
  alarmAt: number | null;
  /** Raw key/value store backing the mock. Useful for assertions. */
  data: Map<string, unknown>;
};

export const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();
  const storage: {
    alarmAt: number | null;
    data: Map<string, unknown>;
    get: <T>(key: string | string[]) => Promise<T | undefined>;
    put: <T>(
      key: string | Record<string, T> | string[],
      value?: T,
    ) => Promise<boolean>;
    delete: (key: string) => Promise<void>;
    deleteAll: () => Promise<void>;
    setAlarm: (value: number) => Promise<void>;
    deleteAlarm: () => Promise<void>;
  } = {
    alarmAt: null,
    data,
    async get<T>(key: string | string[]): Promise<T | undefined> {
      if (typeof key !== 'string') return undefined;
      return data.get(key) as T | undefined;
    },
    async put<T>(
      key: string | Record<string, T> | string[],
      value?: T,
    ): Promise<boolean> {
      if (Array.isArray(key)) return true;
      if (typeof key === 'string') {
        data.set(key, value);
        return true;
      }

      for (const [entryKey, entryValue] of Object.entries(key)) {
        data.set(entryKey, entryValue);
      }
      return true;
    },
    async delete(key: string): Promise<void> {
      data.delete(key);
    },
    async deleteAll(): Promise<void> {
      data.clear();
    },
    async setAlarm(value: number): Promise<void> {
      storage.alarmAt = value;
    },
    async deleteAlarm(): Promise<void> {
      storage.alarmAt = null;
    },
  };

  return storage as unknown as MockStorage;
};

export interface MockDurableObjectState {
  storage: MockStorage;
  acceptWebSocket: (ws: object, wsTags: string[]) => void;
  getTags: (ws: object) => string[];
  getWebSockets: (tag?: string) => object[];
}

// Minimal DurableObjectState mock. Tracks accepted sockets + tags so
// tests can assert the hibernation-aware socket registry without
// standing up workerd.
export const createMockDurableObjectState = (): MockDurableObjectState => {
  const storage = createMockStorage();
  const sockets: object[] = [];
  const tags = new WeakMap<object, string[]>();
  return {
    storage,
    acceptWebSocket(ws: object, wsTags: string[]) {
      sockets.push(ws);
      tags.set(ws, wsTags);
    },
    getTags(ws: object) {
      return tags.get(ws) ?? [];
    },
    getWebSockets(tag?: string) {
      if (!tag) return sockets;
      return sockets.filter((ws) => (tags.get(ws) ?? []).includes(tag));
    },
  };
};
