// Public match-history listing API. Serves `/api/matches` — newest-first
// pagination over the `match_archive` D1 table. Shown in the public
// `/matches` page.
//
// The data surfaced here is intentionally non-identifying by default:
// scenario, winner, win reason, turn count, timestamps, coached flag.
// Username fields are preserved in the response shape for compatibility,
// but are always null so the public match log does not publish user-chosen
// names independently of the leaderboard.
//
// Room codes and game ids are included only so the page can construct
// replay links (the existing `/replay/{code}?viewer=spectator` route is
// already publicly accessible with a known code, so exposing codes here
// does not widen any security boundary beyond "replays are discoverable").

import { isValidScenario, type ScenarioKey } from '../shared/map-data';
import type { Env } from './env';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Shape a single row. Keys are camelCase for the HTTP client; the D1
// columns are snake_case. Username fields are always null in the public
// match listing.
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

type MatchWinnerFilter = 0 | 1 | 'draw';
type MatchesQueryError = {
  status: 400;
  body: {
    error: 'invalid_query';
    message: string;
  };
};

const isQueryError = (
  value: number | MatchWinnerFilter | ScenarioKey | null | MatchesQueryError,
): value is MatchesQueryError =>
  typeof value === 'object' && value !== null && 'status' in value;

const parseLimit = (raw: string | null): number | MatchesQueryError => {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      status: 400,
      body: {
        error: 'invalid_query',
        message: 'Invalid limit. Expected a positive integer.',
      },
    };
  }
  if (parsed > MAX_LIMIT) {
    return {
      status: 400,
      body: {
        error: 'invalid_query',
        message: `Invalid limit: ${raw}. Maximum is ${MAX_LIMIT}.`,
      },
    };
  }
  return parsed;
};

const parseBefore = (raw: string | null): number | null => {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseScenario = (
  raw: string | null,
): ScenarioKey | null | MatchesQueryError => {
  if (!raw) return null;
  if (!isValidScenario(raw)) {
    return {
      status: 400,
      body: {
        error: 'invalid_query',
        message: `Unknown scenario: ${raw}`,
      },
    };
  }
  return raw;
};

const parseWinner = (
  raw: string | null,
): MatchWinnerFilter | null | MatchesQueryError => {
  if (!raw) return null;
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  if (raw === 'draw') return 'draw';
  return {
    status: 400,
    body: {
      error: 'invalid_query',
      message: `Invalid winner filter: ${raw}. Expected 0, 1, or draw.`,
    },
  };
};

const parseFilters = (
  url: URL,
):
  | {
      limit: number;
      before: number | null;
      scenario: ScenarioKey | null;
      winner: MatchWinnerFilter | null;
    }
  | MatchesQueryError => {
  if (url.searchParams.has('offset')) {
    return {
      status: 400,
      body: {
        error: 'invalid_query',
        message: 'Unsupported query parameter: offset. Use before pagination.',
      },
    };
  }

  const scenario = parseScenario(url.searchParams.get('scenario'));
  if (isQueryError(scenario)) return scenario;

  const winner = parseWinner(url.searchParams.get('winner'));
  if (isQueryError(winner)) return winner;

  const limit = parseLimit(url.searchParams.get('limit'));
  if (isQueryError(limit)) return limit;

  return {
    limit,
    before: parseBefore(url.searchParams.get('before')),
    scenario,
    winner,
  };
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
  winnerUsername: null,
  loserUsername: null,
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
  const filters = parseFilters(url);
  if ('status' in filters) {
    return Response.json(filters.body, { status: filters.status });
  }
  const { limit, before, scenario, winner } = filters;

  // Fetch `limit + 1` rows so we can tell whether there's another page
  // without a separate COUNT query.
  const fetchSize = limit + 1;

  const SELECT_COLUMNS =
    'ma.game_id, ma.room_code, ma.scenario, ma.winner, ma.win_reason, ' +
    'ma.turns, ma.created_at, ma.completed_at, ma.match_coached';
  const JOINS = 'FROM match_archive ma';

  const whereClauses: string[] = [];
  const bindings: unknown[] = [];
  if (before) {
    whereClauses.push('ma.completed_at < ?');
    bindings.push(before);
  }
  if (scenario) {
    whereClauses.push('ma.scenario = ?');
    bindings.push(scenario);
  }
  if (winner === 0 || winner === 1) {
    whereClauses.push('ma.winner = ?');
    bindings.push(winner);
  } else if (winner === 'draw') {
    whereClauses.push('ma.winner IS NULL');
  }

  const whereSql =
    whereClauses.length === 0 ? '' : ` WHERE ${whereClauses.join(' AND ')}`;
  const stmt = env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} ${JOINS}${whereSql} ` +
      'ORDER BY ma.completed_at DESC ' +
      'LIMIT ?',
  ).bind(...bindings, fetchSize);

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
