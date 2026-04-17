// GET /api/leaderboard — public read-only view of the Glicko-2
// leaderboard. Query params:
//   - limit (default 100, max 200): number of rows to return.
//   - includeProvisional (default false): include rows that haven't
//     cleared the provisional gate (see src/shared/rating/provisional.ts).
//
// Response:
//   { entries: [{ username, isAgent, rating, rd, gamesPlayed,
//                 provisional, lastPlayedAt }] }
//
// The D1 read is cached at the edge for 60 s — a brand-new match
// won't appear for up to a minute, which is fine for a public
// ladder and keeps read cost effectively zero under load. Rankings
// change on the minute, not the second.

import { isProvisional } from '../../shared/rating/provisional';
import type { Env } from '../env';

interface PlayerRow {
  username: string;
  is_agent: number;
  rating: number;
  rd: number;
  games_played: number;
  distinct_opponents: number;
  last_match_at: number | null;
}

export interface LeaderboardEntry {
  username: string;
  isAgent: boolean;
  rating: number;
  rd: number;
  gamesPlayed: number;
  provisional: boolean;
  lastPlayedAt: number | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  limit: number;
  includeProvisional: boolean;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const parseLimit = (raw: string | null): number => {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const parseBool = (raw: string | null): boolean =>
  raw === 'true' || raw === '1';

const toEntry = (row: PlayerRow): LeaderboardEntry => {
  const provisional = isProvisional({
    gamesPlayed: row.games_played,
    distinctOpponents: row.distinct_opponents,
    rd: row.rd,
  });
  return {
    username: row.username,
    isAgent: row.is_agent === 1,
    rating: Math.round(row.rating),
    rd: Math.round(row.rd),
    gamesPlayed: row.games_played,
    provisional,
    lastPlayedAt: row.last_match_at,
  };
};

export const handleLeaderboardQuery = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    });
  }

  if (!env.DB) {
    return Response.json(
      {
        entries: [],
        limit: DEFAULT_LIMIT,
        includeProvisional: false,
      } satisfies LeaderboardResponse,
      {
        headers: { 'Cache-Control': 'public, max-age=10, s-maxage=30' },
      },
    );
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const includeProvisional = parseBool(
    url.searchParams.get('includeProvisional'),
  );

  // Fetch up to limit + a margin so we can filter out provisional rows
  // in-app when the caller wants ranked-only. A 3x margin is usually
  // enough for early-beta; if it proves insufficient the query can be
  // split into two passes (ranked-only + optional provisional).
  const fetchSize = includeProvisional ? limit : Math.min(limit * 3, 600);
  const { results } = await env.DB.prepare(
    'SELECT username, is_agent, rating, rd, games_played, ' +
      'distinct_opponents, last_match_at ' +
      'FROM player ORDER BY rating DESC LIMIT ?',
  )
    .bind(fetchSize)
    .all<PlayerRow>();

  const rows = (results ?? []).map(toEntry);
  const filtered = includeProvisional
    ? rows
    : rows.filter((e) => !e.provisional);
  const entries = filtered.slice(0, limit);

  return Response.json(
    {
      entries,
      limit,
      includeProvisional,
    } satisfies LeaderboardResponse,
    {
      headers: {
        // 60s CDN cache + short browser cache so the page stays
        // responsive without hammering D1 on bursty traffic.
        'Cache-Control': 'public, max-age=10, s-maxage=60',
      },
    },
  );
};
