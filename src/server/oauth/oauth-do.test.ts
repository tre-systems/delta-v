import { afterEach, describe, expect, it, vi } from 'vitest';

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

import type {
  OAuthGrant,
  StoredAuthorizationCode,
  StoredAuthorizationRequest,
  StoredRefreshFamily,
  StoredRefreshToken,
} from './model';
import { OAuthDO } from './oauth-do';

type MockStorage = DurableObjectStorage & {
  data: Map<string, unknown>;
  alarm: () => number | null;
};

const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;

  const read = async <T>(keyOrKeys: string | string[]) => {
    if (Array.isArray(keyOrKeys)) {
      const values = new Map<string, T>();
      for (const key of keyOrKeys) {
        if (data.has(key)) values.set(key, data.get(key) as T);
      }
      return values;
    }
    return data.get(keyOrKeys) as T | undefined;
  };

  const write = async <T>(
    keyOrEntries: string | Record<string, T>,
    value?: T,
  ) => {
    if (typeof keyOrEntries === 'string') {
      data.set(keyOrEntries, value);
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) {
      data.set(key, entry);
    }
  };

  const remove = async (keyOrKeys: string | string[]) => {
    if (Array.isArray(keyOrKeys)) {
      let removed = 0;
      for (const key of keyOrKeys) {
        if (data.delete(key)) removed++;
      }
      return removed;
    }
    return data.delete(keyOrKeys);
  };

  const storage = {
    data,
    alarm: () => alarm,
    get: vi.fn(read),
    put: vi.fn(write),
    delete: vi.fn(remove),
    list: vi.fn(async (options?: DurableObjectListOptions) => {
      const values = new Map<string, unknown>();
      for (const [key, value] of [...data.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue;
        if (options?.start && key < options.start) continue;
        if (options?.startAfter && key <= options.startAfter) continue;
        if (options?.end && key >= options.end) continue;
        values.set(key, value);
        if (options?.limit && values.size >= options.limit) break;
      }
      return values;
    }),
    transaction: vi.fn(
      async <T>(closure: (tx: DurableObjectTransaction) => Promise<T>) => {
        const snapshot = new Map(data);
        const tx = {
          get: read,
          put: write,
          delete: remove,
          rollback: vi.fn(() => {
            data.clear();
            for (const [key, value] of snapshot) data.set(key, value);
          }),
          getAlarm: vi.fn(async () => alarm),
          setAlarm: vi.fn(async (value: number | Date) => {
            alarm = value instanceof Date ? value.getTime() : value;
          }),
          deleteAlarm: vi.fn(async () => {
            alarm = null;
          }),
        } as unknown as DurableObjectTransaction;
        try {
          return await closure(tx);
        } catch (error) {
          data.clear();
          for (const [key, value] of snapshot) data.set(key, value);
          throw error;
        }
      },
    ),
    getAlarm: vi.fn(async () => alarm),
    setAlarm: vi.fn(async (value: number | Date) => {
      alarm = value instanceof Date ? value.getTime() : value;
    }),
    deleteAlarm: vi.fn(async () => {
      alarm = null;
    }),
  } as unknown as MockStorage;

  return storage;
};

