import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./game-do/game-do', () => ({
  GameDO: class GameDO {},
}));

import worker, { createRateMap, type Env, hashIp } from './index';

type MockDb = ReturnType<typeof mockDb>;
type MockExecutionContext = ExecutionContext & {
  waitUntil: ReturnType<typeof vi.fn<(p: Promise<unknown>) => void>>;
  passThroughOnException: ReturnType<typeof vi.fn<() => void>>;
  props: Record<string, never>;
};
type MockEnv = {
  ASSETS: {
    fetch: ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;
  };
  GAME: {
    idFromName: ReturnType<typeof vi.fn<(code: string) => DurableObjectId>>;
    get: ReturnType<typeof vi.fn<(id: DurableObjectId) => DurableObjectStub>>;
  };
  DB: MockDb;
};

const mockDb = () => {
  const runFn = vi.fn(async () => ({}));
  const bindFn = vi.fn(() => ({ run: runFn }));
  const prepareFn = vi.fn(() => ({ bind: bindFn }));

  return {
    prepare: prepareFn,
    _bind: bindFn,
    _run: runFn,
  };
};

const mockCtx = (): MockExecutionContext => ({
  waitUntil: vi.fn((p: Promise<unknown>) => {
    void p.catch(() => {});
  }),
  passThroughOnException: vi.fn(),
  props: {},
});

const createEnv = (
  initHandler?: (request: Request) => Promise<Response> | Response,
) => {
  const assetsFetch = vi.fn(async () => new Response('asset ok'));

  const initFetch = vi.fn(async (request: Request) => {
    if (initHandler) {
      return await initHandler(request);
    }
    return Response.json({ ok: true }, { status: 201 });
  });

  const stub = {
    fetch: initFetch,
  } as unknown as DurableObjectStub;

  const env: MockEnv = {
    ASSETS: { fetch: assetsFetch },
    GAME: {
      idFromName: vi.fn(
        (code: string) => `id:${code}` as unknown as DurableObjectId,
      ),
      get: vi.fn(() => stub),
    },
    DB: mockDb(),
  };

  return { env, assetsFetch, initFetch };
};

describe('server index worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates rooms with generated tokens and defaults invalid payloads to biplanetary', async () => {
    let initPayload: Record<string, unknown> | null = null;

    const { env, initFetch } = createEnv(async (request) => {
      initPayload = (await request.json()) as Record<string, unknown>;
      return Response.json({ ok: true }, { status: 201 });
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{',
      }),
      env as unknown as Env,
      mockCtx(),
    );
    const payload = initPayload as unknown as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(initFetch).toHaveBeenCalledTimes(1);
    expect(initPayload).toMatchObject({
      scenario: 'biplanetary',
    });
    expect(payload.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(payload.playerToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(payload.inviteToken).toBeUndefined();

    const data = (await response.json()) as Record<string, string>;

    expect(data.code).toBe(payload.code);
    expect(data.playerToken).toBe(payload.playerToken);
    expect(data.inviteToken).toBeUndefined();
  });

  it('retries collisions up to 12 times before returning 503', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('collision', { status: 409 }),
    );

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(503);
    expect(initFetch).toHaveBeenCalledTimes(12);
    expect(await response.text()).toContain('Failed to allocate room code');
  });

  it('returns 500 when durable object initialization fails unexpectedly', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('boom', { status: 500 }),
    );

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(500);
    expect(initFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain('Failed to create game');
  });

  it('proxies websocket requests to the room durable object', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('proxied', { status: 200 }),
    );

    const request = new Request('https://delta-v.test/ws/ABCDE', {
      headers: { Upgrade: 'websocket' },
    });

    const response = await worker.fetch(
      request,
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(env.GAME.idFromName).toHaveBeenCalledWith('ABCDE');
    expect(initFetch).toHaveBeenCalledWith(request);
  });

  it('proxies join preflight requests to the room durable object', async () => {
    const { env, initFetch } = createEnv(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );

    const response = await worker.fetch(
      new Request(
        'https://delta-v.test/join/ABCDE?playerToken=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        {
          method: 'GET',
        },
      ),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(env.GAME.idFromName).toHaveBeenCalledWith('ABCDE');
    expect(initFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://room.internal/join?playerToken=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    );
  });

  it('falls back to static assets for non-game routes', async () => {
    const { env, assetsFetch } = createEnv();
    const request = new Request('https://delta-v.test/');

    const response = await worker.fetch(
      request,
      env as unknown as Env,
      mockCtx(),
    );

    expect(assetsFetch).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe('asset ok');
  });
});

