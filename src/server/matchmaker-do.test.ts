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

import { OFFICIAL_QUICK_MATCH_BOT_WAIT_MS } from '../shared/matchmaking';
import {
  OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
  OFFICIAL_QUICK_MATCH_BOT_USERNAME,
} from '../shared/player';
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

const createMatchmaker = (options?: {
  devMode?: string;
  officialBotEnabled?: string;
  liveRegistryFetch?: (request: Request) => Promise<Response>;
}) => {
  const initFetch = vi.fn<(request: Request) => Promise<Response>>(
    async (_request) => Response.json({ ok: true }, { status: 201 }),
  );
  const liveRegistryFetch = vi.fn(
    options?.liveRegistryFetch ??
      (async () => Response.json({ active: false }, { status: 200 })),
  );
  const ctx = createCtx();
  const gameStub = {
    fetch: initFetch,
  } as unknown as DurableObjectStub;
  const liveRegistryStub = {
    fetch: liveRegistryFetch,
  } as unknown as DurableObjectStub;
  const matchmaker = new MatchmakerDO(
    ctx as unknown as DurableObjectState,
    {
      GAME: {
        idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
        get: vi.fn(() => gameStub),
      },
      LIVE_REGISTRY: {
        idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
        get: vi.fn(() => liveRegistryStub),
      },
      ...(options?.devMode !== undefined ? { DEV_MODE: options.devMode } : {}),
      ...(options?.officialBotEnabled !== undefined
        ? { OFFICIAL_QUICK_MATCH_BOT_ENABLED: options.officialBotEnabled }
        : {}),
    } as unknown as {
      GAME: DurableObjectNamespace;
      LIVE_REGISTRY: DurableObjectNamespace;
      DEV_MODE?: string;
      OFFICIAL_QUICK_MATCH_BOT_ENABLED?: string;
    },
  );

  return { matchmaker, ctx, initFetch, liveRegistryFetch };
};

