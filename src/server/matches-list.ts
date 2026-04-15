// Public match-history listing API. Serves `/api/matches` — newest-first
// pagination over the `match_archive` D1 table. Shown in the public
// `/matches` page.
//
// The data surfaced here is intentionally non-identifying: scenario,
// winner, win reason, turn count, timestamps, coached flag. Room codes
// and game ids are included only so the page can construct replay links
// (the existing `/replay/{code}?viewer=spectator` route is already
// publicly accessible with a known code, so exposing codes here does not
// widen any security boundary beyond "replays are discoverable").

import type { Env } from './env';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Shape a single row. Keys are camelCase for the HTTP client; the D1
// columns are snake_case.
export interface MatchListingRow {
  gameId: string;
  roomCode: string;
  scenario: string;
  winner: 0 | 1 | null;
  winReason: string | null;
  turns: number;
  createdAt: number;
  completedAt: number;
  coached: boolean;
}

export interface MatchListingResponse {
  matches: MatchListingRow[];
  limit: number;
  // When truthy, callers can paginate by re-requesting with
  // ?before=<nextBefore>. When null, the end of the history is reached.
  nextBefore: number | null;
}

const parseLimit = (raw: string | null): number => {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const parseBefore = (raw: string | null): number | null => {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

// D1 row shape — reflects the CREATE TABLE in 0002_match_archive.sql
// plus the match_coached column added in 0003_match_archive_listing.sql.
interface MatchArchiveRow {
  game_id: string;
  room_code: string;
  scenario: string;
  winner: number | null;
  win_reason: string | null;
  turns: number;
  created_at: number;
  completed_at: number;
  match_coached: number | null;
}

const toListingRow = (row: MatchArchiveRow): MatchListingRow => ({
  gameId: row.game_id,
  roomCode: row.room_code,
  scenario: row.scenario,
  winner: row.winner === 0 || row.winner === 1 ? row.winner : null,
  winReason: row.win_reason,
  turns: row.turns,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  coached: Boolean(row.match_coached),
});

export const handleMatchesList = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (!env.DB) {
    // Archive is unavailable (e.g. unbound in a test env). Return an empty
    // listing rather than a 500 so the public page renders a clean "no
    // matches yet" state.
    return Response.json({
      matches: [],
      limit: DEFAULT_LIMIT,
      nextBefore: null,
    } satisfies MatchListingResponse);
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const before = parseBefore(url.searchParams.get('before'));

  // Fetch `limit + 1` rows so we can tell whether there's another page
  // without a separate COUNT query.
  const fetchSize = limit + 1;

  const stmt = before
    ? env.DB.prepare(
        'SELECT game_id, room_code, scenario, winner, win_reason, ' +
          'turns, created_at, completed_at, match_coached ' +
          'FROM match_archive ' +
          'WHERE completed_at < ? ' +
          'ORDER BY completed_at DESC ' +
          'LIMIT ?',
      ).bind(before, fetchSize)
    : env.DB.prepare(
        'SELECT game_id, room_code, scenario, winner, win_reason, ' +
          'turns, created_at, completed_at, match_coached ' +
          'FROM match_archive ' +
          'ORDER BY completed_at DESC ' +
          'LIMIT ?',
      ).bind(fetchSize);

  const { results } = await stmt.all<MatchArchiveRow>();
  const rows = (results ?? []).slice(0, limit).map(toListingRow);
  const hasMore = (results?.length ?? 0) > limit;
  const nextBefore = hasMore ? rows[rows.length - 1].completedAt : null;

  return Response.json(
    {
      matches: rows,
      limit,
      nextBefore,
    } satisfies MatchListingResponse,
    {
      headers: {
        // Listings are cheap to regenerate and each entry is immutable
        // (matches don't mutate post-archive). Short browser cache is
        // fine; short CDN cache avoids thundering herd without leaving
        // results stale for long.
        'Cache-Control': 'public, max-age=10, s-maxage=30',
      },
    },
  );
};
