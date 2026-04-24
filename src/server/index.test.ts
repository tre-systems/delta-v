import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./game-do/game-do', () => ({
  GameDO: class GameDO {},
}));

vi.mock('./matchmaker-do', () => ({
  MatchmakerDO: class MatchmakerDO {},
}));

vi.mock('./live-registry-do', () => ({
  LiveRegistryDO: class LiveRegistryDO {},
}));

import { asGameId } from '../shared/ids';
import { issueAgentToken } from './auth';
import type { MatchArchive } from './game-do/match-archive';
import worker, {
  __resetWorkerBootedAtForTests,
  createRateMap,
  type Env,
  errorReportRateMap,
  hashIp,
  joinProbeRateMap,
  replayProbeRateMap,
  shouldSampleOperationalLog,
  telemetryReportRateMap,
} from './index';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from './quick-match-internal';

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
  MATCHMAKER: {
    idFromName: ReturnType<typeof vi.fn<(name: string) => DurableObjectId>>;
    get: ReturnType<typeof vi.fn<(id: DurableObjectId) => DurableObjectStub>>;
  };
  DB: MockDb;
  AGENT_TOKEN_SECRET?: string;
  INTERNAL_METRICS_TOKEN?: string;
  DEV_MODE?: string;
  CF_VERSION_METADATA?: {
    id?: string;
  };
  CF_PAGES_COMMIT_SHA?: string;
  GIT_COMMIT_SHA?: string;
  CREATE_RATE_LIMITER?: {
    limit: ReturnType<
      typeof vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>
    >;
  };
  MATCH_ARCHIVE?: {
    delete?: ReturnType<
      typeof vi.fn<(key: string | string[]) => Promise<void>>
    >;
    get: ReturnType<
      typeof vi.fn<
        (key: string) => Promise<{ json: () => Promise<unknown> } | null>
      >
    >;
  };
};

const mockDb = () => {
  const runFn = vi.fn(async () => ({}));
  const bindFn = vi.fn(() => ({ run: runFn }));
  const prepareFn = vi.fn(() => ({ bind: bindFn }));

  return {
    prepare: prepareFn,
    bind: bindFn,
    run: runFn,
  };
};

const mockCtx = (): MockExecutionContext => ({
  waitUntil: vi.fn((p: Promise<unknown>) => {
    void p.catch(() => {});
  }),
  passThroughOnException: vi.fn(),
  props: {},
});

const findSampledIp = async (): Promise<string> => {
  for (let index = 1; index < 256; index++) {
    const candidate = `10.0.0.${index}`;
    if (shouldSampleOperationalLog(await hashIp(candidate))) {
      return candidate;
    }
  }
  throw new Error('failed to find sampled IP');
};

const createEnv = (
  initHandler?: (request: Request) => Promise<Response> | Response,
  overrides: Partial<MockEnv> = {},
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
  const matchmakerFetch = vi.fn(async () =>
    Response.json({ status: 'queued', ticket: 'ticket1', scenario: 'duel' }),
  );
  const matchmakerStub = {
    fetch: matchmakerFetch,
  } as unknown as DurableObjectStub;

  const env: MockEnv = {
    ASSETS: { fetch: assetsFetch },
    GAME: {
      idFromName: vi.fn(
        (code: string) => `id:${code}` as unknown as DurableObjectId,
      ),
      get: vi.fn(() => stub),
    },
    MATCHMAKER: {
      idFromName: vi.fn(
        (name: string) => `matchmaker:${name}` as unknown as DurableObjectId,
      ),
      get: vi.fn(() => matchmakerStub),
    },
    DB: mockDb(),
    AGENT_TOKEN_SECRET: 'mcp-handlers-test-secret-must-be-16-chars',
    DEV_MODE: '0',
    ...overrides,
  };

  return { env, assetsFetch, initFetch, matchmakerFetch };
};

