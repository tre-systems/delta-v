import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./game-do/game-do', () => ({
  GameDO: class GameDO {},
}));

import worker from './index';

function createEnv(
  initHandler?: (request: Request) => Promise<Response> | Response,
) {
  const assetsFetch = vi.fn(async () => new Response('asset ok'));

  const initFetch = vi.fn(async (request: Request) => {
    if (initHandler) {
      return await initHandler(request);
    }
    return Response.json({ ok: true }, { status: 201 });
  });

  const stub = { fetch: initFetch };

  const env = {
    ASSETS: { fetch: assetsFetch },
    GAME: {
      idFromName: vi.fn((code: string) => `id:${code}`),
      get: vi.fn(() => stub),
    },
  };

  return { env, assetsFetch, initFetch };
}

describe('server index worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates rooms with generated tokens and defaults invalid payloads to biplanetary', async () => {
    let initPayload: any = null;

    const { env, initFetch } = createEnv(async (request) => {
      initPayload = await request.json();
      return Response.json({ ok: true }, { status: 201 });
    });

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      env as any,
    );

    expect(response.status).toBe(200);
    expect(initFetch).toHaveBeenCalledTimes(1);
    expect(initPayload).toMatchObject({
      scenario: 'biplanetary',
    });
    expect(initPayload.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(initPayload.playerToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(initPayload.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const data = (await response.json()) as Record<string, string>;

    expect(data.code).toBe(initPayload.code);
    expect(data.playerToken).toBe(initPayload.playerToken);
    expect(data.inviteToken).toBe(initPayload.inviteToken);
  });

  it('retries collisions up to 12 times before returning 503', async () => {
    const { env, initFetch } = createEnv(
      async () => new Response('collision', { status: 409 }),
    );

    const response = await worker.fetch(
      new Request('https://delta-v.test/create', {
        method: 'POST',
      }),
      env as any,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'escape' }),
      }),
      env as any,
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

    const response = await worker.fetch(request, env as any);

    expect(response.status).toBe(200);
    expect(env.GAME.idFromName).toHaveBeenCalledWith('ABCDE');
    expect(initFetch).toHaveBeenCalledWith(request);
  });

  it('falls back to static assets for non-game routes', async () => {
    const { env, assetsFetch } = createEnv();
    const request = new Request('https://delta-v.test/');

    const response = await worker.fetch(request, env as any);

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'test error',
          ts: 123,
        }),
      }),
      env as any,
    );

    expect(response.status).toBe(204);
    expect(spy).toHaveBeenCalledWith(
      '[client-error]',
      expect.objectContaining({ error: 'test error' }),
    );
    spy.mockRestore();
  });

  it('rejects non-POST requests', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error'),
      env as any,
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
      env as any,
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
      env as any,
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
        headers: { 'Content-Type': 'application/json' },
        body: bigBody,
      }),
      env as any,
    );

    expect(response.status).toBe(413);
  });

  it('rejects invalid JSON with 400', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid',
      }),
      env as any,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'game_created',
          scenario: 'biplanetary',
        }),
      }),
      env as any,
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

  it('rejects non-JSON content type with 415', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      }),
      env as any,
    );

    expect(response.status).toBe(415);
  });

  it('does not echo payload in response body', async () => {
    const { env } = createEnv();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://delta-v.test/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'test' }),
      }),
      env as any,
    );

    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });
});
