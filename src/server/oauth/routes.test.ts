import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: DurableObjectState;
    env: unknown;
    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

vi.mock('../leaderboard/player-store', () => ({
  claimPlayerName: vi.fn(async () => ({
    ok: true,
    created: true,
    renamed: false,
    player: {},
  })),
}));

import type { Env } from '../env';
import { sha256Base64Url } from './model';
import { OAuthDO } from './oauth-do';
import { handleOAuthRoute } from './routes';

const ORIGIN = 'https://delta-v.test';
const CLIENT_ID = `${ORIGIN}/oauth/test-client.json`;
const REDIRECT_URI = 'https://client.test/callback';
const RESOURCE = `${ORIGIN}/mcp`;
const SECRET = 'oauth-routes-test-secret-must-be-long';

const createStorage = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(
      async (
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ) => {
        if (typeof keyOrEntries === 'string') data.set(keyOrEntries, value);
        else
          for (const [key, item] of Object.entries(keyOrEntries))
            data.set(key, item);
      },
    ),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    }),
    list: vi.fn(
      async (options?: { prefix?: string }) =>
        new Map(
          [...data].filter(([key]) =>
            options?.prefix ? key.startsWith(options.prefix) : true,
          ),
        ),
    ),
    transaction: vi.fn(
      async (callback: (tx: DurableObjectStorage) => unknown) =>
        callback(storage as unknown as DurableObjectStorage),
    ),
    getAlarm: vi.fn(async () => alarm),
    setAlarm: vi.fn(async (time: number) => {
      alarm = time;
    }),
  };
  return storage as unknown as DurableObjectStorage;
};

const createEnv = (): Env => {
  const state = { storage: createStorage() } as unknown as DurableObjectState;
  const oauth = new OAuthDO(state, {} as Env);
  const stub = { fetch: (request: Request) => oauth.fetch(request) };
  const namespace = {
    idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
    get: vi.fn(() => stub),
  } as unknown as DurableObjectNamespace;
  return {
    DEV_MODE: '1',
    AGENT_TOKEN_SECRET: SECRET,
    OAUTH: namespace,
    DB: {} as D1Database,
  } as unknown as Env;
};

const route = async (request: Request, env: Env): Promise<Response> => {
  const response = await handleOAuthRoute(request, env);
  if (!response) throw new Error('OAuth route did not match');
  return response;
};

describe('OAuth routes', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('publishes protected-resource and authorization-server metadata', async () => {
    const env = createEnv();
    const protectedResource = await route(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      env,
    );
    expect(protectedResource.headers.get('Cache-Control')).toBe('no-store');
    expect(await protectedResource.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
      scopes_supported: ['game:play'],
    });

    const server = await route(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      env,
    );
    expect(await server.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('completes PKCE authorization, rotates refresh tokens, and revokes on replay', async () => {
    const env = createEnv();
    const verifier = 'v'.repeat(64);
    const challenge = await sha256Base64Url(verifier);
    const authorize = new URL(`${ORIGIN}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      scope: 'game:play',
      state: 'state-123',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    const consent = await route(new Request(authorize), env);
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('Authorize a bot');
    expect(html).toContain('Bot callsign');
    const requestToken = html.match(/name="request" value="([^"]+)"/)?.[1];
    expect(requestToken).toBeTruthy();
    const csrfCookie = consent.headers.get('Set-Cookie')?.split(';', 1)[0];
    expect(csrfCookie).toBe(`delta_v_oauth_consent=${requestToken}`);

    const approval = await route(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: csrfCookie ?? '',
          // Wrangler's custom-domain route rewrites the Worker request URL
          // during local dev even though the browser is on loopback.
          Origin: 'http://localhost:8787',
        },
        body: new URLSearchParams({
          request: requestToken ?? '',
          callsign: 'ChatGPT Pilot',
          decision: 'approve',
        }),
      }),
      env,
    );
    expect(approval.status).toBe(302);
    const callback = new URL(approval.headers.get('Location') ?? '');
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-123');
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const exchangeBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code ?? '',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      code_verifier: verifier,
    });
    const exchange = await route(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: exchangeBody,
      }),
      env,
    );
    expect(exchange.status).toBe(200);
    const issued = (await exchange.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
    expect(issued.access_token).toContain('.');
    expect(issued.refresh_token.length).toBeGreaterThan(40);
    expect(issued.scope).toBe('game:play');

    const reusedCode = await route(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: exchangeBody,
      }),
      env,
    );
    expect(reusedCode.status).toBe(400);
    expect(await reusedCode.json()).toMatchObject({ error: 'invalid_grant' });

    const refresh = (token: string) =>
      route(
        new Request(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: token,
            client_id: CLIENT_ID,
            resource: RESOURCE,
          }),
        }),
        env,
      );
    const rotated = await refresh(issued.refresh_token);
    expect(rotated.status).toBe(200);
    const next = (await rotated.json()) as { refresh_token: string };

    expect((await refresh(issued.refresh_token)).status).toBe(400);
    expect((await refresh(next.refresh_token)).status).toBe(400);
  });

  it('does not redirect when client or PKCE validation fails', async () => {
    const env = createEnv();
    const response = await route(
      new Request(
        `${ORIGIN}/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fevil.test%2Fclient.json&redirect_uri=https%3A%2F%2Fevil.test%2Fcallback&resource=${encodeURIComponent(RESOURCE)}&scope=game%3Aplay&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
      ),
      env,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toContain('Authorization could not continue');
  });
});
