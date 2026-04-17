import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { MatchmakerDO } from './matchmaker-do';

type MockStorage = DurableObjectStorage & {
  data: Map<string, unknown>;
};

const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();

  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value?: unknown) => {
      data.set(key, value);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    deleteAll: vi.fn(async () => {
      data.clear();
    }),
    setAlarm: vi.fn(async () => {}),
  } as unknown as MockStorage;
};

const createMatchmaker = (
  initImpl: (request: Request) => Promise<Response> = async () =>
    Response.json({ ok: true }, { status: 201 }),
  db?: D1Database,
) => {
  const storage = createMockStorage();
  const waitUntilPromises: Promise<unknown>[] = [];
  const initFetch = vi.fn(initImpl);
  const gameStub = {
    fetch: initFetch,
  } as unknown as DurableObjectStub;
  const matchmaker = new MatchmakerDO(
    {
      storage,
      waitUntil(promise: Promise<unknown>) {
        waitUntilPromises.push(promise);
      },
    } as unknown as DurableObjectState,
    {
      GAME: {
        idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
        get: vi.fn(() => gameStub),
      },
      ...(db ? { DB: db } : {}),
    } as unknown as {
      GAME: DurableObjectNamespace;
      DB?: D1Database;
    },
  );

  return { matchmaker, initFetch, storage, waitUntilPromises };
};

