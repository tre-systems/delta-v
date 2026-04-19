import { describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import { handleMatchesList, type MatchListingResponse } from './matches-list';

// Minimal D1 stub. `prepare()` returns an object whose `.bind()` returns
// another object with `.all()` — matching the real D1PreparedStatement shape.
const mockDb = (rows: Record<string, unknown>[]) => {
  const lastCall: { sql?: string; args?: unknown[] } = {};
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn((...args: unknown[]) => {
    lastCall.args = args;
    return { all };
  });
  const prepare = vi.fn((sql: string) => {
    lastCall.sql = sql;
    return { bind };
  });
  return {
    db: { prepare } as unknown as D1Database,
    lastCall,
    all,
    bind,
    prepare,
  };
};

const buildEnv = (db: D1Database | undefined): Env =>
  ({ DB: db }) as unknown as Env;

const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  game_id: overrides.game_id ?? 'G-1',
  room_code: overrides.room_code ?? 'ABCDE',
  scenario: overrides.scenario ?? 'duel',
  winner: 'winner' in overrides ? overrides.winner : 0,
  win_reason: overrides.win_reason ?? 'Fleet eliminated',
  turns: overrides.turns ?? 12,
  created_at: overrides.created_at ?? 1_000,
  completed_at: overrides.completed_at ?? 2_000,
  match_coached: overrides.match_coached ?? 0,
  winner_username:
    'winner_username' in overrides ? overrides.winner_username : null,
  loser_username:
    'loser_username' in overrides ? overrides.loser_username : null,
});

