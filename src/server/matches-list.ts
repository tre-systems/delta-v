// Public match-history listing API. Serves `/api/matches` — newest-first
// pagination over the `match_archive` D1 table. Shown in the public
// `/matches` page.
//
// The data surfaced here stays within public discovery boundaries:
// scenario, outcome, turn count, timestamps, replay ids, and public
// callsigns only when a match has leaderboard/rating metadata. Player keys
// are never returned.
//
// Room codes and game ids are included only so the page can construct
// replay links (the existing `/replay/{code}?viewer=spectator` route is
// already publicly accessible with a known code, so exposing codes here
// does not widen any security boundary beyond "replays are discoverable").

import { isValidScenario, type ScenarioKey } from '../shared/map-data';
import type { Env } from './env';
import { type JsonErrorBody, jsonErrorBody } from './json-errors';
import { isReservedTestUsername } from './leaderboard/username';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Shape a single row. Keys are camelCase for the HTTP client; the D1
// columns are snake_case. Callsigns come from the public leaderboard tables
// when a match has rating metadata; player keys are never returned.
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
  officialBotMatch: boolean;
  winnerUsername: string | null;
  loserUsername: string | null;
  playerAUsername: string | null;
  playerBUsername: string | null;
}

export interface MatchListingResponse {
  matches: MatchListingRow[];
  limit: number;
  // When truthy, callers can paginate by re-requesting with
  // ?before=<nextBefore>. When null, the end of the history is reached.
  nextBefore: number | null;
}

type MatchWinnerFilter = 0 | 1 | 'draw';
type MatchStatusFilter = 'archived';
type MatchesQueryError = {
  status: 400;
  body: JsonErrorBody;
};

const isQueryError = (
  value:
    | number
    | MatchStatusFilter
    | MatchWinnerFilter
    | ScenarioKey
    | null
    | MatchesQueryError,
): value is MatchesQueryError =>
  typeof value === 'object' && value !== null && 'status' in value;

const isMatchesQueryError = (
  value:
    | {
        limit: number;
        before: number | null;
        scenario: ScenarioKey | null;
        status: MatchStatusFilter | null;
        winner: MatchWinnerFilter | null;
      }
    | MatchesQueryError,
): value is MatchesQueryError =>
  typeof value === 'object' &&
  value !== null &&
  'body' in value &&
  'status' in value;

const parseLimit = (raw: string | null): number | MatchesQueryError => {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      status: 400,
      body: jsonErrorBody(
        'invalid_query',
        'Invalid limit. Expected a positive integer.',
      ),
    };
  }
  if (parsed > MAX_LIMIT) {
    return {
      status: 400,
      body: jsonErrorBody(
        'invalid_query',
        `Invalid limit: ${raw}. Maximum is ${MAX_LIMIT}.`,
      ),
    };
  }
  return parsed;
};

const parseBefore = (raw: string | null): number | null | MatchesQueryError => {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      status: 400,
      body: jsonErrorBody(
        'invalid_query',
        `Invalid before cursor: ${raw}. Expected a positive integer.`,
      ),
    };
  }
  return parsed;
};

const parseStatus = (
  raw: string | null,
): MatchStatusFilter | null | MatchesQueryError => {
  if (raw === null) return null;
  if (raw === 'archived') return 'archived';
  return {
    status: 400,
    body: jsonErrorBody(
      'invalid_query',
      `Invalid status filter: ${raw}. Expected archived or live.`,
    ),
  };
};

