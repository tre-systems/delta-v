// Long-lived (24h default) HMAC-signed identity token for an agent.
//
// Issued by POST /api/agent-token; sent by agents in the
// Authorization: Bearer <agentToken> header on every /mcp call. Carries the
// agent's stable playerKey so the server can:
//   - tag matches/replays with the issuing agent
//   - rate-limit per agent rather than per IP
//   - let `delta_v_quick_match` enqueue without the agent passing playerKey
//     in tool args
//
// Security model: the token is the credential. Treat like an API key. The
// playerKey it embeds is not secret on its own (it's logged with every
// match) — the HMAC signature is what authenticates the bearer. Agents that
// leak the token can be revoked by rotating the AGENT_TOKEN_SECRET (which
// invalidates ALL agent tokens, so it's a heavy hammer; per-token
// revocation lists are out of scope for v1).

import {
  type SignedTokenPayload,
  signToken,
  type VerifyResult,
  verifyToken,
} from './tokens';

export const AGENT_TOKEN_KIND = 'delta-v.agent.v1';
export const AGENT_TOKEN_DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface AgentTokenPayload extends SignedTokenPayload {
  kind: typeof AGENT_TOKEN_KIND;
  playerKey: string;
}

export const issueAgentToken = async (opts: {
  secret: string;
  playerKey: string;
  ttlMs?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: number }> => {
  const ttlMs = opts.ttlMs ?? AGENT_TOKEN_DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now();
  const token = await signToken({
    secret: opts.secret,
    ttlMs,
    now,
    payload: { kind: AGENT_TOKEN_KIND, playerKey: opts.playerKey },
  });
  return { token, expiresAt: now + ttlMs };
};

export const verifyAgentToken = (
  token: string,
  opts: { secret: string; now?: number },
): Promise<VerifyResult<AgentTokenPayload>> =>
  verifyToken<AgentTokenPayload>(token, {
    secret: opts.secret,
    expectedKind: AGENT_TOKEN_KIND,
    now: opts.now,
  });

// Pull "Bearer xyz" out of the Authorization header. Returns null when the
// header is missing or malformed — callers treat that as "no agent identity"
// rather than 401, so the legacy code+playerToken path keeps working.
export const extractBearerToken = (header: string | null): string | null => {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const value = trimmed.slice(7).trim();
  return value.length > 0 ? value : null;
};

// Lightweight check for the playerKey shape we accept. Mirrors
// normalizePlayerKey but kept here so this module has no client-side deps.
export const isValidAgentPlayerKey = (raw: unknown): raw is string =>
  typeof raw === 'string' &&
  raw.length >= 8 &&
  raw.length <= 64 &&
  /^[A-Za-z0-9_-]+$/.test(raw) &&
  raw.startsWith('agent_');
