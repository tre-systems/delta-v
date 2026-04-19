import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import { verifyAgentToken } from './';
import { handleAgentTokenIssue } from './issue-route';

const TEST_SECRET = 'issue-route-test-secret-must-be-16-chars';

// Minimal D1 mock matching the SELECT + INSERT + UPDATE shapes used by
// player-store. Keyed by player_key; honours UNIQUE on username.
const buildMockDb = () => {
  const byKey = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, string>();

  const prepare = vi.fn((sql: string) => {
    const lowered = sql.toLowerCase();
    return {
      bind: (...args: unknown[]) => {
        if (lowered.startsWith('select')) {
          return {
            first: async () => byKey.get(args[0] as string) ?? null,
          };
        }
        if (lowered.startsWith('insert into player')) {
          const [playerKey, username, isAgent, createdAt] = args as [
            string,
            string,
            number,
            number,
          ];
          return {
            run: async () => {
              if (byKey.has(playerKey)) {
                throw new Error('UNIQUE constraint failed: player.player_key');
              }
              if (byName.has(username)) {
                throw new Error('UNIQUE constraint failed: player.username');
              }
              byKey.set(playerKey, {
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
              });
              byName.set(username, playerKey);
              return { success: true };
            },
          };
        }
        if (lowered.startsWith('update player')) {
          const [nextUsername, playerKey] = args as [string, string];
          return {
            run: async () => {
              const owner = byName.get(nextUsername);
              if (owner && owner !== playerKey) {
                throw new Error('UNIQUE constraint failed: player.username');
              }
              const row = byKey.get(playerKey);
              if (row) {
                byName.delete(row.username as string);
                row.username = nextUsername;
                byName.set(nextUsername, playerKey);
              }
              return { success: true };
            },
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  });

  return { db: { prepare } as unknown as D1Database, byKey };
};

const env = (db?: D1Database): Env =>
  ({
    AGENT_TOKEN_SECRET: TEST_SECRET,
    DB: db,
  }) as unknown as Env;

const post = (body: unknown): Request =>
  new Request('https://w.test/api/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('handleAgentTokenIssue', () => {
  it('returns 500 when AGENT_TOKEN_SECRET is unset in production', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'agent_alpha-v1' }),
      { DB: undefined } as unknown as Env,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('server_misconfigured');
  });

  it('allows the dev fallback when DEV_MODE=1 is set', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'agent_alpha-v1' }),
      { DEV_MODE: '1' } as unknown as Env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token.length).toBeGreaterThan(0);
  });

  it('rejects non-POST methods', async () => {
    const res = await handleAgentTokenIssue(
      new Request('https://w.test/api/agent-token', { method: 'GET' }),
      env(),
    );
    expect(res.status).toBe(405);
  });

  it('rejects malformed JSON', async () => {
    const res = await handleAgentTokenIssue(
      new Request('https://w.test/api/agent-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing playerKey', async () => {
    const res = await handleAgentTokenIssue(post({}), env());
    expect(res.status).toBe(400);
  });

  it('rejects non-agent_-prefixed playerKey', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'human_user' }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('issues a valid token for a well-formed agent_ key', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'agent_alpha-v1' }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      token: string;
      expiresAt: number;
      ttlMs: number;
      playerKey: string;
      tokenType: string;
      player?: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.tokenType).toBe('Bearer');
    expect(body.playerKey).toBe('agent_alpha-v1');
    expect(body.ttlMs).toBe(86_400_000);
    expect(body.player).toBeUndefined();

    const verified = await verifyAgentToken(body.token, {
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.playerKey).toBe('agent_alpha-v1');
    }
  });

  it('issues a token AND creates a player row when claim is present', async () => {
    const { db, byKey } = buildMockDb();
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_alpha-v1',
        claim: { username: 'Zephyr' },
      }),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      player?: {
        username: string;
        isAgent: boolean;
        rating: number;
        rd: number;
        gamesPlayed: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.player).toEqual({
      username: 'Zephyr',
      isAgent: true,
      rating: 1500,
      rd: 350,
      gamesPlayed: 0,
    });
    expect(byKey.get('agent_alpha-v1')?.username).toBe('Zephyr');
    expect(byKey.get('agent_alpha-v1')?.is_agent).toBe(1);
  });

  it('rejects an invalid username without issuing a token', async () => {
    const { db, byKey } = buildMockDb();
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_alpha-v1',
        claim: { username: 'has!bad!chars' },
      }),
      env(db),
    );
    expect(res.status).toBe(400);
    expect(byKey.size).toBe(0);
  });

  it('rejects reserved usernames with a conflict status', async () => {
    const { db, byKey } = buildMockDb();
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_alpha-v1',
        claim: { username: 'administrator' },
      }),
      env(db),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('username_reserved');
    expect(byKey.size).toBe(0);
  });

  it('returns 409 when the name is already owned by another key', async () => {
    const { db } = buildMockDb();
    await handleAgentTokenIssue(
      post({
        playerKey: 'agent_first-aaa',
        claim: { username: 'Taken' },
      }),
      env(db),
    );
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_second-bbb',
        claim: { username: 'Taken' },
      }),
      env(db),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('name_taken');
  });

  it('renames an existing agent when a different name is claimed', async () => {
    const { db } = buildMockDb();
    await handleAgentTokenIssue(
      post({
        playerKey: 'agent_same-xyz',
        claim: { username: 'Original' },
      }),
      env(db),
    );
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_same-xyz',
        claim: { username: 'Renamed' },
      }),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { player?: { username: string } };
    expect(body.player?.username).toBe('Renamed');
  });

  it('returns 503 when a claim is requested but D1 is unbound', async () => {
    const res = await handleAgentTokenIssue(
      post({
        playerKey: 'agent_alpha-v1',
        claim: { username: 'Zephyr' },
      }),
      env(),
    );
    expect(res.status).toBe(503);
  });
});
