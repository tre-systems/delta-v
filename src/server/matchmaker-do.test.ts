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

const createCtx = () => ({
  storage: createMockStorage(),
  waitUntil(_promise: Promise<unknown>) {},
});

const createMatchmaker = () => {
  const initFetch = vi.fn<(request: Request) => Promise<Response>>(
    async (_request) => Response.json({ ok: true }, { status: 201 }),
  );
  const ctx = createCtx();
  const gameStub = {
    fetch: initFetch,
  } as unknown as DurableObjectStub;
  const matchmaker = new MatchmakerDO(
    ctx as unknown as DurableObjectState,
    {
      GAME: {
        idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
        get: vi.fn(() => gameStub),
      },
    } as unknown as {
      GAME: DurableObjectNamespace;
    },
  );

  return { matchmaker, ctx, initFetch };
};

describe('MatchmakerDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues the first player and returns a ticket', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker();

    const response = await matchmaker.fetch(
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'queued',
      scenario: 'duel',
      ticket: expect.any(String),
    });
  });

  it('matches queued players together before bot fill', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

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

    const response = await matchmaker.fetch(
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

    const payload = (await response.json()) as {
      status: string;
      code?: string;
      playerToken?: string;
    };

    expect(payload).toMatchObject({
      status: 'matched',
      code: expect.any(String),
      playerToken: expect.any(String),
    });
    expect(initFetch).toHaveBeenCalledTimes(1);
    const firstInitRequest = initFetch.mock.calls[0]?.[0];
    expect(firstInitRequest).toBeInstanceOf(Request);
    if (!firstInitRequest) {
      throw new Error('Expected first init request');
    }
    await expect(firstInitRequest.json()).resolves.toMatchObject({
      scenario: 'duel',
      players: [
        expect.objectContaining({
          playerKey: 'playerkey2',
          username: 'Pilot Two',
          kind: 'human',
        }),
        expect.objectContaining({
          playerKey: 'playerkey1',
          username: 'Pilot One',
          kind: 'human',
        }),
      ],
    });
  });

  it('assigns agent kind by player key for either seat', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_bot12345',
            username: 'Bot One',
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
            playerKey: 'humanplay123',
            username: 'Pilot Human',
          },
        }),
      }),
    );

    const firstInitRequest = initFetch.mock.calls[0]?.[0];
    expect(firstInitRequest).toBeInstanceOf(Request);
    if (!firstInitRequest) {
      throw new Error('Expected first init request');
    }
    await expect(firstInitRequest.json()).resolves.toMatchObject({
      players: [
        expect.objectContaining({
          playerKey: 'humanplay123',
          kind: 'human',
        }),
        expect.objectContaining({
          playerKey: 'agent_bot12345',
          kind: 'agent',
        }),
      ],
    });
  });

  it('keeps waiting for another queued player after the old bot-fill threshold', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

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
    const queuedPayload = (await queued.json()) as { ticket: string };

    now.mockReturnValue(11_500);
    const response = await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'queued',
      ticket: queuedPayload.ticket,
      scenario: 'duel',
    });
    expect(initFetch).not.toHaveBeenCalled();
  });
});
