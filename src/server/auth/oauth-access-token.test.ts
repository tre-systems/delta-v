import { describe, expect, it } from 'vitest';

import { verifyAgentToken } from './agent-token';
import {
  hasValidOAuthAccessClaims,
  issueOAuthAccessToken,
  OAUTH_ACCESS_TOKEN_TTL_MS,
  verifyOAuthAccessToken,
} from './oauth-access-token';

const SECRET = 'oauth-access-token-test-secret-16-chars';
const ISSUER = 'https://delta-v.test';
const RESOURCE = `${ISSUER}/mcp`;

describe('OAuth access tokens', () => {
  it('round-trips the OAuth grant and validates issuer, audience, and scope', async () => {
    const issued = await issueOAuthAccessToken({
      secret: SECRET,
      issuer: ISSUER,
      audience: RESOURCE,
      scope: 'game:play',
      clientId: 'https://chatgpt.com/oauth/test/client.json',
      grantId: 'grant-1',
      subject: 'subject-1',
      playerKey: 'agent_oauth_player1',
      username: 'OAuth Pilot',
      now: 1_000,
    });

    expect(issued.expiresAt).toBe(1_000 + OAUTH_ACCESS_TOKEN_TTL_MS);
    const verified = await verifyOAuthAccessToken(issued.token, {
      secret: SECRET,
      now: 2_000,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      hasValidOAuthAccessClaims(verified.payload, {
        issuer: ISSUER,
        audience: RESOURCE,
        requiredScope: 'game:play',
      }),
    ).toBe(true);
  });

  it('rejects a wrong resource, issuer, scope, or player-key namespace', async () => {
    const base = {
      kind: 'delta-v.oauth-access.v1' as const,
      iat: 1,
      exp: 2,
      iss: ISSUER,
      aud: RESOURCE,
      scope: 'game:play',
      clientId: 'client',
      grantId: 'grant',
      sub: 'subject',
      playerKey: 'agent_oauth_player1',
      username: 'OAuth Pilot',
    };
    const valid = (overrides: Partial<typeof base>) =>
      hasValidOAuthAccessClaims(
        { ...base, ...overrides },
        {
          issuer: ISSUER,
          audience: RESOURCE,
          requiredScope: 'game:play',
        },
      );

    expect(valid({ aud: 'https://other.test/mcp' })).toBe(false);
    expect(valid({ iss: 'https://other.test' })).toBe(false);
    expect(valid({ scope: 'profile' })).toBe(false);
    expect(valid({ playerKey: 'agent_legacy' })).toBe(false);
  });

  it('cannot be mistaken for a legacy agent token', async () => {
    const { token } = await issueOAuthAccessToken({
      secret: SECRET,
      issuer: ISSUER,
      audience: RESOURCE,
      scope: 'game:play',
      clientId: 'client',
      grantId: 'grant',
      subject: 'subject',
      playerKey: 'agent_oauth_player1',
      username: 'OAuth Pilot',
    });
    const verified = await verifyAgentToken(token, { secret: SECRET });
    expect(verified).toEqual({ ok: false, reason: 'wrongKind' });
  });
});