describe('MatchmakerDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates the requested scenario to the paired room init', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'convoy',
          player: { playerKey: 'playerkey1', username: 'Pilot One' },
        }),
      }),
    );
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'convoy',
          player: { playerKey: 'playerkey2', username: 'Pilot Two' },
        }),
      }),
    );

    const payload = (await response.json()) as {
      status: string;
      scenario: string;
    };
    expect(payload.status).toBe('matched');
    expect(payload.scenario).toBe('convoy');

    expect(initFetch).toHaveBeenCalledTimes(1);
    const initRequest = initFetch.mock.calls[0]?.[0];
    if (!initRequest) throw new Error('Expected init request');
    await expect(initRequest.json()).resolves.toMatchObject({
      scenario: 'convoy',
    });
  });

  it('does not match players across different requested scenarios', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker();

    await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'duel',
          player: { playerKey: 'duelplayerA', username: 'Duel A' },
        }),
      }),
    );
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'convoy',
          player: { playerKey: 'convoyplayerB', username: 'Convoy B' },
        }),
      }),
    );

    const payload = (await response.json()) as { status: string };
    expect(payload.status).toBe('queued');
    expect(initFetch).not.toHaveBeenCalled();
  });

  it('falls back to the default scenario when the request contains an unknown one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker();

    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'not-a-real-scenario',
          player: { playerKey: 'playerkey1', username: 'Pilot One' },
        }),
      }),
    );
    const payload = (await response.json()) as { scenario: string };
    expect(payload.scenario).toBe('duel');
  });

  it('returns 503 when the active queue is saturated', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { matchmaker } = createMatchmaker();

    // Fill the queue with 200 unique queued players. All of them queue
    // against distinct keys so none pair with each other.
    for (let i = 0; i < 200; i++) {
      const playerKey = `saturate_${String(i).padStart(4, '0')}_xxxx`;
      const response = await matchmaker.fetch(
        new Request('https://matchmaker.internal/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: { playerKey, username: `Pilot ${i}` },
          }),
        }),
      );
      // Every enqueue up to the cap stays queued (no pair available in
      // isolation because of HEARTBEAT_TTL_MS semantics across entries).
      expect(response.status).toBeLessThan(500);
    }

    const blocked = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: { playerKey: 'saturate_overflow_z', username: 'Overflow' },
        }),
      }),
    );
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('Retry-After')).toBe('30');
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
      officialBotOfferAvailable: false,
      officialBotWaitMsRemaining: OFFICIAL_QUICK_MATCH_BOT_WAIT_MS,
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
      officialBotOfferAvailable: false,
      officialBotWaitMsRemaining: 9_500,
    });
    expect(initFetch).not.toHaveBeenCalled();
  });

  it('fills a lone queue ticket with a dev bot when DEV_MODE=1 after the wait threshold', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker({ devMode: '1' });

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
      status: 'matched',
      ticket: queuedPayload.ticket,
      scenario: 'duel',
      code: expect.any(String),
      playerToken: expect.any(String),
    });
    expect(initFetch).toHaveBeenCalledTimes(1);
    const initRequest = initFetch.mock.calls[0]?.[0];
    if (!initRequest) throw new Error('Expected init request');
    await expect(initRequest.json()).resolves.toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({
          playerKey: 'playerkey1',
          kind: 'human',
        }),
        expect.objectContaining({
          playerKey: `agent_devqm_${queuedPayload.ticket}`,
          username: 'QM Bot',
          kind: 'agent',
        }),
      ]),
    });
  });

  it('does not fill a queued ticket with the official bot before the production wait threshold', async () => {
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

    now.mockReturnValue(11_000);
    await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    now.mockReturnValue(1_000 + OFFICIAL_QUICK_MATCH_BOT_WAIT_MS - 500);
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptOfficialBotMatch: true,
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
      ticket: queuedPayload.ticket,
      scenario: 'duel',
      officialBotOfferAvailable: false,
      officialBotWaitMsRemaining: 500,
    });
    expect(initFetch).not.toHaveBeenCalled();
  });

  it('fills a queued ticket with the official bot after the production wait threshold when explicitly accepted', async () => {
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

    now.mockReturnValue(11_000);
    await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    now.mockReturnValue(1_000 + OFFICIAL_QUICK_MATCH_BOT_WAIT_MS + 500);
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptOfficialBotMatch: true,
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'matched',
      ticket: queuedPayload.ticket,
      scenario: 'duel',
      code: expect.any(String),
      playerToken: expect.any(String),
    });
    expect(initFetch).toHaveBeenCalledTimes(1);
    const initRequest = initFetch.mock.calls[0]?.[0];
    if (!initRequest) throw new Error('Expected init request');
    await expect(initRequest.json()).resolves.toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({
          playerKey: 'playerkey1',
          kind: 'human',
        }),
        expect.objectContaining({
          playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
          username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
          kind: 'agent',
        }),
      ]),
    });
  });

  it('does not fill a queued ticket with the official bot when the server kill switch disables it', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker({
      officialBotEnabled: '0',
    });

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

    now.mockReturnValue(11_000);
    await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    now.mockReturnValue(1_000 + OFFICIAL_QUICK_MATCH_BOT_WAIT_MS + 500);
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptOfficialBotMatch: true,
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
      ticket: queuedPayload.ticket,
      scenario: 'duel',
      officialBotOfferAvailable: false,
      officialBotWaitMsRemaining: null,
    });
    expect(initFetch).not.toHaveBeenCalled();
  });

  it('surfaces official bot offer availability on queued responses after the wait threshold', async () => {
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

    const queuedPayload = (await queued.json()) as { ticket: string };

    now.mockReturnValue(11_000);
    await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    now.mockReturnValue(1_000 + OFFICIAL_QUICK_MATCH_BOT_WAIT_MS + 1_000);
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
      officialBotOfferAvailable: true,
      officialBotWaitMsRemaining: 0,
    });
  });

  it('allows the stable official bot to pair even when the live registry reports that key as active elsewhere', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { matchmaker, initFetch } = createMatchmaker({
      liveRegistryFetch: async (request) => {
        const playerKey = decodeURIComponent(
          request.url.split('/').at(-1) ?? '',
        );
        if (playerKey === OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY) {
          return Response.json({
            active: true,
            code: 'OTHER',
            scenario: 'duel',
          });
        }
        return Response.json({ active: false });
      },
    });

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

    now.mockReturnValue(11_000);
    await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );

    now.mockReturnValue(1_000 + OFFICIAL_QUICK_MATCH_BOT_WAIT_MS + 500);
    const response = await matchmaker.fetch(
      new Request('https://matchmaker.internal/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptOfficialBotMatch: true,
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'matched',
      ticket: queuedPayload.ticket,
      code: expect.any(String),
      playerToken: expect.any(String),
    });
    expect(initFetch).toHaveBeenCalledTimes(1);
  });

  it('can assign the waiting player to seat 0 when the shuffle flips', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
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

    const initRequest = initFetch.mock.calls[0]?.[0];
    if (!initRequest) throw new Error('Expected init request');
    const initBody = (await initRequest.json()) as {
      players: [{ playerKey: string }, { playerKey: string }];
      playerToken: string;
      guestPlayerToken: string;
    };
    expect(initBody).toMatchObject({
      players: [
        expect.objectContaining({ playerKey: 'playerkey1' }),
        expect.objectContaining({ playerKey: 'playerkey2' }),
      ],
    });

    const matchedQueued = await matchmaker.fetch(
      new Request(
        `https://matchmaker.internal/ticket/${queuedPayload.ticket}`,
        {
          method: 'GET',
        },
      ),
    );
    const matchedPayload = (await matchedQueued.json()) as {
      playerToken: string;
    };
    expect(matchedPayload.playerToken).toBe(initBody.playerToken);
  });
});