const createOAuthDO = () => {
  const storage = createMockStorage();
  const ctx = {
    storage,
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
  const oauth = new OAuthDO(ctx, {} as never);
  return { oauth, storage };
};

const post = (oauth: OAuthDO, path: string, body: Record<string, unknown>) =>
  oauth.fetch(
    new Request(`https://oauth.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const authorizationRequest = (
  expiresAt: number,
): StoredAuthorizationRequest => ({
  v: 1,
  clientId: 'client-1',
  clientName: 'Test client',
  redirectUri: 'https://client.example/callback',
  resource: 'https://delta-v.test/mcp',
  scope: 'game:play',
  state: 'opaque-client-state',
  codeChallenge: 'pkce-challenge',
  expiresAt,
  expiryKey: '',
});

const authorizationCode = (expiresAt: number): StoredAuthorizationCode => ({
  v: 1,
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  resource: 'https://delta-v.test/mcp',
  scope: 'game:play',
  codeChallenge: 'pkce-challenge',
  subject: 'oauth-subject',
  playerKey: 'agent_oauth_subject',
  username: 'OAuth Pilot',
  grantId: 'grant-1',
  expiresAt,
  expiryKey: '',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OAuthDO', () => {
  it('consumes an authorization request exactly once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { oauth, storage } = createOAuthDO();
    const record = authorizationRequest(2_000);

    const created = await post(oauth, '/request/create', {
      hash: 'request-hash',
      record,
    });
    expect(created.status).toBe(200);

    const beforeConsume = await post(oauth, '/request/get', {
      hash: 'request-hash',
    });
    expect(beforeConsume.status).toBe(200);

    const consumed = await post(oauth, '/request/consume', {
      hash: 'request-hash',
    });
    expect(consumed.status).toBe(200);
    await expect(consumed.json()).resolves.toMatchObject({
      ok: true,
      record: {
        clientId: record.clientId,
        state: record.state,
        expiryKey: expect.stringContaining('request:request-hash'),
      },
    });

    const replay = await post(oauth, '/request/consume', {
      hash: 'request-hash',
    });
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(storage.data.has('request:request-hash')).toBe(false);
    expect(
      [...storage.data.keys()].some((key) => key.startsWith('expiry:')),
    ).toBe(false);
  });

  it('binds a one-time authorization code to the exact client, redirect, resource, and PKCE challenge', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { oauth, storage } = createOAuthDO();
    const record = authorizationCode(2_000);

    expect(
      (
        await post(oauth, '/code/create', {
          hash: 'code-hash',
          record,
        })
      ).status,
    ).toBe(200);

    const exactBinding = {
      hash: 'code-hash',
      clientId: record.clientId,
      redirectUri: record.redirectUri,
      resource: record.resource,
      derivedChallenge: record.codeChallenge,
    };
    const mismatches = [
      { clientId: 'client-2' },
      { redirectUri: 'https://client.example/other' },
      { resource: 'https://other.example/mcp' },
      { derivedChallenge: 'wrong-pkce-challenge' },
    ];

    for (const mismatch of mismatches) {
      const rejected = await post(oauth, '/code/redeem', {
        ...exactBinding,
        ...mismatch,
      });
      expect(rejected.status).toBe(400);
      expect(storage.data.has('code:code-hash')).toBe(true);
    }

    const redeemed = await post(oauth, '/code/redeem', exactBinding);
    expect(redeemed.status).toBe(200);
    await expect(redeemed.json()).resolves.toMatchObject({
      ok: true,
      record: {
        grantId: record.grantId,
        playerKey: record.playerKey,
      },
    });

    const replay = await post(oauth, '/code/redeem', exactBinding);
    expect(replay.status).toBe(400);
    expect(storage.data.has('code:code-hash')).toBe(false);
  });

  it('rotates refresh tokens and returns the stored grant', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { oauth, storage } = createOAuthDO();
    const grant: OAuthGrant = {
      clientId: 'client-1',
      resource: 'https://delta-v.test/mcp',
      scope: 'game:play',
      subject: 'oauth-subject',
      playerKey: 'agent_oauth_subject',
      username: 'OAuth Pilot',
      grantId: 'family-1',
    };

    const created = await post(oauth, '/refresh/create', {
      familyId: grant.grantId,
      refreshHash: 'refresh-0',
      expiresAt: 10_000,
      grant,
    });
    expect(created.status).toBe(200);

    const rotated = await post(oauth, '/refresh/rotate', {
      oldHash: 'refresh-0',
      newHash: 'refresh-1',
      clientId: grant.clientId,
      resource: grant.resource,
    });
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toEqual({ ok: true, grant });

    expect(storage.data.get('refresh:refresh-0')).toMatchObject({
      generation: 0,
      state: 'used',
      usedAt: 1_000,
    });
    expect(storage.data.get('refresh:refresh-1')).toMatchObject({
      generation: 1,
      state: 'active',
      usedAt: null,
    });
    expect(storage.data.get('family:family-1')).toMatchObject({
      currentRefreshHash: 'refresh-1',
      revokedAt: null,
    });
  });

  it('revokes a refresh family when an old token is replayed and rejects the latest token', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { oauth, storage } = createOAuthDO();
    const grant: OAuthGrant = {
      clientId: 'client-1',
      resource: 'https://delta-v.test/mcp',
      scope: 'game:play',
      subject: 'oauth-subject',
      playerKey: 'agent_oauth_subject',
      username: 'OAuth Pilot',
      grantId: 'family-1',
    };

    await post(oauth, '/refresh/create', {
      familyId: grant.grantId,
      refreshHash: 'refresh-0',
      expiresAt: 10_000,
      grant,
    });
    await post(oauth, '/refresh/rotate', {
      oldHash: 'refresh-0',
      newHash: 'refresh-1',
      clientId: grant.clientId,
      resource: grant.resource,
    });

    vi.spyOn(Date, 'now').mockReturnValue(1_500);
    const replay = await post(oauth, '/refresh/rotate', {
      oldHash: 'refresh-0',
      newHash: 'attacker-refresh',
      clientId: grant.clientId,
      resource: grant.resource,
    });
    expect(replay.status).toBe(400);
    expect(storage.data.get('family:family-1')).toMatchObject({
      currentRefreshHash: 'refresh-1',
      revokedAt: 1_500,
    } satisfies Partial<StoredRefreshFamily>);

    const latest = await post(oauth, '/refresh/rotate', {
      oldHash: 'refresh-1',
      newHash: 'refresh-2',
      clientId: grant.clientId,
      resource: grant.resource,
    });
    expect(latest.status).toBe(400);
    expect(storage.data.has('refresh:refresh-2')).toBe(false);
    expect(storage.data.get('refresh:refresh-1')).toMatchObject({
      state: 'active',
    } satisfies Partial<StoredRefreshToken>);
  });

  it('removes expired requests, codes, refresh tokens, and refresh families in order', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { oauth, storage } = createOAuthDO();

    await post(oauth, '/request/create', {
      hash: 'request-hash',
      record: authorizationRequest(1_200),
    });
    await post(oauth, '/code/create', {
      hash: 'code-hash',
      record: authorizationCode(1_400),
    });
    await post(oauth, '/refresh/create', {
      familyId: 'family-1',
      refreshHash: 'refresh-0',
      expiresAt: 1_600,
      grant: {
        clientId: 'client-1',
        resource: 'https://delta-v.test/mcp',
        scope: 'game:play',
        subject: 'oauth-subject',
        playerKey: 'agent_oauth_subject',
        username: 'OAuth Pilot',
        grantId: 'family-1',
      } satisfies OAuthGrant,
    });
    expect(storage.alarm()).toBe(1_200);

    now.mockReturnValue(1_300);
    await oauth.alarm();
    expect(storage.data.has('request:request-hash')).toBe(false);
    expect(storage.data.has('code:code-hash')).toBe(true);
    expect(storage.alarm()).toBe(1_400);

    now.mockReturnValue(1_400);
    await oauth.alarm();
    expect(storage.data.has('code:code-hash')).toBe(false);
    expect(storage.data.has('refresh:refresh-0')).toBe(true);
    expect(storage.data.has('family:family-1')).toBe(true);
    expect(storage.alarm()).toBe(1_600);

    now.mockReturnValue(1_600);
    await oauth.alarm();
    expect(storage.data.has('refresh:refresh-0')).toBe(false);
    expect(storage.data.has('family:family-1')).toBe(false);
    expect(
      [...storage.data.keys()].some((key) => key.startsWith('expiry:')),
    ).toBe(false);
  });
});
