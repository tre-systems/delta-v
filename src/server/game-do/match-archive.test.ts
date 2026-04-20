import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
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
  MATCH_ARCHIVE_RETENTION_MS,
  type MatchArchive,
  purgeExpiredMatchArchives,
} from './match-archive';

import { createMockStorage } from './test-support';

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
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('ARC-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Fleet eliminated!' };

    // Populate event stream and checkpoint
    await appendEnvelopedEvents(storage, asGameId('ARC-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await saveMatchCreatedAt(storage, asGameId('ARC-m1'), 1234);
    await saveCheckpoint(storage, asGameId('ARC-m1'), state, 1);

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
    expect(body.scenario).toBe('duel');
    expect(body.winner).toBe(0);
    expect(body.winReason).toBe('Fleet eliminated!');
    expect(body.turnCount).toBe(state.turnNumber);
    expect(body.createdAt).toBe(1234);
    expect(body.eventStream).toHaveLength(1);
    expect(body.checkpoint).not.toBeNull();

    // D1 should have metadata — 9 columns including match_coached.
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.bind).toHaveBeenCalledWith(
      'ARC-m1',
      'ARCROOM',
      'duel',
      0,
      'Fleet eliminated!',
      state.turnNumber,
      expect.any(Number),
      expect.any(Number),
      0, // match_coached: falsy for uncoached match
    );

    // The DO-side checkpoint is pruned after the archive lands. R2 now
    // holds the canonical copy and nothing reads the DO checkpoint for
    // completed matches, so keeping it would just be permanent residue.
    expect(await storage.get('checkpoint:ARC-m1')).toBeUndefined();
  });

  it('persists match_coached flag when /coach was used', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('COACH-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 1, reason: 'Reached objective' };

    await appendEnvelopedEvents(storage, asGameId('COACH-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    // Simulate a prior /coach: setCoachDirective stores matchCoached=true.
    await storage.put('matchCoached', true);

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'COACHROOM',
    );

    expect(db.bind).toHaveBeenCalledWith(
      'COACH-m1',
      'COACHROOM',
      'duel',
      1,
      'Reached objective',
      state.turnNumber,
      expect.any(Number),
      expect.any(Number),
      1, // match_coached: truthy when isMatchCoached returned true
    );
  });

  it('fetches archived match from R2', async () => {
    const r2 = createMockR2();
    const archive: MatchArchive = {
      gameId: asGameId('FETCH-m1'),
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
      asGameId('FETCH-m1'),
    );

    expect(result).not.toBeNull();
    expect(result?.gameId).toBe('FETCH-m1');
    expect(result?.winner).toBe(1);
  });

  it('returns null when R2 is not bound', async () => {
    const result = await fetchArchivedMatch(undefined, asGameId('NONE-m1'));
    expect(result).toBeNull();
  });

  it('returns null when archive does not exist in R2', async () => {
    const r2 = createMockR2();
    const result = await fetchArchivedMatch(
      r2 as unknown as R2Bucket,
      asGameId('MISSING-m1'),
    );
    expect(result).toBeNull();
  });

  it('does not throw when D1 is unavailable', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NODB-m1'),
      findBaseHex,
    );
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('ERR-m1'),
      findBaseHex,
    );
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('FALL-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';

    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await saveCheckpoint(storage, asGameId('FALL-m1'), state, 1);
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

  it('purges expired archives from both R2 and D1 metadata', async () => {
    const now = Date.now();
    const cutoff = now - MATCH_ARCHIVE_RETENTION_MS;
    const r2 = createMockR2();
    r2.objects.set('matches/OLD-m1.json', '{}');
    r2.objects.set('matches/NEW-m1.json', '{}');

    const runFn = vi.fn(async () => ({ meta: { changes: 1 } }));
    const allFn = vi.fn(async () => ({
      results: [{ game_id: 'OLD-m1' }],
    }));
    const bindFn = vi
      .fn()
      .mockReturnValueOnce({ all: allFn })
      .mockReturnValueOnce({ run: runFn });
    const db = {
      prepare: vi.fn(() => ({ bind: bindFn })),
    };

    const result = await purgeExpiredMatchArchives(
      db as unknown as D1Database,
      r2 as unknown as R2Bucket,
      MATCH_ARCHIVE_RETENTION_MS,
    );

    expect(db.prepare).toHaveBeenNthCalledWith(
      1,
      'SELECT game_id FROM match_archive WHERE completed_at < ? ORDER BY completed_at ASC LIMIT ?',
    );
    expect(bindFn).toHaveBeenNthCalledWith(1, expect.any(Number), 128);
    expect(r2.delete).toHaveBeenCalledWith(['matches/OLD-m1.json']);
    expect(db.prepare).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM match_archive WHERE game_id IN (?)',
    );
    expect(bindFn).toHaveBeenNthCalledWith(2, 'OLD-m1');
    expect(result).toEqual({ deletedRows: 1, deletedObjects: 1 });
    expect(r2.objects.has('matches/OLD-m1.json')).toBe(false);
    expect(r2.objects.has('matches/NEW-m1.json')).toBe(true);
    expect(cutoff).toBeLessThan(now);
  });

  it('keeps D1 rows when deleting expired R2 objects fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r2 = {
      delete: vi.fn(async () => {
        throw new Error('R2 delete failed');
      }),
    };
    const runFn = vi.fn(async () => ({ meta: { changes: 1 } }));
    const allFn = vi.fn(async () => ({
      results: [{ game_id: 'OLD-m2' }],
    }));
    const bindFn = vi
      .fn()
      .mockReturnValueOnce({ all: allFn })
      .mockReturnValueOnce({ run: runFn });
    const db = {
      prepare: vi.fn(() => ({ bind: bindFn })),
    };

    const result = await purgeExpiredMatchArchives(
      db as unknown as D1Database,
      r2 as unknown as R2Bucket,
      MATCH_ARCHIVE_RETENTION_MS,
    );

    expect(r2.delete).toHaveBeenCalledWith(['matches/OLD-m2.json']);
    expect(runFn).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedRows: 0, deletedObjects: 0 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
