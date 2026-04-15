// Per-match HMAC-signed credential bag. Returned by delta_v_quick_match
// (when the caller authenticated with an agentToken) and accepted by every
// subsequent in-match MCP tool in place of the raw `{code, playerToken}`.
//
// Why a token vs. a server-side session map? Stateless. The Worker is
// request-scoped; per-session DOs would add a third DO type and a write
// path on every quick-match. Encoding {code, playerToken} into an HMAC blob
// keeps the entire matchToken lifecycle in pure functions.
//
// The token binds to the issuing agent via `agentTokenHash` (SHA-256 of the
// agentToken). A stolen matchToken still requires the matching agentToken
// to be presented in Authorization, so casual leak via tool args alone
// can't be replayed by a different agent.

import {
  type SignedTokenPayload,
  signToken,
  type VerifyResult,
  verifyToken,
} from './tokens';

export const MATCH_TOKEN_KIND = 'delta-v.match.v1';
// Default match-token TTL — long enough to outlast any reasonable game,
// short enough that a leaked token expires before it could be replayed in
// a future match.
export const MATCH_TOKEN_DEFAULT_TTL_MS = 4 * 60 * 60 * 1_000;

export interface MatchTokenPayload extends SignedTokenPayload {
  kind: typeof MATCH_TOKEN_KIND;
  code: string;
  playerToken: string;
  // SHA-256 hex of the issuing agentToken. Bind so a leaked matchToken
  // alone (without the agentToken) cannot be replayed by a different
  // agent identity.
  agentTokenHash: string;
}

const sha256Hex = async (input: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const hashAgentToken = (agentToken: string): Promise<string> =>
  sha256Hex(agentToken);

export const issueMatchToken = async (opts: {
  secret: string;
  code: string;
  playerToken: string;
  agentToken: string;
  ttlMs?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: number }> => {
  const ttlMs = opts.ttlMs ?? MATCH_TOKEN_DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now();
  const agentTokenHash = await hashAgentToken(opts.agentToken);
  const token = await signToken({
    secret: opts.secret,
    ttlMs,
    now,
    payload: {
      kind: MATCH_TOKEN_KIND,
      code: opts.code,
      playerToken: opts.playerToken,
      agentTokenHash,
    },
  });
  return { token, expiresAt: now + ttlMs };
};

export const verifyMatchToken = (
  token: string,
  opts: { secret: string; now?: number },
): Promise<VerifyResult<MatchTokenPayload>> =>
  verifyToken<MatchTokenPayload>(token, {
    secret: opts.secret,
    expectedKind: MATCH_TOKEN_KIND,
    now: opts.now,
  });