const parseScenario = (
  raw: string | null,
): ScenarioKey | null | MatchesQueryError => {
  if (!raw) return null;
  if (!isValidScenario(raw)) {
    return {
      status: 400,
      body: jsonErrorBody('invalid_query', `Unknown scenario: ${raw}`),
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
    body: jsonErrorBody(
      'invalid_query',
      `Invalid winner filter: ${raw}. Expected 0, 1, or draw.`,
    ),
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
      status: MatchStatusFilter | null;
    }
  | MatchesQueryError => {
  const allowedParams = new Set([
    'before',
    'limit',
    'offset',
    'scenario',
    'status',
    'winner',
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      return {
        status: 400,
        body: jsonErrorBody(
          'invalid_query',
          `Unsupported query parameter: ${key}.`,
        ),
      };
    }
  }

  if (url.searchParams.has('offset')) {
    return {
      status: 400,
      body: jsonErrorBody(
        'invalid_query',
        'Unsupported query parameter: offset. Use before pagination.',
      ),
    };
  }

  const scenario = parseScenario(url.searchParams.get('scenario'));
  if (isQueryError(scenario)) return scenario;

  const winner = parseWinner(url.searchParams.get('winner'));
  if (isQueryError(winner)) return winner;

  const status = parseStatus(url.searchParams.get('status'));
  if (isQueryError(status)) return status;

  const limit = parseLimit(url.searchParams.get('limit'));
  if (isQueryError(limit)) return limit;

  const before = parseBefore(url.searchParams.get('before'));
  if (isQueryError(before)) return before;

  return {
    limit,
    before,
    scenario,
    status,
    winner,
  };
};

// D1 row shape — reflects the CREATE TABLE in 0002_match_archive.sql
// plus later archive flags such as match_coached and official_bot_match.
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
  official_bot_match: number | null;
  winner_username: string | null;
  loser_username: string | null;
  player_a_username: string | null;
  player_b_username: string | null;
}

const publicCallsign = (value: string | null): string | null => {
  if (typeof value !== 'string' || isReservedTestUsername(value)) {
    return null;
  }
  return value;
};

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
  officialBotMatch: Boolean(row.official_bot_match),
  winnerUsername: publicCallsign(row.winner_username),
  loserUsername: publicCallsign(row.loser_username),
  playerAUsername: publicCallsign(row.player_a_username),
  playerBUsername: publicCallsign(row.player_b_username),
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
  if (isMatchesQueryError(filters)) {
    return Response.json(filters.body, { status: filters.status });
  }
  const { limit, before, scenario, status, winner } = filters;
  if (status === 'archived' && url.searchParams.size === 1) {
    // `/api/matches` already defaults to archived history. Accept the
    // explicit alias so callers can be symmetric with `status=live`.
  }

  // Fetch `limit + 1` rows so we can tell whether there's another page
  // without a separate COUNT query.
  const fetchSize = limit + 1;

  // Prefer the immutable snapshot columns added in migration 0007. They
  // are populated at archive time and survive `player` table cleanup. For
  // older archive rows where the snapshot is null, fall back to the
  // legacy `match_rating -> player` joins so historic matches still
  // render. Once the snapshot back-fill / cutover is complete the join
  // path can be retired.
  const SELECT_COLUMNS =
    'ma.game_id, ma.room_code, ma.scenario, ma.winner, ma.win_reason, ' +
    'ma.turns, ma.created_at, ma.completed_at, ma.match_coached, ma.official_bot_match, ' +
    'COALESCE(ma.winner_username, winner_player.username) AS winner_username, ' +
    'COALESCE(' +
    'CASE ma.winner WHEN 0 THEN ma.player_b_username ' +
    'WHEN 1 THEN ma.player_a_username END, ' +
    'loser_player.username) AS loser_username, ' +
    'COALESCE(ma.player_a_username, player_a.username) AS player_a_username, ' +
    'COALESCE(ma.player_b_username, player_b.username) AS player_b_username';
  const JOINS =
    'FROM match_archive ma ' +
    'LEFT JOIN match_rating mr ON mr.game_id = ma.game_id ' +
    'LEFT JOIN player winner_player ON winner_player.player_key = mr.winner_key ' +
    'LEFT JOIN player loser_player ON loser_player.player_key = ' +
    'CASE WHEN mr.winner_key IS NULL THEN NULL ' +
    'WHEN mr.player_a_key = mr.winner_key THEN mr.player_b_key ' +
    'ELSE mr.player_a_key END ' +
    'LEFT JOIN player player_a ON player_a.player_key = mr.player_a_key ' +
    'LEFT JOIN player player_b ON player_b.player_key = mr.player_b_key';

  // Filter out archive rows the writer marked as low-quality / noise.
  // The flag is set by `computeArchiveQuality` in match-archive.ts at
  // archive time; rows from before migration 0008 default to 1, so the
  // filter is safe to apply unconditionally. Operators inspect hidden
  // rows directly via D1 (see Lens 13 in EXPLORATORY_TESTING.md).
  const whereClauses: string[] = ['ma.public_visible = 1'];
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
