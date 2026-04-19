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

type LeaderboardQueryError = {
  status: 400;
  body: {
    error: 'invalid_query';
    message: string;
  };
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const RESERVED_TEST_USERNAME_PREFIXES = ['bot_', 'probe_', 'qa_'];

const error = (message: string): LeaderboardQueryError => ({
  status: 400,
  body: {
    error: 'invalid_query',
    message,
  },
});

const parseLimit = (raw: string | null): number | LeaderboardQueryError => {
  if (!raw) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) {
    return error(
      `Invalid limit: ${raw}. Expected an integer between 1 and ${MAX_LIMIT}.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_LIMIT) {
    return error(
      `Invalid limit: ${raw}. Expected an integer between 1 and ${MAX_LIMIT}.`,
    );
  }
  return parsed;
};

const parseBool = (raw: string | null): boolean | LeaderboardQueryError => {
  if (raw === null) return false;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return error(
    `Invalid includeProvisional value: ${raw}. Expected true or false.`,
  );
};

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

const isReservedTestUsername = (username: string): boolean => {
  const lowered = username.toLowerCase();
  return RESERVED_TEST_USERNAME_PREFIXES.some((prefix) =>
    lowered.startsWith(prefix),
  );
};

// Canonical cache URL for this request: strip every query param except
// `limit` and `includeProvisional`, and always serialise them in a
// fixed order so `?foo=bar&limit=50` and `?limit=50` both hit the same
// cache entry. Without this, a scraper can inflate D1 read cost by
// appending random params (`?cb=…`) that Cloudflare treats as a new
// cache key.
const buildCanonicalCacheUrl = (
  request: Request,
  limit: number,
  includeProvisional: boolean,
): string => {
  const url = new URL(request.url);
  const canonical = new URL(url.origin + url.pathname);
  canonical.searchParams.set('limit', String(limit));
  canonical.searchParams.set(
    'includeProvisional',
    includeProvisional ? 'true' : 'false',
  );
  return canonical.toString();
};

const buildLeaderboardResponse = async (
  env: Env,
  limit: number,
  includeProvisional: boolean,
): Promise<Response> => {
  if (!env.DB) {
    return Response.json(
      {
        entries: [],
        limit,
        includeProvisional,
      } satisfies LeaderboardResponse,
      {
        headers: { 'Cache-Control': 'public, max-age=10, s-maxage=30' },
      },
    );
  }

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

  const rows = (results ?? [])
    .filter((row) => !isReservedTestUsername(row.username))
    .map(toEntry);
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

export const handleLeaderboardQuery = async (
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    });
  }

  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== 'limit' && key !== 'includeProvisional') {
      return Response.json(error(`Unsupported query parameter: ${key}`).body, {
        status: 400,
      });
    }
  }

  const limit = parseLimit(url.searchParams.get('limit'));
  if (typeof limit !== 'number') {
    return Response.json(limit.body, { status: limit.status });
  }
  const includeProvisional = parseBool(
    url.searchParams.get('includeProvisional'),
  );
  if (typeof includeProvisional !== 'boolean') {
    return Response.json(includeProvisional.body, {
      status: includeProvisional.status,
    });
  }

  // Workers runtime exposes `caches.default`; the Node-based vitest env
  // does not. When the global is absent we fall back to the raw D1 path
  // so the edge-cache canonicalisation is a production-only optimisation
  // without dragging in a test-only shim.
  const cachesGlobal = (
    globalThis as {
      caches?: { default?: Cache };
    }
  ).caches;
  const cache = cachesGlobal?.default ?? null;

  if (cache) {
    const cacheUrl = buildCanonicalCacheUrl(request, limit, includeProvisional);
    const cacheKey = new Request(cacheUrl, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const response = await buildLeaderboardResponse(
      env,
      limit,
      includeProvisional,
    );
    // Store the response against the canonical key so random-suffix
    // scrapes (?cb=…) collapse onto the same entry. Clone because
    // `put` drains the body.
    if (response.status === 200) {
      const cachePut = cache.put(cacheKey, response.clone());
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cachePut);
      } else {
        void cachePut.catch(() => {});
      }
    }
    return response;
  }

  return buildLeaderboardResponse(env, limit, includeProvisional);
};
