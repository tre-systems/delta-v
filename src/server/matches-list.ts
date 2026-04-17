// Public match-history listing API. Serves `/api/matches` — newest-first
// pagination over the `match_archive` D1 table. Shown in the public
// `/matches` page.
//
// The data surfaced here is intentionally non-identifying by default:
// scenario, winner, win reason, turn count, timestamps, coached flag.
// When both players of a matchmaker-paired game have claimed public
// usernames, those names are joined in via match_rating (both players
// opted into a public ranking by claiming). Private-room matches and
// unclaimed players leave the username fields null.
//
// Room codes and game ids are included only so the page can construct
// replay links (the existing `/replay/{code}?viewer=spectator` route is
// already publicly accessible with a known code, so exposing codes here
// does not widen any security boundary beyond "replays are discoverable").

import type { Env } from './env';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Shape a single row. Keys are camelCase for the HTTP client; the D1
// columns are snake_case. Username fields are null unless both players
// claimed public usernames AND the match was matchmaker-paired (a
// match_rating row exists).
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
  winnerUsername: string | null;
  loserUsername: string | null;
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
// plus the match_coached column added in 0003_match_archive_listing.sql,
// plus the LEFT JOIN on match_rating + player added for username fields.
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
  winner_username: string | null;
  loser_username: string | null;
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
  winnerUsername: row.winner_username ?? null,
  loserUsername: row.loser_username ?? null,
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

  // LEFT JOIN match_rating + player twice so private rooms and
  // unclaimed players surface as NULL usernames. The CASE expressions
  // map the match's winner_key onto the canonically-ordered
  // player_a/player_b pair so the client sees "winner vs loser"
  // directly without another lookup.
  const SELECT_COLUMNS =
    'ma.game_id, ma.room_code, ma.scenario, ma.winner, ma.win_reason, ' +
    'ma.turns, ma.created_at, ma.completed_at, ma.match_coached, ' +
    'CASE ' +
    '  WHEN mr.winner_key IS NULL THEN NULL ' +
    '  WHEN mr.winner_key = mr.player_a_key THEN pa.username ' +
    '  ELSE pb.username ' +
    'END AS winner_username, ' +
    'CASE ' +
    '  WHEN mr.winner_key IS NULL THEN NULL ' +
    '  WHEN mr.winner_key = mr.player_a_key THEN pb.username ' +
    '  ELSE pa.username ' +
    'END AS loser_username';
  const JOINS =
    'FROM match_archive ma ' +
    'LEFT JOIN match_rating mr ON mr.game_id = ma.game_id ' +
    'LEFT JOIN player pa ON pa.player_key = mr.player_a_key ' +
    'LEFT JOIN player pb ON pb.player_key = mr.player_b_key';

  const stmt = before
    ? env.DB.prepare(
        `SELECT ${SELECT_COLUMNS} ${JOINS} ` +
          'WHERE ma.completed_at < ? ' +
          'ORDER BY ma.completed_at DESC ' +
          'LIMIT ?',
      ).bind(before, fetchSize)
    : env.DB.prepare(
        `SELECT ${SELECT_COLUMNS} ${JOINS} ` +
          'ORDER BY ma.completed_at DESC ' +
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
