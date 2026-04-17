// POST /api/agent-token — Worker route that issues a new agent
// identity token. Body: { playerKey: "agent_...", claim?: { username } }.
// Response: { token, expiresAt, playerKey, ttlMs, player? }.
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

import type { Env } from '../env';
import {
  claimPlayerName,
  type PlayerRecord,
} from '../leaderboard/player-store';
import { validateUsername } from '../leaderboard/username';
import {
  AGENT_TOKEN_DEFAULT_TTL_MS,
  issueAgentToken,
  isValidAgentPlayerKey,
  resolveAgentTokenSecret,
} from './';

interface IssueBody {
  playerKey?: unknown;
  claim?: unknown;
}

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
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }
  let body: IssueBody;
  try {
    body = (await request.json()) as IssueBody;
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

  let player: PlayerRecord | null = null;
  const rawUsername = extractUsername(body.claim);
  if (rawUsername !== undefined) {
    const check = validateUsername(rawUsername);
    if (!check.ok) {
      return Response.json(
        { ok: false, error: `username_${check.error}` },
        { status: 400 },
      );
    }
    if (!env.DB) {
      return Response.json(
        { ok: false, error: 'leaderboard_unavailable' },
        { status: 503 },
      );
    }
    const outcome = await claimPlayerName({
      db: env.DB,
      playerKey: body.playerKey,
      username: check.normalised,
      isAgent: true,
      now: Date.now(),
    });
    if (!outcome.ok) {
      return Response.json({ ok: false, error: 'name_taken' }, { status: 409 });
    }
    player = outcome.player;
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
      ...(player ? { player: toPublicPlayer(player) } : {}),
    },
    { status: 200 },
  );
};
