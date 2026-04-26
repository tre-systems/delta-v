// GET /api/leaderboard/me?playerKey=... — per-player leaderboard
// lookup. Returns the caller's current rating, provisional flag, and
// absolute rank among non-provisional players (null when provisional).
//
// Kept separate from the full leaderboard query so the home screen
// can call it cheaply on page load without paying for a 100-row
// scan. Two D1 reads: one by player_key, one COUNT(*) of players
// above the caller's rating that have also cleared the provisional
// gate. Both hit the `idx_player_rating` index path.

import { isValidPlayerKey } from '../../shared/player';
import {
  isProvisional,
  MAX_RD_FOR_RANKED,
  MIN_DISTINCT_OPPONENTS,
  MIN_GAMES_PLAYED,
} from '../../shared/rating/provisional';
import type { Env } from '../env';
import { jsonError } from '../json-errors';

interface PlayerRow {
  username: string;
  rating: number;
  rd: number;
  games_played: number;
  distinct_opponents: number;
}

export interface PlayerRankResponse {
  username: string;
  rating: number;
  rd: number;
  gamesPlayed: number;
  provisional: boolean;
  rank: number | null;
}

export const handlePlayerRank = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return jsonError(405, 'method_not_allowed', 'Use GET on this endpoint.', {
      headers: { Allow: 'GET' },
    });
  }

  const url = new URL(request.url);
  const playerKey = url.searchParams.get('playerKey');
  if (!isValidPlayerKey(playerKey)) {
    return jsonError(400, 'invalid_player_key', 'Invalid playerKey.');
  }

  if (!env.DB) {
    return jsonError(
      503,
      'leaderboard_unavailable',
      'Leaderboard unavailable.',
    );
  }

  const row = await env.DB.prepare(
    'SELECT username, rating, rd, games_played, distinct_opponents ' +
      'FROM player WHERE player_key = ? LIMIT 1',
  )
    .bind(playerKey)
    .first<PlayerRow>();

  if (!row) {
    return jsonError(404, 'not_found', 'Player not found.');
  }

  const provisional = isProvisional({
    gamesPlayed: row.games_played,
    distinctOpponents: row.distinct_opponents,
    rd: row.rd,
  });

  let rank: number | null = null;
  if (!provisional) {
    // Count ranked players with strictly higher rating. Tie-break
    // by player_key (deterministic) would require pulling the
    // peer's key in; for now ties share a rank, which is fine for
    // a beta ladder.
    const countRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM player ' +
        'WHERE rating > ? AND games_played >= ? ' +
        'AND distinct_opponents >= ? AND rd <= ?',
    )
      .bind(
        row.rating,
        MIN_GAMES_PLAYED,
        MIN_DISTINCT_OPPONENTS,
        MAX_RD_FOR_RANKED,
      )
      .first<{ n: number }>();
    rank = (countRow?.n ?? 0) + 1;
  }

  return Response.json(
    {
      username: row.username,
      rating: Math.round(row.rating),
      rd: Math.round(row.rd),
      gamesPlayed: row.games_played,
      provisional,
      rank,
    } satisfies PlayerRankResponse,
    {
      headers: {
        // Short cache — rank can move as soon as any other match
        // lands. 30s s-maxage keeps repeated hits from the same
        // page session cheap without hiding fresh results for long.
        'Cache-Control': 'public, max-age=5, s-maxage=30',
      },
    },
  );
};