describe('MatchmakerDO additional coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed quick-match payloads', async () => {
    const { matchmaker } = createMatchmaker();

    const badJson = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        body: '{',
      }),
    );
    const missingPlayer = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: { username: 'Pilot' } }),
      }),
    );

    expect(badJson.status).toBe(400);
    expect(missingPlayer.status).toBe(400);
  });

  it('returns the same queued ticket when the same player re-enqueues', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

    const first = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );
    const firstPayload = (await first.json()) as { ticket: string };

    now.mockReturnValue(2_000);
    const second = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot Uno',
          },
        }),
      }),
    );

    await expect(second.json()).resolves.toEqual({
      status: 'queued',
      ticket: firstPayload.ticket,
      scenario: 'duel',
    });
    expect(initFetch).not.toHaveBeenCalled();
  });

  it('returns a matched response when an already-matched player re-enqueues', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker();

    const first = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );
    const firstPayload = (await first.json()) as { ticket: string };

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey2',
            username: 'Pilot Two',
          },
        }),
      }),
    );

    const repeat = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );

    await expect(repeat.json()).resolves.toMatchObject({
      status: 'matched',
      ticket: firstPayload.ticket,
      code: expect.any(String),
      playerToken: expect.any(String),
    });
  });

  it('expires old queue tickets', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker();

    const queued = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );
    const payload = (await queued.json()) as { ticket: string };

    now.mockReturnValue(16_500);
    const expired = await matchmaker.fetch(
      new Request(`https://matchmaker.internal/ticket/${payload.ticket}`, {
        method: 'GET',
      }),
    );

    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toMatchObject({
      status: 'expired',
      ticket: payload.ticket,
      reason: 'Queue expired',
    });
  });

  it('returns 503 when room allocation fails for a human match', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker(
      async () => new Response('boom', { status: 500 }),
    );

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );

    const second = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey2',
            username: 'Pilot Two',
          },
        }),
      }),
    );

    expect(second.status).toBe(503);
    expect(await second.text()).toBe('Failed to allocate quick match');
  });

  it('returns 404 for unsupported routes', async () => {
    const { matchmaker } = createMatchmaker();

    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/nope', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(404);
  });

  it('matches a second human pair after the first pair completes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

    const wave1a = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerwave1a', username: 'W1A' },
        }),
      }),
    );
    expect((await wave1a.json()) as { status: string }).toMatchObject({
      status: 'queued',
    });

    const wave1b = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerwave1b', username: 'W1B' },
        }),
      }),
    );
    const matched1 = (await wave1b.json()) as { status: string; code: string };
    expect(matched1).toMatchObject({ status: 'matched' });
    expect(initFetch).toHaveBeenCalledTimes(1);

    const wave2a = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerwave2a', username: 'W2A' },
        }),
      }),
    );
    expect((await wave2a.json()) as { status: string }).toMatchObject({
      status: 'queued',
    });

    const wave2b = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerwave2b', username: 'W2B' },
        }),
      }),
    );
    const matched2 = (await wave2b.json()) as { status: string; code: string };
    expect(matched2).toMatchObject({ status: 'matched' });
    expect(initFetch).toHaveBeenCalledTimes(2);
    expect(matched2.code).not.toBe(matched1.code);
  });

  it('retries room allocation when the game DO returns 409 collisions', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    let calls = 0;
    const { matchmaker, initFetch } = createMatchmaker(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('collision', { status: 409 });
      }
      return Response.json({ ok: true }, { status: 201 });
    });

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'player409aaa', username: 'Pilot A' },
        }),
      }),
    );

    const second = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'player409bbb', username: 'Pilot B' },
        }),
      }),
    );

    expect(second.status).toBe(200);
    expect((await second.json()) as { status: string }).toMatchObject({
      status: 'matched',
    });
    expect(initFetch).toHaveBeenCalledTimes(2);
  });

  it('emits a matchmaker_pairing_split console.error when allocation retries', async () => {
    // Regression for P2-6: split pairings should be observable in production.
    // We intercept console.error because the test harness doesn't provide a
    // D1 binding; the structured log line is enough to verify the event is
    // fired at the right moment.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    let calls = 0;
    const { matchmaker } = createMatchmaker(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('collision', { status: 409 });
      }
      return Response.json({ ok: true }, { status: 201 });
    });

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerSplitA', username: 'Pilot A' },
        }),
      }),
    );

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'playerSplitB', username: 'Pilot B' },
        }),
      }),
    );

    const splitLogCall = errorSpy.mock.calls.find(
      ([tag]) =>
        typeof tag === 'string' && tag.includes('matchmaker_pairing_split'),
    );
    expect(splitLogCall).toBeDefined();
  });

  it('best-effort claims matched players into leaderboard rows', async () => {
    const rowsByKey = new Map<string, Record<string, unknown>>();
    const rowsByUsername = new Map<string, Record<string, unknown>>();
    const db = {
      prepare(sql: string) {
        const lowered = sql.toLowerCase();
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => {
                if (lowered.includes('from player where player_key')) {
                  return (rowsByKey.get(args[0] as string) ?? null) as Record<
                    string,
                    unknown
                  > | null;
                }
                return null;
              },
              run: async () => {
                if (lowered.startsWith('insert into player')) {
                  const [playerKey, username, isAgent, createdAt] = args as [
                    string,
                    string,
                    number,
                    number,
                  ];
                  if (rowsByUsername.has(username)) {
                    throw new Error(
                      'UNIQUE constraint failed: player.username',
                    );
                  }
                  const row = {
                    player_key: playerKey,
                    username,
                    is_agent: isAgent,
                    rating: 1500,
                    rd: 350,
                    volatility: 0.06,
                    games_played: 0,
                    distinct_opponents: 0,
                    last_match_at: null,
                    created_at: createdAt,
                  };
                  rowsByKey.set(playerKey, row);
                  rowsByUsername.set(username, row);
                  return { success: true };
                }
                if (lowered.startsWith('update player set username')) {
                  const [username, playerKey] = args as [string, string];
                  if (rowsByUsername.has(username)) {
                    throw new Error(
                      'UNIQUE constraint failed: player.username',
                    );
                  }
                  const existing = rowsByKey.get(playerKey);
                  if (existing) {
                    rowsByUsername.delete(existing.username as string);
                    existing.username = username;
                    rowsByUsername.set(username, existing);
                  }
                  return { success: true };
                }
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, waitUntilPromises } = createMatchmaker(undefined, db);

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_dupkey01',
            username: 'Duplicate Name',
          },
        }),
      }),
    );
    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'human_dupkey02',
            username: 'Duplicate Name',
          },
        }),
      }),
    );
    await Promise.all(waitUntilPromises);

    expect(rowsByKey.get('agent_dupkey01')).toMatchObject({
      is_agent: 1,
    });
    expect(rowsByKey.get('human_dupkey02')).toMatchObject({
      is_agent: 0,
    });
    // One duplicate name must be resolved via fallback default username.
    const usernames = Array.from(rowsByUsername.keys());
    expect(usernames).toContain('Duplicate Name');
    expect(usernames.length).toBe(2);
  });
});
