import { describe, expect, it, vi } from 'vitest';

import {
  claimPlayerName,
  type PlayerRecord,
  selectPlayerByKey,
} from './player-store';

// In-memory D1 mock keyed by player_key. Supports SELECT, INSERT, and
// UPDATE shapes used by player-store, mirroring schema's PK + UNIQUE
// constraints.
const buildMockDb = () => {
  const byKey = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, string>(); // username -> player_key

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
              const existingOwner = byName.get(nextUsername);
              if (existingOwner && existingOwner !== playerKey) {
                throw new Error('UNIQUE constraint failed: player.username');
              }
              const row = byKey.get(playerKey);
              if (!row) {
                return { success: true };
              }
              const prevUsername = row.username as string;
              byName.delete(prevUsername);
              row.username = nextUsername;
              byName.set(nextUsername, playerKey);
              return { success: true };
            },
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  });

  return { db: { prepare } as unknown as D1Database, byKey, byName };
};

describe('selectPlayerByKey', () => {
  it('returns null when no row exists', async () => {
    const { db } = buildMockDb();
    expect(await selectPlayerByKey(db, 'agent_ghost')).toBeNull();
  });

  it('returns a record mapped from the D1 row', async () => {
    const { db, byKey } = buildMockDb();
    byKey.set('agent_real', {
      player_key: 'agent_real',
      username: 'Real',
      is_agent: 1,
      rating: 1612.3,
      rd: 180.5,
      volatility: 0.0601,
      games_played: 3,
      distinct_opponents: 2,
      last_match_at: 1_700_000_100_000,
      created_at: 1_700_000_000_000,
    });
    const player = await selectPlayerByKey(db, 'agent_real');
    expect(player).toEqual({
      playerKey: 'agent_real',
      username: 'Real',
      isAgent: true,
      rating: 1612.3,
      rd: 180.5,
      volatility: 0.0601,
      gamesPlayed: 3,
      distinctOpponents: 2,
      lastMatchAt: 1_700_000_100_000,
      createdAt: 1_700_000_000_000,
    });
  });
});

describe('claimPlayerName', () => {
  const defaults = (
    overrides: Partial<Parameters<typeof claimPlayerName>[0]> = {},
  ) => ({
    playerKey: 'agent_alpha',
    username: 'Alpha',
    isAgent: true,
    now: 1_700_000_000_000,
    ...overrides,
  });

  it('creates a new player row with defaults on first claim', async () => {
    const { db } = buildMockDb();
    const result = await claimPlayerName({ db, ...defaults() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.renamed).toBe(false);
    const p: PlayerRecord = result.player;
    expect(p.playerKey).toBe('agent_alpha');
    expect(p.username).toBe('Alpha');
    expect(p.isAgent).toBe(true);
    expect(p.rating).toBe(1500);
    expect(p.rd).toBe(350);
    expect(p.gamesPlayed).toBe(0);
  });

  it('returns the existing row on re-claim with the same name', async () => {
    const { db } = buildMockDb();
    await claimPlayerName({ db, ...defaults() });
    const second = await claimPlayerName({ db, ...defaults() });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.renamed).toBe(false);
    expect(second.player.username).toBe('Alpha');
  });

  it('renames the existing row when the caller posts a new name', async () => {
    const { db } = buildMockDb();
    await claimPlayerName({ db, ...defaults() });
    const result = await claimPlayerName({
      db,
      ...defaults({ username: 'Beta' }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renamed).toBe(true);
    expect(result.player.username).toBe('Beta');
  });

  it('rejects a rename to a name owned by a different key', async () => {
    const { db } = buildMockDb();
    await claimPlayerName({
      db,
      ...defaults({ playerKey: 'agent_owner', username: 'Alpha' }),
    });
    await claimPlayerName({
      db,
      ...defaults({ playerKey: 'agent_other', username: 'Gamma' }),
    });
    const result = await claimPlayerName({
      db,
      ...defaults({ playerKey: 'agent_other', username: 'Alpha' }),
    });
    expect(result).toEqual({ ok: false, error: 'name_taken' });
  });

  it('rejects a brand-new claim on a name owned by someone else', async () => {
    const { db } = buildMockDb();
    await claimPlayerName({ db, ...defaults() });
    const second = await claimPlayerName({
      db,
      ...defaults({ playerKey: 'agent_other' }),
    });
    expect(second).toEqual({ ok: false, error: 'name_taken' });
  });

  it('writes is_agent=0 for a human claim', async () => {
    const { db, byKey } = buildMockDb();
    await claimPlayerName({
      db,
      ...defaults({
        playerKey: 'human_x',
        username: 'Human',
        isAgent: false,
      }),
    });
    expect(byKey.get('human_x')?.is_agent).toBe(0);
  });
});
