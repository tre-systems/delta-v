// POST /api/agent-token — Worker route that issues a new agent
// identity token. First registration returns both a 24-hour bearer and a
// one-time-disclosed agentSecret. Renewal requires that secret or a still-valid
// bearer for the same identity.
//
// This is the only public endpoint that mints tokens. The agent treats
// it the way it would treat an API-key issuance form: hit it once at
// setup time, store the result as an env var, never call again until
// the token expires (default 24h).
//
// When the optional `claim.username` is present, the server also binds
// the playerKey to that username in the `player` table so the agent
// can appear on the public leaderboard. A playerKey may rename itself
// freely; a username already owned by a different key returns 409.
//
// Rate-limited via the same per-IP CREATE_RATE_LIMITER as /create —
// minting tokens is cheap but unbounded issuance would let a noisy IP
// pollute analytics with throwaway agent identities.

import { isOfficialQuickMatchBotPlayerKey } from '../../shared/player';
import type { Env } from '../env';
import { jsonError } from '../json-errors';
import {
  claimPlayerName,
  type PlayerRecord,
} from '../leaderboard/player-store';
import { validateUsername } from '../leaderboard/username';
import { readBoundedJson } from '../request-body';
import {
  AGENT_TOKEN_DEFAULT_TTL_MS,
  authorizeAgentCredential,
  deleteAgentCredential,
  extractBearerToken,
  isAgentTokenSecretSet,
  issueAgentToken,
  isValidAgentPlayerKey,
  resolveAgentTokenSecret,
  verifyAgentToken,
} from './';
import { MissingAgentTokenSecretError } from './secret';

const missingSecretResponse = (): Response =>
  jsonError(
    500,
    'server_misconfigured',
    'AGENT_TOKEN_SECRET is not set on this deployment. Contact the operator.',
  );

interface IssueBody {
  playerKey?: unknown;
  agentSecret?: unknown;
  claim?: unknown;
}

const MAX_AGENT_TOKEN_BODY_BYTES = 4 * 1024;

const extractUsername = (claim: unknown): unknown => {
  if (!claim || typeof claim !== 'object') return undefined;
  return (claim as { username?: unknown }).username;
};

const toPublicPlayer = (
  p: PlayerRecord,
): {
  username: string;
  isAgent: boolean;
  rating: number;
  rd: number;
  gamesPlayed: number;
} => ({
  username: p.username,
  isAgent: p.isAgent,
  rating: Math.round(p.rating),
  rd: Math.round(p.rd),
  gamesPlayed: p.gamesPlayed,
});

export const handleAgentTokenIssue = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST on this endpoint.', {
      headers: { Allow: 'POST' },
    });
  }
  // Fail closed when the HMAC secret is missing in production. The dev
  // fallback inside resolveAgentTokenSecret only kicks in under DEV_MODE,
  // so a mis-deployed Worker returns 500 instead of signing with a
  // placeholder readable from the repo.
  if (!isAgentTokenSecretSet(env) && env.DEV_MODE !== '1') {
    return missingSecretResponse();
  }
  const parsed = await readBoundedJson<IssueBody>(
    request,
    MAX_AGENT_TOKEN_BODY_BYTES,
  );
  if (!parsed.ok) {
    const tooLarge = parsed.reason === 'body_too_large';
    return jsonError(
      tooLarge ? 413 : 400,
      parsed.reason,
      tooLarge ? 'Request body is too large.' : 'Invalid JSON body.',
    );
  }
  const body = parsed.value;
  if (!isValidAgentPlayerKey(body.playerKey)) {
    return jsonError(
      400,
      'invalid_player_key',
      'playerKey must match /^agent_[A-Za-z0-9_-]+$/ and be 8-64 chars.',
    );
  }

  if (!env.DB) {
    return jsonError(
      503,
      'identity_store_unavailable',
      'Agent identity registration is unavailable.',
    );
  }

  const rawUsername = extractUsername(body.claim);
  const checkedUsername =
    rawUsername === undefined ? null : validateUsername(rawUsername);
  if (checkedUsername && !checkedUsername.ok) {
    const status = checkedUsername.error === 'reserved' ? 409 : 400;
    return jsonError(
      status,
      `username_${checkedUsername.error}`,
      `Invalid username: ${checkedUsername.error}.`,
    );
  }

  let secret: string;
  try {
    secret = resolveAgentTokenSecret(env);
  } catch (error) {
    if (error instanceof MissingAgentTokenSecretError) {
      return missingSecretResponse();
    }
    throw error;
  }

  const bearer = extractBearerToken(request.headers.get('Authorization'));
  const verifiedBearer = bearer
    ? await verifyAgentToken(bearer, { secret })
    : null;
  const validBearer = Boolean(
    verifiedBearer?.ok && verifiedBearer.payload.playerKey === body.playerKey,
  );
  const credential = await authorizeAgentCredential({
    db: env.DB,
    playerKey: body.playerKey,
    presentedSecret: body.agentSecret,
    validBearer,
  });
  if (!credential.ok) {
    const legacy = credential.reason === 'legacy_upgrade_required';
    return jsonError(
      401,
      credential.reason,
      legacy
        ? 'This existing identity must be upgraded once with its current Bearer token. If it has expired, choose a new playerKey.'
        : 'Supply the agentSecret returned at first registration or a valid Bearer token for this playerKey.',
    );
  }

  let player: PlayerRecord | null = null;
  if (checkedUsername?.ok) {
    const outcome = await claimPlayerName({
      db: env.DB,
      playerKey: body.playerKey,
      username: checkedUsername.normalised,
      isAgent: true,
      now: Date.now(),
      identityKind: isOfficialQuickMatchBotPlayerKey(body.playerKey)
        ? 'official_bot'
        : 'agent',
    });
    if (!outcome.ok) {
      if (credential.created) {
        await deleteAgentCredential(env.DB, body.playerKey);
      }
      return jsonError(409, 'name_taken', 'Callsign is already taken.');
    }
    player = outcome.player;
  }

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
      ...(credential.agentSecret
        ? {
            agentSecret: credential.agentSecret,
            agentSecretUsage:
              'Store this once-disclosed renewal secret outside prompts and source control. Send it as agentSecret when the 24-hour bearer expires.',
          }
        : {}),
      ...(player ? { player: toPublicPlayer(player) } : {}),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};