describe('handleMatchesList', () => {
  it('returns a JSON listing sorted by completion time', async () => {
    const rows = [
      makeRow({ game_id: 'newer', completed_at: 3_000 }),
      makeRow({ game_id: 'older', completed_at: 2_000 }),
    ];
    const { db, prepare, bind } = mockDb(rows);

    const response = await handleMatchesList(
      new Request('https://delta-v.tre.systems/api/matches'),
      buildEnv(db),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches).toHaveLength(2);
    expect(body.matches[0].gameId).toBe('newer');
    expect(body.matches[1].gameId).toBe('older');
    expect(body.limit).toBe(50);
    expect(body.nextBefore).toBeNull();

    // Default path uses LIMIT only (no `WHERE completed_at < ?`).
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0] as string).not.toContain('completed_at <');
    // fetchSize = limit + 1 = 51 for the default limit.
    expect(bind).toHaveBeenCalledWith(51);
  });

  it('accepts custom limits up to 100', async () => {
    const { db, bind } = mockDb([]);
    await handleMatchesList(
      new Request('https://example/api/matches?limit=100'),
      buildEnv(db),
    );
    expect(bind).toHaveBeenCalledWith(101);
  });

  it('rejects invalid limit values', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?limit=not-a-number'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid limit. Expected a positive integer.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects oversized limit values', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?limit=500'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid limit: 500. Maximum is 100.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses WHERE completed_at < ? for pagination via ?before', async () => {
    const { db, prepare, bind } = mockDb([]);
    await handleMatchesList(
      new Request('https://example/api/matches?before=1234'),
      buildEnv(db),
    );
    expect(prepare.mock.calls[0][0] as string).toContain('completed_at < ?');
    expect(bind).toHaveBeenCalledWith(1234, 51);
  });

  it('filters by scenario when requested', async () => {
    const { db, prepare, bind } = mockDb([]);
    await handleMatchesList(
      new Request('https://example/api/matches?scenario=convoy'),
      buildEnv(db),
    );
    expect(prepare.mock.calls[0][0] as string).toContain('ma.scenario = ?');
    expect(bind).toHaveBeenCalledWith('convoy', 51);
  });

  it('filters by winner when requested', async () => {
    const { db, prepare, bind } = mockDb([]);
    await handleMatchesList(
      new Request('https://example/api/matches?winner=1'),
      buildEnv(db),
    );
    expect(prepare.mock.calls[0][0] as string).toContain('ma.winner = ?');
    expect(bind).toHaveBeenCalledWith(1, 51);
  });

  it('filters draws via winner=draw', async () => {
    const { db, prepare, bind } = mockDb([]);
    await handleMatchesList(
      new Request('https://example/api/matches?winner=draw'),
      buildEnv(db),
    );
    expect(prepare.mock.calls[0][0] as string).toContain('ma.winner IS NULL');
    expect(bind).toHaveBeenCalledWith(51);
  });

  it('composes before, scenario, and winner filters in binding order', async () => {
    const { db, prepare, bind } = mockDb([]);
    await handleMatchesList(
      new Request(
        'https://example/api/matches?before=1234&scenario=duel&winner=0',
      ),
      buildEnv(db),
    );
    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain('ma.completed_at < ?');
    expect(sql).toContain('ma.scenario = ?');
    expect(sql).toContain('ma.winner = ?');
    expect(bind).toHaveBeenCalledWith(1234, 'duel', 0, 51);
  });

  it('rejects malformed before values', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?before=garbage'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid before cursor: garbage. Expected a positive integer.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects invalid status filters instead of ignoring them', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?status=paused'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid status filter: paused. Expected archived or live.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects unknown scenarios instead of ignoring them', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?scenario=nonexistent'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Unknown scenario: nonexistent',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects invalid winner values', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?winner=banana'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid winner filter: banana. Expected 0, 1, or draw.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects unsupported offset pagination', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?offset=50'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Unsupported query parameter: offset. Use before pagination.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects unsupported query parameters instead of ignoring them', async () => {
    const { db, prepare } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches?foo=bar'),
      buildEnv(db),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Unsupported query parameter: foo.',
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns nextBefore when more results are available', async () => {
    // Request limit=2. DB returns 3 rows (limit + 1). Response should trim
    // to 2 rows and set nextBefore to the last returned completedAt.
    const rows = [
      makeRow({ game_id: 'a', completed_at: 5_000 }),
      makeRow({ game_id: 'b', completed_at: 4_000 }),
      makeRow({ game_id: 'c', completed_at: 3_000 }),
    ];
    const { db } = mockDb(rows);

    const response = await handleMatchesList(
      new Request('https://example/api/matches?limit=2'),
      buildEnv(db),
    );
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches).toHaveLength(2);
    expect(body.matches.map((m) => m.gameId)).toEqual(['a', 'b']);
    expect(body.nextBefore).toBe(4_000);
  });

  it('camelCases D1 rows and coerces match_coached to boolean', async () => {
    const { db } = mockDb([
      makeRow({
        game_id: 'X',
        room_code: 'ROOM1',
        scenario: 'convoy',
        winner: 1,
        win_reason: 'Reached objective',
        turns: 8,
        created_at: 111,
        completed_at: 222,
        match_coached: 1,
      }),
    ]);

    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches[0]).toEqual({
      gameId: 'X',
      roomCode: 'ROOM1',
      scenario: 'convoy',
      winner: 1,
      winReason: 'Reached objective',
      turns: 8,
      createdAt: 111,
      completedAt: 222,
      coached: true,
      winnerUsername: null,
      loserUsername: null,
    });
  });

  it('does not surface public usernames in the matches listing', async () => {
    const { db } = mockDb([
      makeRow({
        winner_username: 'Zephyr',
        loser_username: 'Pilot_42',
      }),
    ]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches[0].winnerUsername).toBeNull();
    expect(body.matches[0].loserUsername).toBeNull();
  });

  it('leaves usernames null when unclaimed / private-room matches', async () => {
    const { db } = mockDb([makeRow()]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches[0].winnerUsername).toBeNull();
    expect(body.matches[0].loserUsername).toBeNull();
  });

  it('normalises invalid winner values to null (draw)', async () => {
    const { db } = mockDb([makeRow({ winner: 7 })]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches[0].winner).toBeNull();
  });

  it('returns an empty listing when D1 is not bound', async () => {
    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(undefined),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as MatchListingResponse;
    expect(body).toEqual({ matches: [], limit: 50, nextBefore: null });
  });

  it('sets a short cache header', async () => {
    const { db } = mockDb([]);
    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    expect(response.headers.get('cache-control')).toContain('max-age=10');
  });

  // D1 sometimes returns `{ results: undefined }` on an empty query — the
  // listing should tolerate that without throwing, returning an empty page.
  it('tolerates D1 returning undefined results', async () => {
    const all = vi.fn(async () => ({ results: undefined }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const response = await handleMatchesList(
      new Request('https://example/api/matches'),
      buildEnv(db),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as MatchListingResponse;
    expect(body.matches).toEqual([]);
    expect(body.nextBefore).toBeNull();
  });
});
