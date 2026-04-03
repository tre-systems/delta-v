# Mock Storage

## Category

Testing

## Intent

Test Durable Object persistence logic without a real Cloudflare runtime by providing a lightweight in-memory implementation of `DurableObjectStorage`. This allows unit testing of event-sourced archive operations, checkpoint management, and state projection in a standard Node/Vitest environment.

## How It Works in Delta-V

Server-side test files that exercise DO storage create a `createMockStorage()` factory that returns a minimal `DurableObjectStorage`-compatible object backed by a plain `Map<string, unknown>`. The mock implements the subset of the storage API actually used by production code: `get`, `put`, `delete`, `deleteAll`, and `setAlarm`.

Two variants exist in the codebase:

1. **`archive.test.ts` mock** -- A simpler version that implements `get` (single key) and `put` (single key or batch object). Cast to `DurableObjectStorage` via `as unknown as DurableObjectStorage`.

2. **`game-do.test.ts` mock** -- A richer version that also tracks `alarmAt` for alarm scheduling assertions and handles array key overloads on `get`.

Both mocks use the same core pattern: a `Map<string, unknown>` as the backing store, with `get`/`put` delegating to `Map.get`/`Map.set`. This is sufficient because Delta-V's storage usage is simple key-value operations without transactions or list operations.

## Key Locations

- `src/server/game-do/archive.test.ts` (lines 36-54) -- simpler mock
- `src/server/game-do/game-do.test.ts` (lines 51-93) -- richer mock with alarm tracking
- `src/server/game-do/alarm.test.ts` -- uses similar mock pattern
- `src/server/game-do/match-archive.test.ts` -- storage mock for archive operations
- `src/server/game-do/fetch.test.ts` -- mock for HTTP handler tests

## Code Examples

Simpler archive mock:

```typescript
const createMockStorage = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof key === 'string') {
        data.set(key, value);
        return;
      }
      for (const [entryKey, entryValue] of Object.entries(key)) {
        data.set(entryKey, entryValue);
      }
    },
  } as unknown as DurableObjectStorage;
};
```

Richer game-do mock with alarm tracking:

```typescript
type MockStorage = DurableObjectStorage & {
  alarmAt: number | null;
};

const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();
  const storage = {
    alarmAt: null,
    async get<T>(key: string | string[]): Promise<T | undefined> {
      if (typeof key !== 'string') return undefined;
      return data.get(key) as T | undefined;
    },
    async put<T>(
      key: string | Record<string, T>,
      value?: T,
    ): Promise<boolean> {
      if (typeof key === 'string') {
        data.set(key, value);
        return true;
      }
      // batch put ...
    },
    async setAlarm(value: number): Promise<void> {
      storage.alarmAt = value;
    },
  };
  return storage as MockStorage;
};
```

## Consistency Analysis

The mock storage pattern is consistent across all server test files. Every test that needs storage creates its own mock via the factory function, ensuring isolation between tests. No shared global mock state exists.

One inconsistency: the two mock variants have slightly different signatures for `put` (one returns `Promise<void>`, the other `Promise<boolean>`). This reflects the fact that different call sites use different overloads of the real `DurableObjectStorage.put`. A single unified mock would be cleaner.

## Completeness Check

- **Missing operations**: The mocks do not implement `list`, `transaction`, or `getAlarm`. If production code starts using these, the mocks will need extension. Currently this is not a problem since Delta-V uses simple key-value operations.
- **No shared mock module**: Each test file defines its own `createMockStorage`. Extracting a shared `test-helpers/mock-storage.ts` would reduce duplication and ensure consistency.
- **Cloudflare module mock**: `game-do.test.ts` also mocks `cloudflare:workers` via `vi.mock` to provide a stub `DurableObject` base class. This is separate from storage mocking but is part of the same DO testability story.

## Related Patterns

- **51 -- Co-Located Tests**: Mock storage factories are defined inside the test files that use them, not in a shared test utility directory.
- **50 -- Hibernatable WebSocket**: The mock storage tests exercise the same archive/checkpoint/projection code that the hibernatable DO uses for state recovery.
- **56 -- Deterministic RNG in Tests**: Both mock storage and deterministic RNG are dependency injection techniques that make server-side code testable without the real runtime.