describe('server index worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkerBootedAtForTests();
    createRateMap.clear();
  });

  it('creates rooms with generated tokens for valid scenario payloads', async () => {
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
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );
    const payload = initPayload as unknown as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(initFetch).toHaveBeenCalledTimes(1);
    expect(initPayload).toMatchObject({
      scenario: 'escape',
    });
    expect(payload.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(payload.playerToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const data = (await response.json()) as Record<string, string>;

    expect(data.code).toBe(payload.code);
    expect(data.playerToken).toBe(payload.playerToken);
  });

  it('rejects create requests with invalid JSON, unknown scenarios, and oversized bodies', async () => {
    const { env, initFetch } = createEnv();
    const ctx = mockCtx();

    const invalidJson = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{',
      }),
      env as unknown as Env,
      ctx,
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({
      ok: false,
      error: 'invalid_json',
      message: 'Invalid JSON body.',
    });

    const invalidScenario = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: 'fake_scenario' }),
      }),
      env as unknown as Env,
      ctx,
    );
    expect(invalidScenario.status).toBe(400);
    await expect(invalidScenario.json()).resolves.toMatchObject({
      ok: false,
      error: 'invalid_payload',
      message: 'Invalid scenario',
    });

    const oversized = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: 'escape', padding: 'x'.repeat(1100) }),
      }),
      env as unknown as Env,
      ctx,
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      ok: false,
      error: 'payload_too_large',
      message: 'Create payload exceeds 1024 bytes.',
    });

    expect(initFetch).not.toHaveBeenCalled();
  });

  it('proxies quick-match requests to the matchmaker durable object', async () => {
    const { env, matchmakerFetch } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          player: {
            playerKey: 'playerkey1',
            username: 'Pilot One',
          },
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(env.MATCHMAKER.idFromName).toHaveBeenCalledWith('global');
    expect(matchmakerFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://matchmaker.internal/enqueue',
      }),
    );
  });

  it('serves a health endpoint with boot timestamp and optional sha', async () => {
    const { env } = createEnv(undefined, {
      CF_VERSION_METADATA: { id: 'deploy-sha-123' },
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/healthz', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sha: 'deploy-sha-123',
      bootedAt: expect.any(String),
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('falls back to CF_PAGES_COMMIT_SHA when version metadata is unavailable', async () => {
    const { env } = createEnv(undefined, {
      CF_PAGES_COMMIT_SHA: 'pages-sha-456',
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/health', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sha: 'pages-sha-456',
      bootedAt: expect.any(String),
    });
  });

  it('returns null sha when no deploy metadata is available', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/status', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sha: null,
      bootedAt: expect.any(String),
    });
  });

  it('falls back to /version.json assetsHash when deploy metadata is unavailable', async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/version.json') {
        return Response.json({
          packageVersion: '0.1.0',
          assetsHash: 'asset-sha-789',
        });
      }
      return new Response('asset ok');
    });
    const { env } = createEnv(undefined, {
      ASSETS: { fetch: assetsFetch },
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/healthz', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sha: 'asset-sha-789',
      bootedAt: expect.any(String),
    });
    expect(assetsFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://delta-v.test/version.json',
      }),
    );
  });

  it('initializes bootedAt lazily and keeps it stable for the isolate', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValue(5_000);
    const { env } = createEnv();

    const first = await worker.fetch(
      new Request('https://delta-v.test/healthz', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );
    const firstPayload = (await first.json()) as { bootedAt: string };

    const second = await worker.fetch(
      new Request('https://delta-v.test/healthz', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );
    const secondPayload = (await second.json()) as { bootedAt: string };

    expect(firstPayload.bootedAt).toBe('1970-01-01T00:00:01.000Z');
    expect(secondPayload.bootedAt).toBe(firstPayload.bootedAt);
  });

  it('adds explicit wildcard CORS to public read APIs and handles OPTIONS preflight', async () => {
    const { env } = createEnv();

    const healthz = await worker.fetch(
      new Request('https://delta-v.test/healthz', { method: 'GET' }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(healthz.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(healthz.headers.get('Access-Control-Allow-Methods')).toContain(
      'GET',
    );

    const preflight = await worker.fetch(
      new Request('https://delta-v.test/api/matches', { method: 'OPTIONS' }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain(
      'OPTIONS',
    );
  });

  it('does not add wildcard CORS to non-public write endpoints', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: 'duel' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('returns 403 when quick-match uses agent_ playerKey without Bearer', async () => {
    const { env, matchmakerFetch } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_unauth_zz',
            username: 'Bot',
          },
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(403);
    expect(matchmakerFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when quick-match Bearer is not a valid agent token', async () => {
    const { env, matchmakerFetch } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not-a-real-token',
        },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_bad_bearer_1',
            username: 'Bot',
          },
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(401);
    expect(matchmakerFetch).not.toHaveBeenCalled();
  });

  it('returns 403 when agent quick-match Bearer playerKey mismatches body', async () => {
    const { env, matchmakerFetch } = createEnv();
    const { token } = await issueAgentToken({
      secret: env.AGENT_TOKEN_SECRET as string,
      playerKey: 'agent_token_key_a',
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_token_key_b',
            username: 'Bot',
          },
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(403);
    expect(matchmakerFetch).not.toHaveBeenCalled();
  });

  it('forwards non-agent quick-match without verified header when JSON is invalid', async () => {
    const { env, matchmakerFetch } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(matchmakerFetch).toHaveBeenCalledOnce();
    const forwarded = (
      matchmakerFetch.mock.calls[0] as unknown as [Request]
    )[0];
    expect(forwarded.headers.get(QUICK_MATCH_VERIFIED_AGENT_HEADER)).toBeNull();
    expect(response.status).not.toBe(403);
  });

  it('sets verified-agent header on enqueue when Bearer matches playerKey', async () => {
    const { env, matchmakerFetch } = createEnv();
    const { token } = await issueAgentToken({
      secret: env.AGENT_TOKEN_SECRET as string,
      playerKey: 'agent_index_ok_1',
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/quick-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          player: {
            playerKey: 'agent_index_ok_1',
            username: 'Bot',
          },
        }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(matchmakerFetch).toHaveBeenCalledOnce();
    const forwarded = (
      matchmakerFetch.mock.calls[0] as unknown as [Request]
    )[0];
    expect(forwarded.headers.get(QUICK_MATCH_VERIFIED_AGENT_HEADER)).toBe('1');
  });

  it('retries collisions up to 12 times before returning 503', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('collision', { status: 409 }),
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

  it('writes a server-side audit event for create requests', async () => {
    let initPayload: Record<string, unknown> | null = null;
    const { env } = createEnv(async (request) => {
      initPayload = (await request.json()) as Record<string, unknown>;
      return Response.json({ ok: true }, { status: 201 });
    });
    const ctx = mockCtx();

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
          'user-agent': 'audit-test',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(initPayload).toMatchObject({ scenario: 'escape' });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    await ctx.waitUntil.mock.calls[0][0];

    const bindArgs = env.DB.bind.mock.calls[0] as unknown[];
    expect(bindArgs[2]).toBe('server_create_request');
    expect(JSON.parse(bindArgs[3] as string)).toMatchObject({
      route: '/create',
      outcome: 'created',
      scenario: 'escape',
      status: 200,
    });
    expect(bindArgs[5]).toBe('audit-test');
  });

  it('writes a rate-limited audit event for blocked create requests', async () => {
    const { env } = createEnv();
    const ctx = mockCtx();

    for (let i = 0; i < 5; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ scenario: 'escape' }),
        }),
        env as unknown as Env,
        ctx,
      );
    }

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      ctx,
    );

    expect(blocked.status).toBe(429);
    const lastWait = ctx.waitUntil.mock.calls.at(-1)?.[0];
    expect(lastWait).toBeDefined();
    await lastWait;
    const bindArgs = env.DB.bind.mock.calls.at(-1) as unknown[];
    expect(bindArgs[2]).toBe('server_create_request');
    expect(JSON.parse(bindArgs[3] as string)).toMatchObject({
      route: '/create',
      outcome: 'rate_limited',
      scenario: 'escape',
      status: 429,
    });
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

  it('proxies replay requests to the room durable object', async () => {
    const { env, initFetch } = createEnv(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );

    const response = await worker.fetch(
      new Request(
        'https://delta-v.test/replay/ABCDE?playerToken=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&gameId=ABCDE-m2',
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
        url: 'https://room.internal/replay?playerToken=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&gameId=ABCDE-m2',
      }),
    );
  });

  it('forwards spectator replay requests to the room durable object', async () => {
    const { env, initFetch } = createEnv(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );

    const response = await worker.fetch(
      new Request(
        'https://delta-v.test/replay/ABCDE?viewer=spectator&gameId=ABCDE-m2',
        {
          method: 'GET',
        },
      ),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(initFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://room.internal/replay?gameId=ABCDE-m2&viewer=spectator',
      }),
    );
  });

  it('falls back to the R2 archive for spectator replay links after room eviction', async () => {
    const archive: MatchArchive = {
      gameId: asGameId('ABCDE-m2'),
      roomCode: 'ABCDE',
      scenario: 'duel',
      winner: 0,
      winReason: 'Fleet eliminated!',
      turnCount: 1,
      createdAt: 1234,
      completedAt: 5678,
      checkpoint: null,
      matchSeed: null,
      officialBotMatch: true,
      eventStream: [
        {
          seq: 1,
          gameId: asGameId('ABCDE-m2'),
          actor: null,
          ts: 1234,
          event: {
            type: 'gameCreated',
            scenario: 'Duel',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
      ],
    };
    const archiveGet = vi.fn(async () => ({
      json: async () => archive,
    }));
    const { env, initFetch } = createEnv(
      async () => new Response('Replay not found', { status: 404 }),
      {
        MATCH_ARCHIVE: {
          get: archiveGet,
        },
      },
    );

    const response = await worker.fetch(
      new Request(
        'https://delta-v.test/replay/ABCDE?viewer=spectator&gameId=ABCDE-m2',
        {
          method: 'GET',
        },
      ),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(initFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://room.internal/replay?gameId=ABCDE-m2&viewer=spectator',
      }),
    );
    expect(archiveGet).toHaveBeenCalledWith('matches/ABCDE-m2.json');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=3600',
    );
    const body = (await response.json()) as {
      gameId: string;
      scenario: string;
      officialBotMatch: boolean;
      entries: Array<{ message: { state: { phase: string } } }>;
    };
    expect(body.gameId).toBe('ABCDE-m2');
    expect(body.scenario).toBe('Duel');
    expect(body.officialBotMatch).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.message.state.phase).toBe('astrogation');
  });

  it('proxies spectator websocket requests to the room durable object', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('proxied', { status: 200 }),
    );

    const request = new Request(
      'https://delta-v.test/ws/ABCDE?viewer=spectator',
      {
        headers: { Upgrade: 'websocket' },
      },
    );

    const response = await worker.fetch(
      request,
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(env.GAME.idFromName).toHaveBeenCalledWith('ABCDE');
    expect(initFetch).toHaveBeenCalledWith(request);
  });

  it('routes /api/metrics through the auth-gated metrics handler', async () => {
    const resultsQueue: unknown[] = [
      [{ day: '2026-04-22', matches: 1 }],
      [{ scenario: 'duel', matches: 1 }],
      [{ difficulty: 'normal', games: 1 }],
      [{ completed: 1, started: 1 }],
      [{ errors: 0, started: 1 }],
      [{ succeeded: 0, failed: 0 }],
      [{ scenario: 'duel', averageMs: 2000, turns: 1 }],
      [{ count: 0 }],
      [{ count: 0 }],
    ];
    const bind = vi.fn(() => ({
      all: vi.fn(async () => ({
        results: (resultsQueue.shift() as unknown[]) ?? [],
      })),
    }));
    const prepare = vi.fn(() => ({ bind }));
    const { env } = createEnv(undefined, {
      DB: { prepare } as unknown as MockDb,
      INTERNAL_METRICS_TOKEN: 'metrics-secret',
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/api/metrics', {
        headers: {
          Authorization: 'Bearer metrics-secret',
        },
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      windowDays: 7,
      officialBot: {
        acceptedFills: 0,
        archivedMatches: 0,
      },
    });
  });

  it('allows loopback /api/metrics requests without a bearer token', async () => {
    const resultsQueue: unknown[] = [
      [],
      [],
      [],
      [{ completed: 0, started: 0 }],
      [{ errors: 0, started: 0 }],
      [{ succeeded: 0, failed: 0 }],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
    ];
    const bind = vi.fn(() => ({
      all: vi.fn(async () => ({
        results: (resultsQueue.shift() as unknown[]) ?? [],
      })),
    }));
    const prepare = vi.fn(() => ({ bind }));
    const { env } = createEnv(undefined, {
      DB: { prepare } as unknown as MockDb,
      INTERNAL_METRICS_TOKEN: undefined,
    });

    const response = await worker.fetch(
      new Request('http://127.0.0.1/api/metrics'),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
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
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves version.json as uncached deploy metadata', async () => {
    const assetsFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/version.json') {
        return Response.json({
          packageVersion: '0.1.0',
          assetsHash: 'asset-sha-123',
        });
      }
      return new Response('asset ok');
    });
    const { env } = createEnv(undefined, {
      ASSETS: { fetch: assetsFetch },
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/version.json'),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      packageVersion: '0.1.0',
      assetsHash: 'asset-sha-123',
    });
  });

  it('serves root icon aliases from existing static assets', async () => {
    const { env, assetsFetch } = createEnv();

    const faviconResponse = await worker.fetch(
      new Request('https://delta-v.test/favicon.ico'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(faviconResponse.status).toBe(200);

    const touchResponse = await worker.fetch(
      new Request('https://delta-v.test/apple-touch-icon.png'),
      env as unknown as Env,
      mockCtx(),
    );
    expect(touchResponse.status).toBe(200);

    const fetchedUrls = (assetsFetch.mock.calls as unknown[][])
      .map((call) => (call[0] as { url?: unknown } | undefined)?.url)
      .filter((url): url is string => typeof url === 'string');
    expect(fetchedUrls).toContain('https://delta-v.test/favicon.svg');
    expect(fetchedUrls).toContain(
      'https://delta-v.test/icons/apple-touch-icon.png',
    );
  });

  it('purges expired events and archived matches in the scheduled handler', async () => {
    const oldGameId = 'OLD-m1';
    const selectAll = vi.fn(async () => ({
      results: [{ game_id: oldGameId }],
    }));
    const deleteRowsRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const deleteEventsRun = vi.fn(async () => ({ meta: { changes: 2 } }));
    const bindFn = vi
      .fn()
      .mockReturnValueOnce({ run: deleteEventsRun })
      .mockReturnValueOnce({ all: selectAll })
      .mockReturnValueOnce({ run: deleteRowsRun });
    const prepareFn = vi.fn(() => ({ bind: bindFn }));
    const archiveDelete = vi.fn(async () => {});
    const { env } = createEnv(undefined, {
      DB: {
        prepare: prepareFn,
        bind: bindFn,
        run: deleteEventsRun,
      } as unknown as MockDb,
      MATCH_ARCHIVE: {
        get: vi.fn(async () => null),
        delete: archiveDelete,
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = mockCtx();

    await worker.scheduled({} as ScheduledEvent, env as unknown as Env, ctx);
    await Promise.all(ctx.waitUntil.mock.calls.map(([promise]) => promise));

    expect(archiveDelete).toHaveBeenCalledWith([`matches/${oldGameId}.json`]);
    expect(prepareFn).toHaveBeenCalledWith('DELETE FROM events WHERE ts < ?');
    expect(prepareFn).toHaveBeenCalledWith(
      'SELECT game_id FROM match_archive WHERE completed_at < ? ORDER BY completed_at ASC LIMIT ?',
    );
    expect(prepareFn).toHaveBeenCalledWith(
      'DELETE FROM match_archive WHERE game_id IN (?)',
    );
    expect(logSpy).toHaveBeenCalledWith('[events purge] removed 2 rows');
    expect(logSpy).toHaveBeenCalledWith(
      '[match archive purge] removed 1 rows / 1 objects',
    );
    logSpy.mockRestore();
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
    const bindArgs = env.DB.bind.mock.calls[0] as unknown[];
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

  it('rejects explicit third-party origins with 403', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ error: 'test error' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(403);
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
    const bindArgs = env.DB.bind.mock.calls[0] as unknown[];
    // ts, anonId, event, props, ipHash, ua
    expect(bindArgs[0]).toBe(999); // ts
    expect(bindArgs[1]).toBe('abc-123'); // anonId
    expect(bindArgs[2]).toBe('game_created'); // event
    expect(JSON.parse(bindArgs[3] as string)).toEqual({ scenario: 'duel' }); // props
    expect(bindArgs[4]).toMatch(/^[0-9a-f]{16}$/); // ipHash
  });

  it('returns 204 even if D1 insert fails', async () => {
    const { env } = createEnv();
    env.DB.run.mockRejectedValueOnce(new Error('D1 down'));
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

  it('rejects explicit third-party origins with 403', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ event: 'test' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(403);
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
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ scenario: 'escape' }),
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
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ scenario: 'escape' }),
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ scenario: 'escape' }),
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
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ scenario: 'escape' }),
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
          'Content-Type': 'application/json',
          'cf-connecting-ip': '5.6.7.8',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(response.status).toBe(200);
  });

  it('uses the configured rate-limit binding when present', async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const { env } = createEnv(undefined, {
      CREATE_RATE_LIMITER: limiter,
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
    expect(limiter.limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^create:/),
    });
  });

  it('still enforces the local cap when the binding keeps allowing requests', async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const { env } = createEnv(undefined, {
      CREATE_RATE_LIMITER: limiter,
    });

    for (let i = 0; i < 5; i++) {
      const response = await worker.fetch(
        new Request('https://delta-v.test/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ scenario: 'escape' }),
        }),
        env as unknown as Env,
        mockCtx(),
      );

      expect(response.status).toBe(200);
    }

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(blocked.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledTimes(6);
  });

  it('returns 429 when the configured rate-limit binding rejects the request', async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const { env } = createEnv(undefined, {
      CREATE_RATE_LIMITER: limiter,
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('bypasses create rate limiting for loopback requests', async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const { env } = createEnv(undefined, {
      CREATE_RATE_LIMITER: limiter,
    });

    for (let i = 0; i < 8; i++) {
      const response = await worker.fetch(
        new Request('http://127.0.0.1:8787/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '127.0.0.1',
          },
          body: JSON.stringify({ scenario: 'escape' }),
        }),
        env as unknown as Env,
        mockCtx(),
      );

      expect(response.status).toBe(200);
    }

    expect(limiter.limit).not.toHaveBeenCalled();
  });
});

