import {
  type SignedTokenPayload,
  signToken,
  type VerifyResult,
  verifyToken,
} from './tokens';

export const OAUTH_ACCESS_TOKEN_KIND = 'delta-v.oauth-access.v1';
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000;

export interface OAuthAccessTokenPayload extends SignedTokenPayload {
  kind: typeof OAUTH_ACCESS_TOKEN_KIND;
  iss: string;
  aud: string;
  scope: string;
  clientId: string;
  grantId: string;
  sub: string;
  playerKey: string;
  username: string;
}

export const issueOAuthAccessToken = async (opts: {
  secret: string;
  issuer: string;
  audience: string;
  scope: string;
  clientId: string;
  grantId: string;
  subject: string;
  playerKey: string;
  username: string;
  ttlMs?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: number }> => {
  const ttlMs = opts.ttlMs ?? OAUTH_ACCESS_TOKEN_TTL_MS;
  const now = opts.now ?? Date.now();
  const token = await signToken({
    secret: opts.secret,
    ttlMs,
    now,
    payload: {
      kind: OAUTH_ACCESS_TOKEN_KIND,
      iss: opts.issuer,
      aud: opts.audience,
      scope: opts.scope,
      clientId: opts.clientId,
      grantId: opts.grantId,
      sub: opts.subject,
      playerKey: opts.playerKey,
      username: opts.username,
    },
  });
  return { token, expiresAt: now + ttlMs };
};

export const verifyOAuthAccessToken = (
  token: string,
  opts: { secret: string; now?: number },
): Promise<VerifyResult<OAuthAccessTokenPayload>> =>
  verifyToken<OAuthAccessTokenPayload>(token, {
    secret: opts.secret,
    expectedKind: OAUTH_ACCESS_TOKEN_KIND,
    now: opts.now,
  });

export const hasValidOAuthAccessClaims = (
  payload: OAuthAccessTokenPayload,
  opts: { issuer: string; audience: string; requiredScope: string },
): boolean =>
  payload.iss === opts.issuer &&
  payload.aud === opts.audience &&
  typeof payload.clientId === 'string' &&
  payload.clientId.length > 0 &&
  typeof payload.grantId === 'string' &&
  payload.grantId.length > 0 &&
  typeof payload.sub === 'string' &&
  payload.sub.length > 0 &&
  typeof payload.playerKey === 'string' &&
  payload.playerKey.startsWith('agent_oauth_') &&
  typeof payload.username === 'string' &&
  /^[A-Za-z0-9 _-]{2,20}$/.test(payload.username) &&
  typeof payload.scope === 'string' &&
  payload.scope.split(/\s+/).includes(opts.requiredScope);
