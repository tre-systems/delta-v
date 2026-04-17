import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import { handlePlayerRank, type PlayerRankResponse } from './player-rank';

// Mock D1 that dispatches on the two SQL shapes used by player-rank.
const mockDb = (row: Record<string, unknown> | null, countN: number) => {
  const prepare = vi.fn((sql: string) => {
    const lowered = sql.toLowerCase();
    return {
      bind: () => ({
        first: async () => {
          if (lowered.includes('count(*)')) {
            return { n: countN };
          }
          return row;
        },
      }),
    };
  });
  return { db: { prepare } as unknown as D1Database };
};

const env = (db?: D1Database): Env => ({ DB: db }) as unknown as Env;

const get = (playerKey: string): Request =>
  new Request(
    `https://w.test/api/leaderboard/me?playerKey=${encodeURIComponent(playerKey)}`,
  );

describe('handlePlayerRank', () => {
  it('rejects non-GET methods', async () => {
    const res = await handlePlayerRank(
      new Request('https://w.test/api/leaderboard/me?playerKey=aaaaaaaa', {
        method: 'POST',
      }),
      env(),
    );
    expect(res.status).toBe(405);
  });

  it('rejects invalid playerKey', async () => {
    const res = await handlePlayerRank(get('short'), env());
    expect(res.status).toBe(400);
  });

  it('returns 503 when D1 is unbound', async () => {
    const res = await handlePlayerRank(get('human_alpha-v1'), env());
    expect(res.status).toBe(503);
  });

  it('returns 404 when no row exists for the key', async () => {
    const { db } = mockDb(null, 0);
    const res = await handlePlayerRank(get('human_alpha-v1'), env(db));
    expect(res.status).toBe(404);
  });

  it('returns provisional=true and rank=null for new players', async () => {
    const { db } = mockDb(
      {
        username: 'Rookie',
        rating: 1500,
        rd: 350,
        games_played: 0,
        distinct_opponents: 0,
      },
      0,
    );
    const res = await handlePlayerRank(get('human_alpha-v1'), env(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlayerRankResponse;
    expect(body).toEqual({
      username: 'Rookie',
      rating: 1500,
      rd: 350,
      gamesPlayed: 0,
      provisional: true,
      rank: null,
    });
  });

  it('computes rank as count_of_higher + 1 for ranked players', async () => {
    const { db } = mockDb(
      {
        username: 'Veteran',
        rating: 1650,
        rd: 80,
        games_played: 20,
        distinct_opponents: 10,
      },
      6, // six non-provisional players have higher rating
    );
    const res = await handlePlayerRank(get('human_alpha-v1'), env(db));
    const body = (await res.json()) as PlayerRankResponse;
    expect(body.provisional).toBe(false);
    expect(body.rank).toBe(7);
  });

  it('returns rank = 1 when nobody outranks the player', async () => {
    const { db } = mockDb(
      {
        username: 'TopDog',
        rating: 2000,
        rd: 80,
        games_played: 30,
        distinct_opponents: 15,
      },
      0,
    );
    const res = await handlePlayerRank(get('human_alpha-v1'), env(db));
    const body = (await res.json()) as PlayerRankResponse;
    expect(body.rank).toBe(1);
  });

  it('sets a short cache header', async () => {
    const { db } = mockDb(
      {
        username: 'X',
        rating: 1500,
        rd: 350,
        games_played: 0,
        distinct_opponents: 0,
      },
      0,
    );
    const res = await handlePlayerRank(get('human_alpha-v1'), env(db));
    expect(res.headers.get('cache-control')).toContain('s-maxage=30');
  });
});