describe('/api/agent-token rate limiting', () => {
  beforeEach(() => {
    createRateMap.clear();
  });

  it('applies the shared local cap even when the edge binding allows every request', async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const { env } = createEnv(undefined, {
      CREATE_RATE_LIMITER: limiter,
    });

    for (let i = 0; i < 5; i++) {
      const response = await worker.fetch(
        new Request('https://delta-v.test/api/agent-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '1.2.3.4',
          },
          body: JSON.stringify({ playerKey: 'agent_alpha-v1' }),
        }),
        env as unknown as Env,
        mockCtx(),
      );

      expect(response.status).toBe(200);
    }

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/api/agent-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '1.2.3.4',
        },
        body: JSON.stringify({ playerKey: 'agent_alpha-v1' }),
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(limiter.limit).toHaveBeenCalledTimes(6);
  });

  it('logs malformed token-issue payloads on a sampled path', async () => {
    const { env } = createEnv();
    const ip = await findSampledIp();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://delta-v.test/api/agent-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: '{not json',
      }),
      env as unknown as Env,
      mockCtx(),
    );

    expect(response.status).toBe(400);
    expect(log).toHaveBeenCalledWith(
      '[auth-failure]',
      expect.objectContaining({
        route: '/api/agent-token',
        reason: 'invalid_json',
        status: 400,
      }),
    );
    log.mockRestore();
  });
});

