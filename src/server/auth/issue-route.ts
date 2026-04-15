// POST /api/agent-token — Worker route that issues a new agent identity
// token. Body: { playerKey: "agent_..." }. Response: { token, expiresAt,
// playerKey, ttlMs }.
//
// This is the only public endpoint that mints tokens. The agent treats it
// the way it would treat an API-key issuance form: hit it once at setup
// time, store the result as an env var, never call again until the token
// expires (default 24h).
//
// Rate-limited via the same per-IP CREATE_RATE_LIMITER as /create —
// minting tokens is cheap but unbounded issuance would let a noisy IP
// pollute analytics with throwaway agent identities.

import type { Env } from '../env';
import {
  AGENT_TOKEN_DEFAULT_TTL_MS,
  issueAgentToken,
  isValidAgentPlayerKey,
  resolveAgentTokenSecret,
} from './';

export const handleAgentTokenIssue = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }
  let body: { playerKey?: unknown };
  try {
    body = (await request.json()) as { playerKey?: unknown };
  } catch {
    return Response.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }
  if (!isValidAgentPlayerKey(body.playerKey)) {
    return Response.json(
      {
        ok: false,
        error:
          'playerKey must match /^agent_[A-Za-z0-9_-]+$/ and be 8-64 chars',
      },
      { status: 400 },
    );
  }
  const secret = resolveAgentTokenSecret(env);
  const { token, expiresAt } = await issueAgentToken({
    secret,
    playerKey: body.playerKey,
  });
  return Response.json(
    {
      ok: true,
      token,
      expiresAt,
      ttlMs: AGENT_TOKEN_DEFAULT_TTL_MS,
      playerKey: body.playerKey,
      tokenType: 'Bearer',
      usage:
        'Send as `Authorization: Bearer <token>` on every POST /mcp request.',
    },
    { status: 200 },
  );
};
