import { describe, expect, it } from 'vitest';

import {
  AGENT_TOKEN_DEFAULT_TTL_MS,
  extractBearerToken,
  issueAgentToken,
  isValidAgentPlayerKey,
  verifyAgentToken,
} from './agent-token';

const SECRET = 'agent-token-test-secret-16-chars-long';

describe('issueAgentToken / verifyAgentToken', () => {
  it('round-trips an agent token with the embedded playerKey', async () => {
    const { token, expiresAt } = await issueAgentToken({
      secret: SECRET,
      playerKey: 'agent_alpha',
    });
    const verified = await verifyAgentToken(token, { secret: SECRET });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.playerKey).toBe('agent_alpha');
      expect(verified.payload.exp).toBe(expiresAt);
    }
  });

  it('honors a custom ttlMs', async () => {
    const { token, expiresAt } = await issueAgentToken({
      secret: SECRET,
      playerKey: 'agent_short',
      ttlMs: 1_000,
      now: 1_000,
    });
    expect(expiresAt).toBe(2_000);
    const verified = await verifyAgentToken(token, {
      secret: SECRET,
      now: 1_500,
    });
    expect(verified.ok).toBe(true);
  });

  it('default TTL is 24 hours', () => {
    expect(AGENT_TOKEN_DEFAULT_TTL_MS).toBe(86_400_000);
  });

  it('rejects mismatched secret', async () => {
    const { token } = await issueAgentToken({
      secret: SECRET,
      playerKey: 'agent_a',
    });
    const verified = await verifyAgentToken(token, {
      secret: 'a-completely-other-test-secret-x',
    });
    expect(verified.ok).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc.def', 'abc.def'],
    ['bearer xyz', 'xyz'],
    ['BEARER  spaced  ', 'spaced'],
  ])('parses %j', (input, expected) => {
    expect(extractBearerToken(input)).toBe(expected);
  });

  it.each([
    null,
    '',
    'Token abc',
    'Bearer ',
    'NotBearer xyz',
  ])('returns null for %j', (input) => {
    expect(extractBearerToken(input as string | null)).toBeNull();
  });
});

describe('isValidAgentPlayerKey', () => {
  it('accepts agent_-prefixed keys', () => {
    expect(isValidAgentPlayerKey('agent_my-bot-v1')).toBe(true);
  });

  it('rejects keys without the agent_ prefix', () => {
    expect(isValidAgentPlayerKey('human123')).toBe(false);
  });

  it('rejects keys with bad chars', () => {
    expect(isValidAgentPlayerKey('agent_with spaces')).toBe(false);
    expect(isValidAgentPlayerKey('agent_emoji_🚀')).toBe(false);
  });

  it('rejects too-short and too-long keys', () => {
    expect(isValidAgentPlayerKey('agent_x')).toBe(false); // 7 chars
    expect(isValidAgentPlayerKey(`agent_${'x'.repeat(100)}`)).toBe(false);
  });
});