describe('/error endpoint', () => {
  it('accepts valid error reports and returns 204', async () => {
    const { env } = createEnv();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'test error',
          ts: 123,
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(
      '[client-error]',
      expect.objectContaining({
        error: 'test error',
      }),
    );
    spy.mockRestore();
  });

  it('inserts error into D1 with client_error event', async () => {
    const { env } = createEnv();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctx = mockCtx();

    await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'crash',
          ts: 100,
        }),
      }),
      env as unknown as Env,
      ctx,
    );

    // waitUntil should have been called
    expect(ctx.waitUntil).toHaveBeenCalled();

    // Wait for the D1 insert promise
    await ctx.waitUntil.mock.calls[0][0];

    expect(env.DB.prepare).toHaveBeenCalled();
    const bindArgs = env.DB._bind.mock.calls[0] as unknown[];
    // event should be 'client_error'
    expect(bindArgs[2]).toBe('client_error');
  });

  it('rejects non-POST requests', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error'),
      env as unknown as Env,
      mockCtx(),
    );

    // GET /error falls through to static assets
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset ok');
  });

  it('rejects non-JSON content type with 415', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(415);
  });

  it('rejects payloads exceeding 4 KB via content-length', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '10000',
        },
        body: JSON.stringify({ error: 'big' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(413);
  });

  it('rejects payloads exceeding 4 KB via body length', async () => {
    const { env } = createEnv();
    const bigBody = JSON.stringify({
      error: 'x'.repeat(5000),
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bigBody,
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(413);
  });

  it('rejects invalid JSON with 400', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{invalid',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(400);
  });
});

describe('/telemetry endpoint', () => {
  it('accepts valid telemetry events and returns 204', async () => {
    const { env } = createEnv();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'game_created',
          scenario: 'biplanetary',
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(
      '[telemetry]',
      expect.objectContaining({
        event: 'game_created',
      }),
    );
    spy.mockRestore();
  });

  it('inserts telemetry into D1', async () => {
    const { env } = createEnv();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx = mockCtx();

    await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'game_created',
          anonId: 'abc-123',
          ts: 999,
          scenario: 'duel',
        }),
      }),
      env as unknown as Env,
      ctx,
    );

    await ctx.waitUntil.mock.calls[0][0];

    expect(env.DB.prepare).toHaveBeenCalled();
    const bindArgs = env.DB._bind.mock.calls[0] as unknown[];
    // ts, anonId, event, props, ipHash, ua
    expect(bindArgs[0]).toBe(999); // ts
    expect(bindArgs[1]).toBe('abc-123'); // anonId
    expect(bindArgs[2]).toBe('game_created'); // event
    expect(JSON.parse(bindArgs[3] as string)).toEqual({ scenario: 'duel' }); // props
    expect(bindArgs[4]).toMatch(/^[0-9a-f]{16}$/); // ipHash
  });

  it('returns 204 even if D1 insert fails', async () => {
    const { env } = createEnv();
    env.DB._run.mockRejectedValueOnce(new Error('D1 down'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctx = mockCtx();

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'test',
        }),
      }),
      env as unknown as Env,
      ctx,
    );

    expect(response.status).toBe(204);

    // D1 error is caught gracefully
    await ctx.waitUntil.mock.calls[0][0];
  });

  it('rejects non-JSON content type with 415', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'not json',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(415);
  });

  it('does not echo payload in response body', async () => {
    const { env } = createEnv();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event: 'test' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });
});

describe('hashIp', () => {
  it('returns a 16-char hex string', async () => {
    const hash = await hashIp('192.168.1.1');

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns same hash for same input', async () => {
    const a = await hashIp('10.0.0.1');
    const b = await hashIp('10.0.0.1');

    expect(a).toBe(b);
  });

  it('returns different hashes for different IPs', async () => {
    const a = await hashIp('10.0.0.1');
    const b = await hashIp('10.0.0.2');

    expect(a).not.toBe(b);
  });
});

describe('/create rate limiting', () => {
  beforeEach(() => {
    createRateMap.clear();
  });

  it('allows up to 5 creates per IP per minute', async () => {
    const { env } = createEnv();
    for (let i = 0; i < 5; i++) {
      const response = await worker.fetch(
        new Request('https://delta-v.test/create', {
          method: 'POST',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
          },
        }),
        env as unknown as Env,
        mockCtx(),
      );
      expect(response.status).toBe(200);
    }
  });

  it('returns 429 after 5 creates from same IP', async () => {
    const { env } = createEnv();
    for (let i = 0; i < 5; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/create', {
          method: 'POST',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
          },
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '1.2.3.4',
        },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('rate limits are independent per IP', async () => {
    const { env } = createEnv();
    for (let i = 0; i < 5; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/create', {
          method: 'POST',
          headers: {
            'cf-connecting-ip': '1.2.3.4',
          },
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    // Different IP should still succeed
    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '5.6.7.8',
        },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(response.status).toBe(200);
  });
});
