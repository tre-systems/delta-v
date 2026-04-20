import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import {
  handleLeaderboardQuery,
  type LeaderboardResponse,
} from './query-route';

const mockDb = (rows: Record<string, unknown>[]) => {
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    db: { prepare } as unknown as D1Database,
    all,
    bind,
    prepare,
  };
};

const env = (db: D1Database | undefined): Env => ({ DB: db }) as unknown as Env;

const row = (overrides: Record<string, unknown> = {}) => ({
  username: 'Alpha',
  is_agent: 0,
  rating: 1600,
  rd: 90,
  games_played: 15,
  distinct_opponents: 7,
  last_match_at: 1_000,
  ...overrides,
});

describe('handleLeaderboardQuery', () => {
  it('returns an empty listing when D1 is unbound', async () => {
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard'),
      env(undefined),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries).toEqual([]);
    expect(body.limit).toBe(100);
    expect(body.includeProvisional).toBe(false);
  });

  it('returns only ranked entries by default', async () => {
    const { db } = mockDb([
      row({ username: 'Ranked', rating: 1700, rd: 80 }),
      // RD too high → provisional
      row({ username: 'Rookie', rating: 1600, rd: 150 }),
      // Not enough games → provisional
      row({ username: 'Sparse', rating: 1650, games_played: 5 }),
    ]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard'),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries.map((e) => e.username)).toEqual(['Ranked']);
    expect(body.entries[0].provisional).toBe(false);
  });

  it('includes provisional entries when ?includeProvisional=true', async () => {
    const { db } = mockDb([
      row({ username: 'Ranked', rating: 1700, rd: 80 }),
      row({ username: 'Rookie', rating: 1600, rd: 150 }),
    ]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?includeProvisional=true'),
      env(db),
    );
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].provisional).toBe(false);
    expect(body.entries[1].provisional).toBe(true);
  });

  it('hides claimed callsigns that have never played, even in provisional view', async () => {
    const { db } = mockDb([
      row({ username: 'Actual', rating: 1500, rd: 120, games_played: 3 }),
      // Claimed callsign with no completed games — rating still default.
      row({ username: 'Lurker', rating: 1500, rd: 350, games_played: 0 }),
    ]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?includeProvisional=true'),
      env(db),
    );
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries.map((e) => e.username)).toEqual(['Actual']);
  });

  it('filters reserved exploratory usernames from the public leaderboard', async () => {
    const { db } = mockDb([
      row({ username: 'QA_Probe_A', rating: 1800, rd: 80 }),
      row({ username: 'Probe_B', rating: 1750, rd: 80 }),
      row({ username: 'Bot_C', rating: 1700, rd: 80, is_agent: 1 }),
      row({ username: 'RankedPilot', rating: 1650, rd: 80 }),
    ]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?includeProvisional=true'),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries.map((entry) => entry.username)).toEqual([
      'RankedPilot',
    ]);
  });

  it('respects the limit parameter (ranked-only)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ username: `P${i}`, rating: 2000 - i }),
    );
    const { db } = mockDb(rows);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?limit=3'),
      env(db),
    );
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].username).toBe('P0');
  });

  it('rejects invalid limit values instead of silently capping', async () => {
    const { db, bind } = mockDb([]);
    const res = await handleLeaderboardQuery(
      new Request(
        'https://w.test/api/leaderboard?limit=10000&includeProvisional=true',
      ),
      env(db),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_query',
      message: 'Invalid limit: 10000. Expected an integer between 1 and 200.',
    });
    expect(bind).not.toHaveBeenCalled();
  });

  it('rejects malformed includeProvisional values', async () => {
    const { db } = mockDb([]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?includeProvisional=garbage'),
      env(db),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_query',
      message:
        'Invalid includeProvisional value: garbage. Expected true or false.',
    });
  });

  it('rejects unsupported query parameters', async () => {
    const { db } = mockDb([]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard?ofset=10'),
      env(db),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_query',
      message: 'Unsupported query parameter: ofset',
    });
  });

  it('rounds rating and rd for display', async () => {
    const { db } = mockDb([row({ rating: 1612.7, rd: 85.4 })]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard'),
      env(db),
    );
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries[0].rating).toBe(1613);
    expect(body.entries[0].rd).toBe(85);
  });

  it('flags is_agent rows as isAgent:true', async () => {
    const { db } = mockDb([
      row({ username: 'Zephyr', is_agent: 1 }),
      row({ username: 'Pilot', is_agent: 0 }),
    ]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard'),
      env(db),
    );
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.entries[0].isAgent).toBe(true);
    expect(body.entries[1].isAgent).toBe(false);
  });

  it('rejects non-GET methods', async () => {
    const { db } = mockDb([]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard', { method: 'POST' }),
      env(db),
    );
    expect(res.status).toBe(405);
  });

  it('sets a CDN-friendly cache header', async () => {
    const { db } = mockDb([]);
    const res = await handleLeaderboardQuery(
      new Request('https://w.test/api/leaderboard'),
      env(db),
    );
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
  });
});