describe('POST /telemetry rate limiting', () => {
  beforeEach(() => {
    telemetryReportRateMap.clear();
  });

  it('returns 429 after 120 posts per hashed IP per minute', async () => {
    const { env } = createEnv();
    const headers = {
      'Content-Type': 'application/json',
      'cf-connecting-ip': '9.9.9.9',
    };
    const body = JSON.stringify({ event: 't' });

    for (let i = 0; i < 120; i++) {
      const response = await worker.fetch(
        new Request('https://delta-v.test/telemetry', {
          method: 'POST',
          headers,
          body,
        }),
        env as unknown as Env,
        mockCtx(),
      );
      expect(response.status).toBe(204);
    }

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers,
        body,
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
  });
});

describe('POST /error rate limiting', () => {
  beforeEach(() => {
    errorReportRateMap.clear();
  });

  it('returns 429 after 40 posts per hashed IP per minute', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = createEnv();
    const headers = {
      'Content-Type': 'application/json',
      'cf-connecting-ip': '8.8.8.8',
    };
    const body = JSON.stringify({ message: 'x' });

    for (let i = 0; i < 40; i++) {
      const response = await worker.fetch(
        new Request('https://delta-v.test/error', {
          method: 'POST',
          headers,
          body,
        }),
        env as unknown as Env,
        mockCtx(),
      );
      expect(response.status).toBe(204);
    }

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers,
        body,
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(blocked.status).toBe(429);
  });
});

