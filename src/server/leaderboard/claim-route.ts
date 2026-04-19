// POST /api/claim-name — Worker route that binds a human playerKey to
// a chosen username for the public leaderboard. Body:
// { playerKey, username }. Response on success: 200
// { ok: true, player: {...} }. A playerKey may rename freely. A
// username already owned by a *different* key returns 409 with no DB
// mutation.
//
// No Turnstile gate in this arc — the rate limiter + uniqueness
// constraint are the floor defences. Turnstile is tracked in
// docs/BACKLOG.md under Future features; the handler is structured so
// a token-verify step can slot in at the top of the pipeline without
// changing the success path.
//
// Rate-limited via the same per-IP CREATE_RATE_LIMITER as /create and
// /api/agent-token — the wiring lives in src/server/index.ts.

import { isValidPlayerKey } from '../../shared/player';
import type { Env } from '../env';
import { claimPlayerName, type PlayerRecord } from './player-store';
import { validateUsername } from './username';

interface ClaimBody {
  playerKey?: unknown;
  username?: unknown;
}

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

export const handleClaimName = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }

  let body: ClaimBody;
  try {
    body = (await request.json()) as ClaimBody;
  } catch {
    return Response.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Human keys use the shared playerKey format but must NOT claim the
  // agent_ prefix — that namespace is reserved for the agent-token
  // flow, which writes is_agent=1. Keeping the split at the route
  // level guarantees the is_agent column matches the identity flow.
  if (!isValidPlayerKey(body.playerKey)) {
    return Response.json(
      {
        ok: false,
        error: 'playerKey must be 8-64 chars, alphanumeric plus _ or -',
      },
      { status: 400 },
    );
  }
  if (body.playerKey.startsWith('agent_')) {
    return Response.json(
      {
        ok: false,
        error:
          'agent_-prefixed playerKeys claim names via POST /api/agent-token',
      },
      { status: 400 },
    );
  }

  const check = validateUsername(body.username);
  if (!check.ok) {
    const status = check.error === 'reserved' ? 409 : 400;
    return Response.json(
      { ok: false, error: `username_${check.error}` },
      { status },
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
    isAgent: false,
    now: Date.now(),
  });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: 'name_taken' }, { status: 409 });
  }

  return Response.json(
    {
      ok: true,
      player: toPublicPlayer(outcome.player),
      renamed: outcome.renamed,
    },
    { status: 200 },
  );
};
