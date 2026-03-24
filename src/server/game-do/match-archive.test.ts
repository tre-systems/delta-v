import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  appendEnvelopedEvents,
  saveCheckpoint,
  saveMatchCreatedAt,
} from './archive';
import {
  archiveCompletedMatch,
  fetchArchivedMatch,
  type MatchArchive,
} from './match-archive';

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

const MockStorage = function MockStorage() {
  return createMockStorage();
} as unknown as {
  new (): DurableObjectStorage;
};

const createMockR2 = () => {
  const objects = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, body);
    }),
    get: vi.fn(async (key: string) => {
      const body = objects.get(key);
      if (!body) return null;
      return { json: async () => JSON.parse(body) };
    }),
    objects: objects,
  };
};

const createMockDb = () => {
  const bindFn = vi.fn(() => ({ run: vi.fn(async () => ({})) }));
  return {
    prepare: vi.fn(() => ({ bind: bindFn })),
    bind: bindFn,
  };
};

describe('match archival', () => {
  it('archives a completed match to R2 with correct structure', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'ARC-m1', findBaseHex);
    state.phase = 'gameOver';
    state.winner = 0;
    state.winReason = 'Fleet eliminated!';

    // Populate event stream and checkpoint
    await appendEnvelopedEvents(storage, 'ARC-m1', null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await saveMatchCreatedAt(storage, 'ARC-m1', 1234);
    await saveCheckpoint(storage, 'ARC-m1', state, 1);

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'ARCROOM',
    );

    // R2 should have the archive
    expect(r2.put).toHaveBeenCalledTimes(1);
    const r2Key = r2.put.mock.calls[0][0] as string;
    expect(r2Key).toBe('matches/ARC-m1.json');

    const body = JSON.parse(r2.objects.get(r2Key) ?? '{}') as MatchArchive;
    expect(body.gameId).toBe('ARC-m1');
    expect(body.roomCode).toBe('ARCROOM');
    expect(body.scenario).toBe('Duel');
    expect(body.winner).toBe(0);
    expect(body.winReason).toBe('Fleet eliminated!');
    expect(body.turnCount).toBe(state.turnNumber);
    expect(body.createdAt).toBe(1234);
    expect(body.eventStream).toHaveLength(1);
    expect(body.checkpoint).not.toBeNull();

    // D1 should have metadata
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.bind).toHaveBeenCalledWith(
      'ARC-m1',
      'ARCROOM',
      'Duel',
      0,
      'Fleet eliminated!',
      state.turnNumber,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('fetches archived match from R2', async () => {
    const r2 = createMockR2();
    const archive: MatchArchive = {
      gameId: 'FETCH-m1',
      roomCode: 'FETCH',
      scenario: 'Bi-Planetary',
      winner: 1,
      winReason: 'Landed on Mars!',
      turnCount: 5,
      createdAt: 1000,
      completedAt: 2000,
      eventStream: [],
      checkpoint: null,
      matchSeed: null,
    };

    r2.objects.set('matches/FETCH-m1.json', JSON.stringify(archive));

    const result = await fetchArchivedMatch(
      r2 as unknown as R2Bucket,
      'FETCH-m1',
    );

    expect(result).not.toBeNull();
    expect(result?.gameId).toBe('FETCH-m1');
    expect(result?.winner).toBe(1);
  });

  it('returns null when R2 is not bound', async () => {
    const result = await fetchArchivedMatch(undefined, 'NONE-m1');
    expect(result).toBeNull();
  });

  it('returns null when archive does not exist in R2', async () => {
    const r2 = createMockR2();
    const result = await fetchArchivedMatch(
      r2 as unknown as R2Bucket,
      'MISSING-m1',
    );
    expect(result).toBeNull();
  });

  it('does not throw when D1 is unavailable', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'NODB-m1', findBaseHex);
    state.phase = 'gameOver';

    // Pass undefined for db — should not throw
    await expect(
      archiveCompletedMatch(
        storage,
        r2 as unknown as R2Bucket,
        undefined,
        state,
        'NODB',
      ),
    ).resolves.not.toThrow();

    expect(r2.put).toHaveBeenCalledTimes(1);
  });

  it('logs error but does not throw on R2 failure', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r2 = {
      put: vi.fn(async () => {
        throw new Error('R2 down');
      }),
    };
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'ERR-m1', findBaseHex);
    state.phase = 'gameOver';

    await expect(
      archiveCompletedMatch(
        storage,
        r2 as unknown as R2Bucket,
        undefined,
        state,
        'ERR',
      ),
    ).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('falls back to checkpoint time when no match start time is stored', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'FALL-m1', findBaseHex);
    state.phase = 'gameOver';

    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await saveCheckpoint(storage, 'FALL-m1', state, 1);
    vi.spyOn(Date, 'now').mockReturnValue(9000);

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      undefined,
      state,
      'FALL',
    );

    const body = JSON.parse(
      r2.objects.get('matches/FALL-m1.json') ?? '{}',
    ) as MatchArchive;

    expect(body.createdAt).toBe(5000);
    expect(body.completedAt).toBe(9000);
  });
});
