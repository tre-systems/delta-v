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
) => {
  const storage = createMockStorage();
  const initFetch = vi.fn(initImpl);
  const gameStub = {
    fetch: initFetch,
  } as unknown as DurableObjectStub;
  const matchmaker = new MatchmakerDO(
    { storage } as unknown as DurableObjectState,
    {
      GAME: {
        idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
        get: vi.fn(() => gameStub),
      },
    } as unknown as {
      GAME: DurableObjectNamespace;
    },
  );

  return { matchmaker, initFetch, storage };
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
});
