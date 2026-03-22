import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { appendEnvelopedEvents, saveCheckpoint } from './archive';
import {
  archiveCompletedMatch,
  fetchArchivedMatch,
  type MatchArchive,
} from './match-archive';

class MockStorage {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
}

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
    _objects: objects,
  };
};

const createMockDb = () => {
  const bindFn = vi.fn(() => ({ run: vi.fn(async () => ({})) }));
  return {
    prepare: vi.fn(() => ({ bind: bindFn })),
    _bind: bindFn,
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
    });
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

    const body = JSON.parse(r2._objects.get(r2Key) ?? '{}') as MatchArchive;
    expect(body.gameId).toBe('ARC-m1');
    expect(body.roomCode).toBe('ARCROOM');
    expect(body.scenario).toBe('Duel');
    expect(body.winner).toBe(0);
    expect(body.winReason).toBe('Fleet eliminated!');
    expect(body.turnCount).toBe(state.turnNumber);
    expect(body.eventStream).toHaveLength(1);
    expect(body.checkpoint).not.toBeNull();

    // D1 should have metadata
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db._bind).toHaveBeenCalledWith(
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
    };

    r2._objects.set('matches/FETCH-m1.json', JSON.stringify(archive));

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
});
