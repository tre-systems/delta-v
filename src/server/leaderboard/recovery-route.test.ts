import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import {
  handlePlayerRecoveryIssue,
  handlePlayerRecoveryRestore,
  handlePlayerRecoveryRevoke,
} from './recovery-route';

const playerRow = (playerKey: string, username: string, isAgent = false) => ({
  player_key: playerKey,
  username,
  is_agent: isAgent ? 1 : 0,
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  games_played: 0,
  distinct_opponents: 0,
  last_match_at: null,
  created_at: 123,
});

const buildMockDb = () => {
  const playersByKey = new Map<string, Record<string, unknown>>();
  const recoveryByKey = new Map<string, Record<string, unknown>>();
  const keyByHash = new Map<string, string>();

  const prepare = vi.fn((sql: string) => {
    const lowered = sql.toLowerCase();
    return {
      bind: (...args: unknown[]) => {
        if (
          lowered.startsWith('select') &&
          lowered.includes('from player_recovery')
        ) {
          return {
            first: async () => {
              const key = keyByHash.get(args[0] as string);
              return key ? (recoveryByKey.get(key) ?? null) : null;
            },
          };
        }
        if (lowered.startsWith('select') && lowered.includes('from player')) {
          return {
            first: async () => playersByKey.get(args[0] as string) ?? null,
          };
        }
        if (lowered.startsWith('insert into player_recovery')) {
          const [playerKey, recoveryHash, issuedAt] = args as [
            string,
            string,
            number,
          ];
          return {
            run: async () => {
              const old = recoveryByKey.get(playerKey);
              if (old) {
                keyByHash.delete(old.recovery_hash as string);
              }
              recoveryByKey.set(playerKey, {
                player_key: playerKey,
                recovery_hash: recoveryHash,
                issued_at: issuedAt,
              });
              keyByHash.set(recoveryHash, playerKey);
              return { success: true };
            },
          };
        }
        if (lowered.startsWith('delete from player_recovery')) {
          return {
            run: async () => {
              const playerKey = args[0] as string;
              const old = recoveryByKey.get(playerKey);
              if (old) {
                keyByHash.delete(old.recovery_hash as string);
              }
              recoveryByKey.delete(playerKey);
              return { success: true };
            },
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  });

  return {
    db: { prepare } as unknown as D1Database,
    playersByKey,
    recoveryByKey,
  };
};

const env = (db?: D1Database): Env => ({ DB: db }) as unknown as Env;

const post = (path: string, body: unknown): Request =>
  new Request(`https://w.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('player recovery routes', () => {
  it('issues a code for a claimed human player and restores the profile', async () => {
    const { db, playersByKey } = buildMockDb();
    playersByKey.set('human_alpha-v1', playerRow('human_alpha-v1', 'Zephyr'));

    const issue = await handlePlayerRecoveryIssue(
      post('/api/player-recovery/issue', { playerKey: 'human_alpha-v1' }),
      env(db),
    );

    expect(issue.status).toBe(200);
    const issued = (await issue.json()) as {
      recoveryCode: string;
    };
    expect(issued.recoveryCode).toMatch(/^dv1-[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);

    const restore = await handlePlayerRecoveryRestore(
      post('/api/player-recovery/restore', {
        recoveryCode: issued.recoveryCode.toUpperCase().replace(/-/g, ' '),
      }),
      env(db),
    );

    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({
      ok: true,
      profile: {
        playerKey: 'human_alpha-v1',
        username: 'Zephyr',
      },
    });
  });

  it('rotates codes and invalidates the previous code', async () => {
    const { db, playersByKey } = buildMockDb();
    playersByKey.set('human_alpha-v1', playerRow('human_alpha-v1', 'Zephyr'));

    const first = (await (
      await handlePlayerRecoveryIssue(
        post('/api/player-recovery/issue', { playerKey: 'human_alpha-v1' }),
        env(db),
      )
    ).json()) as { recoveryCode: string };
    const second = (await (
      await handlePlayerRecoveryIssue(
        post('/api/player-recovery/issue', { playerKey: 'human_alpha-v1' }),
        env(db),
      )
    ).json()) as { recoveryCode: string };

    expect(second.recoveryCode).not.toBe(first.recoveryCode);
    const oldRestore = await handlePlayerRecoveryRestore(
      post('/api/player-recovery/restore', {
        recoveryCode: first.recoveryCode,
      }),
      env(db),
    );
    expect(oldRestore.status).toBe(404);
  });

  it('rejects unclaimed, agent, malformed, and unavailable requests', async () => {
    const { db } = buildMockDb();

    const unclaimed = await handlePlayerRecoveryIssue(
      post('/api/player-recovery/issue', { playerKey: 'human_missing-v1' }),
      env(db),
    );
    expect(unclaimed.status).toBe(404);

    const agent = await handlePlayerRecoveryIssue(
      post('/api/player-recovery/issue', { playerKey: 'agent_reserved123' }),
      env(db),
    );
    expect(agent.status).toBe(400);

    const malformed = await handlePlayerRecoveryRestore(
      post('/api/player-recovery/restore', { recoveryCode: 'bad-code' }),
      env(db),
    );
    expect(malformed.status).toBe(400);

    const unavailable = await handlePlayerRecoveryIssue(
      post('/api/player-recovery/issue', { playerKey: 'human_alpha-v1' }),
      env(),
    );
    expect(unavailable.status).toBe(503);
  });

  it('revokes recovery idempotently', async () => {
    const { db, playersByKey, recoveryByKey } = buildMockDb();
    playersByKey.set('human_alpha-v1', playerRow('human_alpha-v1', 'Zephyr'));

    const issued = (await (
      await handlePlayerRecoveryIssue(
        post('/api/player-recovery/issue', { playerKey: 'human_alpha-v1' }),
        env(db),
      )
    ).json()) as { recoveryCode: string };
    expect(recoveryByKey.size).toBe(1);

    const revoke = await handlePlayerRecoveryRevoke(
      post('/api/player-recovery/revoke', { playerKey: 'human_alpha-v1' }),
      env(db),
    );
    const secondRevoke = await handlePlayerRecoveryRevoke(
      post('/api/player-recovery/revoke', { playerKey: 'human_alpha-v1' }),
      env(db),
    );
    expect(revoke.status).toBe(200);
    expect(secondRevoke.status).toBe(200);
    expect(recoveryByKey.size).toBe(0);

    const restore = await handlePlayerRecoveryRestore(
      post('/api/player-recovery/restore', {
        recoveryCode: issued.recoveryCode,
      }),
      env(db),
    );
    expect(restore.status).toBe(404);
  });
});
