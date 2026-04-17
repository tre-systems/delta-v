import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import { handleClaimName } from './claim-route';

// Minimal D1 mock matching the SELECT / INSERT / UPDATE shapes used by
// player-store.
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

const env = (db?: D1Database): Env => ({ DB: db }) as unknown as Env;

const post = (body: unknown): Request =>
  new Request('https://w.test/api/claim-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('handleClaimName', () => {
  it('rejects non-POST methods', async () => {
    const res = await handleClaimName(
      new Request('https://w.test/api/claim-name', { method: 'GET' }),
      env(),
    );
    expect(res.status).toBe(405);
  });

  it('rejects malformed JSON', async () => {
    const res = await handleClaimName(
      new Request('https://w.test/api/claim-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an invalid playerKey format', async () => {
    const res = await handleClaimName(
      post({ playerKey: 'short', username: 'Pilot' }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an agent_-prefixed playerKey', async () => {
    const { db } = buildMockDb();
    const res = await handleClaimName(
      post({ playerKey: 'agent_reserved123', username: 'Pilot' }),
      env(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('agent-token');
  });

  it('rejects an invalid username', async () => {
    const { db, byKey } = buildMockDb();
    const res = await handleClaimName(
      post({ playerKey: 'human_alpha-v1', username: 'has!bad!chars' }),
      env(db),
    );
    expect(res.status).toBe(400);
    expect(byKey.size).toBe(0);
  });

  it('accepts usernames with spaces (aligns with Callsign UX)', async () => {
    const { db } = buildMockDb();
    const res = await handleClaimName(
      post({ playerKey: 'human_alpha-v1', username: 'Pilot 3BAA' }),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { player: { username: string } };
    expect(body.player.username).toBe('Pilot 3BAA');
  });

  it('creates a new player row with is_agent=0', async () => {
    const { db, byKey } = buildMockDb();
    const res = await handleClaimName(
      post({ playerKey: 'human_alpha-v1', username: 'Zephyr' }),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      player: {
        username: string;
        isAgent: boolean;
        rating: number;
        rd: number;
        gamesPlayed: number;
      };
      renamed: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.player).toEqual({
      username: 'Zephyr',
      isAgent: false,
      rating: 1500,
      rd: 350,
      gamesPlayed: 0,
    });
    expect(body.renamed).toBe(false);
    expect(byKey.get('human_alpha-v1')?.is_agent).toBe(0);
  });

  it('returns 409 when the name is already owned by another key', async () => {
    const { db } = buildMockDb();
    await handleClaimName(
      post({ playerKey: 'human_first-v1', username: 'Taken' }),
      env(db),
    );
    const res = await handleClaimName(
      post({ playerKey: 'human_second-v1', username: 'Taken' }),
      env(db),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('name_taken');
  });

  it('renames the same key to a new free username', async () => {
    const { db } = buildMockDb();
    await handleClaimName(
      post({ playerKey: 'human_same-v1', username: 'Original' }),
      env(db),
    );
    const res = await handleClaimName(
      post({ playerKey: 'human_same-v1', username: 'Updated' }),
      env(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      player: { username: string };
      renamed: boolean;
    };
    expect(body.player.username).toBe('Updated');
    expect(body.renamed).toBe(true);
  });

  it('returns 503 when D1 is unbound', async () => {
    const res = await handleClaimName(
      post({ playerKey: 'human_alpha-v1', username: 'Zephyr' }),
      env(),
    );
    expect(res.status).toBe(503);
  });
});
