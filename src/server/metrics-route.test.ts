import { describe, expect, it, vi } from 'vitest';

import { handleMetricsRoute, type MetricsResponse } from './metrics-route';

const mockDb = (resultsQueue: unknown[]) => {
  const all = vi.fn(async () => ({
    results: (resultsQueue.shift() as unknown[]) ?? [],
  }));
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    all,
  };
};

describe('handleMetricsRoute', () => {
  it('requires a bearer token when not on a trusted loopback path', async () => {
    const { db } = mockDb([]);

    const response = await handleMetricsRoute(
      new Request('https://delta-v.test/api/metrics'),
      {
        DB: db,
        INTERNAL_METRICS_TOKEN: 'metrics-secret',
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'metrics_auth_required',
    });
  });

  it('returns aggregated metrics for an authorized request', async () => {
    const { db, prepare, bind } = mockDb([
      [
        { day: '2026-04-22', matches: 7 },
        { day: '2026-04-21', matches: 5 },
      ],
      [
        { scenario: 'duel', matches: 9 },
        { scenario: 'convoy', matches: 3 },
      ],
      [
        { difficulty: 'hard', games: 4 },
        { difficulty: 'normal', games: 2 },
      ],
      [{ completed: 8, started: 10 }],
      [{ errors: 3, started: 10 }],
      [{ succeeded: 6, failed: 2 }],
      [
        { scenario: 'duel', averageMs: 12500.7, turns: 18 },
        { scenario: 'convoy', averageMs: 20500.2, turns: 7 },
      ],
      [{ count: 2 }],
      [{ count: 1 }],
    ]);

    const response = await handleMetricsRoute(
      new Request('https://delta-v.test/api/metrics?days=14', {
        headers: {
          Authorization: 'Bearer metrics-secret',
        },
      }),
      {
        DB: db,
        INTERNAL_METRICS_TOKEN: 'metrics-secret',
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    const body = (await response.json()) as MetricsResponse;
    expect(body.windowDays).toBe(14);
    expect(body.dailyActiveMatches).toEqual([
      { day: '2026-04-22', matches: 7 },
      { day: '2026-04-21', matches: 5 },
    ]);
    expect(body.scenarioPlayMix).toEqual([
      { scenario: 'duel', matches: 9 },
      { scenario: 'convoy', matches: 3 },
    ]);
    expect(body.aiDifficultyDistribution).toEqual([
      { difficulty: 'hard', games: 4 },
      { difficulty: 'normal', games: 2 },
    ]);
    expect(body.firstTurnCompletion).toEqual({
      completed: 8,
      started: 10,
      rate: 0.8,
    });
    expect(body.wsHealth).toEqual({
      errors: 3,
      started: 10,
      errorRatePerMatch: 0.3,
    });
    expect(body.reconnects).toEqual({
      succeeded: 6,
      failed: 2,
      successRate: 0.75,
    });
    expect(body.averageTurnDurationByScenario).toEqual([
      { scenario: 'duel', averageMs: 12501, turns: 18 },
      { scenario: 'convoy', averageMs: 20500, turns: 7 },
    ]);
    expect(body.officialBot).toEqual({
      acceptedFills: 2,
      archivedMatches: 1,
    });

    expect(prepare).toHaveBeenCalledTimes(9);
    expect(bind).toHaveBeenCalledTimes(9);
  });

  it('allows loopback requests without a token in local dev/test', async () => {
    const { db } = mockDb([
      [],
      [],
      [],
      [{ completed: 0, started: 0 }],
      [{ errors: 0, started: 0 }],
      [{ succeeded: 0, failed: 0 }],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
    ]);

    const response = await handleMetricsRoute(
      new Request('http://127.0.0.1/api/metrics'),
      {
        DB: db,
        INTERNAL_METRICS_TOKEN: undefined,
      },
      { loopbackAllowed: true },
    );

    expect(response.status).toBe(200);
  });

  it('rejects invalid day windows', async () => {
    const { db } = mockDb([]);

    const response = await handleMetricsRoute(
      new Request('https://delta-v.test/api/metrics?days=999', {
        headers: {
          Authorization: 'Bearer metrics-secret',
        },
      }),
      {
        DB: db,
        INTERNAL_METRICS_TOKEN: 'metrics-secret',
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_query',
      message: 'Invalid days: 999. Maximum is 30.',
    });
  });
});
