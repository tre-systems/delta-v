import { describe, expect, it, vi } from 'vitest';

import {
  listUnretiredRatingArchiveOrphans,
  markRatingArchiveRetired,
} from './rating-archive-retention';

interface RatingRow {
  game_id: string;
  created_at: number;
  archive_retired_at: number | null;
  archive_retired_reason: string | null;
}

interface ArchiveRow {
  game_id: string;
}

const buildMockDb = (ratings: RatingRow[], archives: ArchiveRow[] = []) => {
  const ratingByGame = new Map(ratings.map((r) => [r.game_id, r]));
  const archiveByGame = new Map(archives.map((a) => [a.game_id, a]));

  const prepare = vi.fn((sql: string) => {
    const lowered = sql.toLowerCase();
    return {
      bind: (...args: unknown[]) => {
        if (lowered.startsWith('select mr.game_id')) {
          const [limit] = args as [number];
          const orphans = [...ratingByGame.values()]
            .filter(
              (r) =>
                !archiveByGame.has(r.game_id) && r.archive_retired_at === null,
            )
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((r) => ({ game_id: r.game_id, created_at: r.created_at }));
          return { all: async () => ({ results: orphans }) };
        }
        if (lowered.startsWith('update match_rating')) {
          const [retiredAt, reason, ...gameIds] = args as [
            number,
            string,
            ...string[],
          ];
          let changes = 0;
          for (const gid of gameIds) {
            const row = ratingByGame.get(gid);
            if (row && row.archive_retired_at === null) {
              row.archive_retired_at = retiredAt;
              row.archive_retired_reason = reason;
              changes++;
            }
          }
          return { run: async () => ({ meta: { changes } }) };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  });

  return {
    db: { prepare } as unknown as D1Database,
    ratingByGame,
  };
};

const seedRating = (
  game_id: string,
  created_at: number,
  retired = false,
): RatingRow => ({
  game_id,
  created_at,
  archive_retired_at: retired ? created_at + 1000 : null,
  archive_retired_reason: retired ? 'pre_audit_cleanup' : null,
});

describe('listUnretiredRatingArchiveOrphans', () => {
  it('returns rating rows whose archive is missing and not yet retired', async () => {
    const { db } = buildMockDb(
      [
        seedRating('A-m1', 100),
        seedRating('B-m1', 200),
        seedRating('C-m1', 300),
      ],
      [{ game_id: 'B-m1' }], // B has its archive
    );

    const orphans = await listUnretiredRatingArchiveOrphans(db);
    expect(orphans.map((o) => o.gameId).sort()).toEqual(['A-m1', 'C-m1']);
  });

  it('excludes rows that have already been marked retired', async () => {
    const { db } = buildMockDb([
      seedRating('A-m1', 100, true), // already retired
      seedRating('B-m1', 200, false),
    ]);

    const orphans = await listUnretiredRatingArchiveOrphans(db);
    expect(orphans.map((o) => o.gameId)).toEqual(['B-m1']);
  });

  it('returns rows newest-first and respects the limit', async () => {
    const { db } = buildMockDb([
      seedRating('A-m1', 100),
      seedRating('B-m1', 300),
      seedRating('C-m1', 200),
    ]);

    const orphans = await listUnretiredRatingArchiveOrphans(db, 2);
    expect(orphans.map((o) => o.gameId)).toEqual(['B-m1', 'C-m1']);
  });

  it('returns an empty array when every orphan is already retired', async () => {
    const { db } = buildMockDb([
      seedRating('A-m1', 100, true),
      seedRating('B-m1', 200, true),
    ]);

    const orphans = await listUnretiredRatingArchiveOrphans(db);
    expect(orphans).toEqual([]);
  });
});

describe('markRatingArchiveRetired', () => {
  it('writes the retired timestamp and reason for unretired rows', async () => {
    const { db, ratingByGame } = buildMockDb([
      seedRating('A-m1', 100),
      seedRating('B-m1', 200),
    ]);

    const result = await markRatingArchiveRetired(
      db,
      ['A-m1', 'B-m1'],
      'manual_redact',
      555,
    );
    expect(result.marked).toBe(2);
    expect(ratingByGame.get('A-m1')?.archive_retired_at).toBe(555);
    expect(ratingByGame.get('A-m1')?.archive_retired_reason).toBe(
      'manual_redact',
    );
    expect(ratingByGame.get('B-m1')?.archive_retired_at).toBe(555);
  });

  it('is idempotent: a second call leaves the original retired_at intact', async () => {
    const { db, ratingByGame } = buildMockDb([seedRating('A-m1', 100)]);

    await markRatingArchiveRetired(db, ['A-m1'], 'pre_audit_cleanup', 555);
    const result = await markRatingArchiveRetired(
      db,
      ['A-m1'],
      'manual_redact',
      999,
    );
    expect(result.marked).toBe(0);
    // First write wins — the existing retired_at + reason are preserved.
    expect(ratingByGame.get('A-m1')?.archive_retired_at).toBe(555);
    expect(ratingByGame.get('A-m1')?.archive_retired_reason).toBe(
      'pre_audit_cleanup',
    );
  });

  it('skips game ids that are missing from match_rating', async () => {
    const { db } = buildMockDb([seedRating('A-m1', 100)]);
    const result = await markRatingArchiveRetired(
      db,
      ['A-m1', 'GHOST-m1'],
      'manual_redact',
      555,
    );
    expect(result.marked).toBe(1);
  });

  it('returns marked: 0 for an empty input list without touching the db', async () => {
    const { db } = buildMockDb([seedRating('A-m1', 100)]);
    const prepareSpy = (db as unknown as { prepare: ReturnType<typeof vi.fn> })
      .prepare;
    const before = prepareSpy.mock.calls.length;
    const result = await markRatingArchiveRetired(db, [], 'manual_redact', 555);
    expect(result.marked).toBe(0);
    expect(prepareSpy.mock.calls.length).toBe(before);
  });
});