describe('GET /join and /replay probe rate limiting', () => {
  beforeEach(() => {
    joinProbeRateMap.clear();
    replayProbeRateMap.clear();
  });

  it('returns 429 when join GETs exceed join probe limit per IP', async () => {
    const { env, initFetch } = createEnv(async () => new Response('ok'));

    for (let i = 0; i < 100; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/join/ABCDE', {
          method: 'GET',
          headers: { 'cf-connecting-ip': '7.7.7.7' },
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    expect(initFetch).toHaveBeenCalledTimes(100);

    const blocked = await worker.fetch(
      new Request('https://delta-v.test/join/ABCDE', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '7.7.7.7' },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(blocked.status).toBe(429);
    expect(initFetch).toHaveBeenCalledTimes(100);
  });

  it('rate-limits replay probes independently from join probes', async () => {
    const { env, initFetch } = createEnv(async () => new Response('ok'));

    for (let i = 0; i < 100; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/join/ABCDE', {
          method: 'GET',
          headers: { 'cf-connecting-ip': '8.8.8.8' },
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    const joinBlocked = await worker.fetch(
      new Request('https://delta-v.test/join/ABCDE', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '8.8.8.8' },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(joinBlocked.status).toBe(429);

    const replayOk = await worker.fetch(
      new Request('https://delta-v.test/replay/VWXYZ', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '8.8.8.8' },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(replayOk.status).toBe(200);
    expect(initFetch).toHaveBeenCalledTimes(101);
  });

  it('uses independent limits per IP', async () => {
    const { env } = createEnv(async () => new Response('ok'));

    for (let i = 0; i < 50; i++) {
      await worker.fetch(
        new Request('https://delta-v.test/join/ABCDE', {
          method: 'GET',
          headers: { 'cf-connecting-ip': '7.7.7.7' },
        }),
        env as unknown as Env,
        mockCtx(),
      );
      await worker.fetch(
        new Request('https://delta-v.test/join/ABCDE', {
          method: 'GET',
          headers: { 'cf-connecting-ip': '6.6.6.6' },
        }),
        env as unknown as Env,
        mockCtx(),
      );
    }
    const ok = await worker.fetch(
      new Request('https://delta-v.test/join/ABCDE', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '6.6.6.6' },
      }),
      env as unknown as Env,
      mockCtx(),
    );
    expect(ok.status).toBe(200);
  });
});
