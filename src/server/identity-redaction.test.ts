import { describe, expect, it } from 'vitest';

import { OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY } from '../shared/player';
import { hashPlayerKey, playerKeyRole } from './identity-redaction';

describe('playerKeyRole', () => {
  it('classifies human keys', () => {
    expect(playerKeyRole('human-rob')).toBe('human');
    expect(playerKeyRole('plain-token-aaaaaaaa')).toBe('human');
  });

  it('classifies agent keys', () => {
    expect(playerKeyRole('agent_alpha-12345')).toBe('agent');
  });

  it('classifies the official bot key', () => {
    expect(playerKeyRole(OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY)).toBe(
      'official_bot',
    );
  });
});

describe('hashPlayerKey', () => {
  const env = {
    AGENT_TOKEN_SECRET: 'a'.repeat(32),
    IP_HASH_SALT: 'salt-which-is-long-enough-1234',
    DEV_MODE: '0',
  };

  it('produces a 16-hex-char salted digest', async () => {
    const hash = await hashPlayerKey('human-rob', env);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same playerKey + salt', async () => {
    const a = await hashPlayerKey('human-rob', env);
    const b = await hashPlayerKey('human-rob', env);
    expect(a).toBe(b);
  });

  it('produces different digests for different playerKeys', async () => {
    const a = await hashPlayerKey('human-rob', env);
    const b = await hashPlayerKey('human-fau', env);
    expect(a).not.toBe(b);
  });

  it('produces different digests under different salts', async () => {
    const a = await hashPlayerKey('human-rob', env);
    const b = await hashPlayerKey('human-rob', {
      ...env,
      IP_HASH_SALT: 'a-different-salt-for-rotation-1',
    });
    expect(a).not.toBe(b);
  });

  it('falls back to AGENT_TOKEN_SECRET when IP_HASH_SALT is unset', async () => {
    const a = await hashPlayerKey('human-rob', env);
    const b = await hashPlayerKey('human-rob', {
      ...env,
      IP_HASH_SALT: undefined as unknown as string,
    });
    // Different salt source → different digest. The fallback path must
    // still produce a valid digest (no crash, correct shape).
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  it('throws in production when no salt is configured', async () => {
    await expect(
      hashPlayerKey('human-rob', {
        AGENT_TOKEN_SECRET: undefined as unknown as string,
        IP_HASH_SALT: undefined as unknown as string,
        DEV_MODE: '0',
      }),
    ).rejects.toThrow(/IP_HASH_SALT/);
  });

  it('uses the dev fallback salt when DEV_MODE=1 and no real salt set', async () => {
    const hash = await hashPlayerKey('human-rob', {
      AGENT_TOKEN_SECRET: undefined as unknown as string,
      IP_HASH_SALT: undefined as unknown as string,
      DEV_MODE: '1',
    });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
