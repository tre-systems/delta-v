import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
  OFFICIAL_QUICK_MATCH_BOT_USERNAME,
} from '../../shared/player';
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
    head: vi.fn(async (key: string) =>
      objects.has(key) ? { key, size: (objects.get(key) ?? '').length } : null,
    ),
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
    expect(body.officialBotMatch).toBe(false);
    expect(body.eventStream).toHaveLength(1);
    expect(body.checkpoint).not.toBeNull();

    // D1 should have metadata — 15 columns: match_coached,
    // official_bot_match, the participant snapshot triplet
    // (player_a_username, player_b_username, winner_username), plus
    // public_visible and quality_flags from migration 0008.
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
      0, // official_bot_match: falsy for human-vs-human match
      null, // player_a_username: no roomConfig stored in this fixture
      null, // player_b_username
      null, // winner_username
      0, // public_visible: hidden because both snapshots are null
      JSON.stringify(['unidentified_participants']),
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
      0, // official_bot_match: still false here
      null,
      null,
      null,
      0, // public_visible: hidden — no snapshots saved
      JSON.stringify(['unidentified_participants']),
    );
  });

  it('persists official_bot_match when the stable official bot was seated', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('BOT-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Fleet eliminated!' };

    await appendEnvelopedEvents(storage, asGameId('BOT-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'BOTRM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), null],
      players: [
        { playerKey: 'human-player', username: 'Pilot 1', kind: 'human' },
        {
          playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
          username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
          kind: 'agent',
        },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'BOTRM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/BOT-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.officialBotMatch).toBe(true);
    expect(db.bind).toHaveBeenCalledWith(
      'BOT-m1',
      'BOTRM',
      'duel',
      0,
      'Fleet eliminated!',
      state.turnNumber,
      expect.any(Number),
      expect.any(Number),
      0,
      1,
      null,
      OFFICIAL_QUICK_MATCH_BOT_USERNAME,
      null,
      // The official bot's snapshot is preserved, so the row keeps a
      // labelled participant even though the human's `Pilot 1` default
      // was dropped. With at least one identifiable seat, the listing
      // stays publicly visible.
      1,
      null,
    );
  });

  it('snapshots claimed callsigns for both participants and the winner', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('SNAP-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 1, reason: 'Fleet eliminated!' };

    await appendEnvelopedEvents(storage, asGameId('SNAP-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'SNAPRM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
      players: [
        { playerKey: 'human-rob', username: 'RobG', kind: 'human' },
        { playerKey: 'human-fau', username: 'Fau', kind: 'human' },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'SNAPRM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/SNAP-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.playerAUsername).toBe('RobG');
    expect(body.playerBUsername).toBe('Fau');
    expect(body.winnerUsername).toBe('Fau');
  });

  it('drops the placeholder "Player 1" / "Player 2" defaults from the snapshot', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('PLACEHOLD-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Fleet eliminated!' };

    await appendEnvelopedEvents(storage, asGameId('PLACEHOLD-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'PHRM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), null],
      players: [
        { playerKey: 'seat0', username: 'Player 1', kind: 'human' },
        { playerKey: 'seat1', username: 'Player 2', kind: 'human' },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'PHRM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/PLACEHOLD-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.playerAUsername).toBeNull();
    expect(body.playerBUsername).toBeNull();
    expect(body.winnerUsername).toBeNull();
  });

  it('skips the R2/D1 write when the archive already exists', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('IDEMP-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Fleet eliminated!' };

    await appendEnvelopedEvents(storage, asGameId('IDEMP-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });

    // First archive: R2 is empty, the writer lays down the canonical
    // object and the D1 row.
    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'IDEMPRM',
    );
    expect(r2.put).toHaveBeenCalledTimes(1);
    const firstBody = r2.objects.get('matches/IDEMP-m1.json') ?? '';
    expect(db.prepare).toHaveBeenCalledTimes(1);

    // Second archive (e.g. alarm path firing after the publication
    // path already wrote): r2.head sees the existing object so the
    // rewrite is skipped. D1 is also untouched, so completed_at can
    // never drift away from the canonical first-write value.
    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'IDEMPRM',
    );
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(r2.objects.get('matches/IDEMP-m1.json')).toBe(firstBody);
  });

  it('hides 1-turn disconnect-forfeit rows from the public listing', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NOISE-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Opponent disconnected' };
    state.turnNumber = 1;

    await appendEnvelopedEvents(storage, asGameId('NOISE-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'NOISERM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), null],
      players: [
        { playerKey: 'human-rob', username: 'RobG', kind: 'human' },
        { playerKey: 'human-fau', username: 'Fau', kind: 'human' },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'NOISERM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/NOISE-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.publicVisible).toBe(false);
    expect(body.qualityFlags).toEqual(['short_disconnect_forfeit']);
  });

  it('keeps a real 2-player completed match publicly visible', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('VIS-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Fleet eliminated!' };
    state.turnNumber = 8;

    await appendEnvelopedEvents(storage, asGameId('VIS-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'VISRM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
      players: [
        { playerKey: 'human-rob', username: 'RobG', kind: 'human' },
        { playerKey: 'human-fau', username: 'Fau', kind: 'human' },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'VISRM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/VIS-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.publicVisible).toBe(true);
    expect(body.qualityFlags).toEqual([]);
  });

  it('flags reserved-test callsign matches as low-quality', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const r2 = createMockR2();
    const db = createMockDb();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('QA-m1'),
      findBaseHex,
    );
    state.phase = 'gameOver';
    state.outcome = { winner: 1, reason: 'Fleet eliminated!' };
    state.turnNumber = 4;

    await appendEnvelopedEvents(storage, asGameId('QA-m1'), null, {
      type: 'gameCreated',
      scenario: 'Duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });
    await storage.put('roomConfig', {
      code: 'QARM',
      scenario: 'duel',
      playerTokens: ['A'.repeat(32), 'B'.repeat(32)],
      players: [
        { playerKey: 'qa-key-1', username: 'QA_Probe_42', kind: 'human' },
        { playerKey: 'human-fau', username: 'Fau', kind: 'human' },
      ],
    });

    await archiveCompletedMatch(
      storage,
      r2 as unknown as R2Bucket,
      db as unknown as D1Database,
      state,
      'QARM',
    );

    const body = JSON.parse(
      r2.objects.get('matches/QA-m1.json') ?? '{}',
    ) as MatchArchive;
    expect(body.publicVisible).toBe(false);
    expect(body.qualityFlags).toContain('reserved_test_callsign');
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
      officialBotMatch: false,
      playerAUsername: null,
      playerBUsername: null,
      winnerUsername: null,
      publicVisible: true,
      qualityFlags: [],
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
