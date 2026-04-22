import { extractBearerToken } from './auth';
import type { Env } from './env';

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 30;

type CountRow = {
  count?: number | string | null;
  matches?: number | string | null;
  games?: number | string | null;
  turns?: number | string | null;
  completed?: number | string | null;
  started?: number | string | null;
  errors?: number | string | null;
  succeeded?: number | string | null;
  failed?: number | string | null;
  averageMs?: number | string | null;
  day?: string | null;
  scenario?: string | null;
  difficulty?: string | null;
};

export interface MetricsResponse {
  generatedAt: number;
  windowDays: number;
  dailyActiveMatches: Array<{ day: string; matches: number }>;
  scenarioPlayMix: Array<{ scenario: string; matches: number }>;
  aiDifficultyDistribution: Array<{ difficulty: string; games: number }>;
  firstTurnCompletion: {
    completed: number;
    started: number;
    rate: number | null;
  };
  wsHealth: {
    errors: number;
    started: number;
    errorRatePerMatch: number | null;
  };
  reconnects: {
    succeeded: number;
    failed: number;
    successRate: number | null;
  };
  averageTurnDurationByScenario: Array<{
    scenario: string;
    averageMs: number;
    turns: number;
  }>;
  officialBot: {
    acceptedFills: number;
    archivedMatches: number;
  };
}

const parsePositiveInteger = (raw: string | null): number | null => {
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const resolveMetricsWindowDays = (
  request: Request,
): { ok: true; value: number } | { ok: false; response: Response } => {
  const url = new URL(request.url);
  const parsed = parsePositiveInteger(url.searchParams.get('days'));
  if (url.searchParams.get('days') !== null && parsed === null) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'invalid_query',
          message: 'Invalid days. Expected a positive integer.',
        },
        { status: 400 },
      ),
    };
  }
  if (parsed !== null && parsed > MAX_WINDOW_DAYS) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'invalid_query',
          message: `Invalid days: ${parsed}. Maximum is ${MAX_WINDOW_DAYS}.`,
        },
        { status: 400 },
      ),
    };
  }
  return {
    ok: true,
    value: parsed ?? DEFAULT_WINDOW_DAYS,
  };
};

const toNumber = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const divide = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

const requireMetricsAuth = (
  request: Request,
  env: Pick<Env, 'INTERNAL_METRICS_TOKEN'>,
  opts?: { loopbackAllowed?: boolean },
): Response | null => {
  if (opts?.loopbackAllowed) {
    return null;
  }
  const expected = env.INTERNAL_METRICS_TOKEN?.trim();
  if (!expected) {
    return Response.json({ error: 'metrics_unavailable' }, { status: 404 });
  }
  const bearer = extractBearerToken(request.headers.get('Authorization'));
  if (!bearer) {
    return Response.json({ error: 'metrics_auth_required' }, { status: 401 });
  }
  if (bearer !== expected) {
    return Response.json({ error: 'invalid_metrics_token' }, { status: 403 });
  }
  return null;
};

const queryAll = async <T extends CountRow>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> => {
  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return result.results ?? [];
};

export const handleMetricsRoute = async (
  request: Request,
  env: Pick<Env, 'DB' | 'INTERNAL_METRICS_TOKEN'>,
  opts?: { loopbackAllowed?: boolean },
): Promise<Response> => {
  const authError = requireMetricsAuth(request, env, opts);
  if (authError) {
    return authError;
  }
  if (!env.DB) {
    return Response.json({ error: 'metrics_unavailable' }, { status: 503 });
  }

  const window = resolveMetricsWindowDays(request);
  if (!window.ok) {
    return window.response;
  }
  const windowDays = window.value;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const [
    dailyActiveMatches,
    scenarioPlayMix,
    aiDifficultyDistribution,
    firstTurnRows,
    wsRows,
    reconnectRows,
    averageTurnDurationByScenario,
    officialBotAcceptedRows,
    officialBotArchivedRows,
  ] = await Promise.all([
    queryAll<{ day?: string | null; matches?: number | string | null }>(
      env.DB,
      "SELECT strftime('%Y-%m-%d', completed_at / 1000, 'unixepoch') AS day, " +
        'COUNT(*) AS matches ' +
        'FROM match_archive WHERE completed_at > ? ' +
        'GROUP BY day ORDER BY day DESC',
      cutoff,
    ),
    queryAll<{ scenario?: string | null; matches?: number | string | null }>(
      env.DB,
      'SELECT scenario, COUNT(*) AS matches ' +
        'FROM match_archive WHERE completed_at > ? ' +
        'GROUP BY scenario ORDER BY matches DESC, scenario ASC',
      cutoff,
    ),
    queryAll<{ difficulty?: string | null; games?: number | string | null }>(
      env.DB,
      "SELECT COALESCE(json_extract(props, '$.difficulty'), 'unknown') AS difficulty, " +
        'COUNT(*) AS games ' +
        "FROM events WHERE event = 'ai_game_started' AND ts > ? " +
        'GROUP BY difficulty ORDER BY games DESC, difficulty ASC',
      cutoff,
    ),
    queryAll<{
      completed?: number | string | null;
      started?: number | string | null;
    }>(
      env.DB,
      'SELECT ' +
        "SUM(CASE WHEN event = 'first_turn_completed' THEN 1 ELSE 0 END) AS completed, " +
        "SUM(CASE WHEN event = 'game_started' THEN 1 ELSE 0 END) AS started " +
        'FROM events ' +
        "WHERE event IN ('first_turn_completed', 'game_started') AND ts > ?",
      cutoff,
    ),
    queryAll<{
      errors?: number | string | null;
      started?: number | string | null;
    }>(
      env.DB,
      'SELECT ' +
        "SUM(CASE WHEN event IN ('ws_connect_error', 'ws_invalid_message') THEN 1 ELSE 0 END) AS errors, " +
        "SUM(CASE WHEN event = 'game_started' THEN 1 ELSE 0 END) AS started " +
        'FROM events ' +
        "WHERE event IN ('ws_connect_error', 'ws_invalid_message', 'game_started') AND ts > ?",
      cutoff,
    ),
    queryAll<{
      succeeded?: number | string | null;
      failed?: number | string | null;
    }>(
      env.DB,
      'SELECT ' +
        "SUM(CASE WHEN event = 'reconnect_succeeded' THEN 1 ELSE 0 END) AS succeeded, " +
        "SUM(CASE WHEN event = 'reconnect_failed' THEN 1 ELSE 0 END) AS failed " +
        'FROM events ' +
        "WHERE event IN ('reconnect_succeeded', 'reconnect_failed') AND ts > ?",
      cutoff,
    ),
    queryAll<{
      scenario?: string | null;
      averageMs?: number | string | null;
      turns?: number | string | null;
    }>(
      env.DB,
      "SELECT COALESCE(json_extract(props, '$.scenario'), 'unknown') AS scenario, " +
        "AVG(CAST(json_extract(props, '$.totalMs') AS REAL)) AS averageMs, " +
        'COUNT(*) AS turns ' +
        "FROM events WHERE event = 'turn_completed' AND ts > ? " +
        'GROUP BY scenario ORDER BY turns DESC, scenario ASC',
      cutoff,
    ),
    queryAll<{ count?: number | string | null }>(
      env.DB,
      'SELECT COUNT(*) AS count FROM events ' +
        "WHERE event = 'matchmaker_official_bot_filled' AND ts > ?",
      cutoff,
    ),
    queryAll<{ count?: number | string | null }>(
      env.DB,
      'SELECT COUNT(*) AS count FROM match_archive ' +
        'WHERE official_bot_match = 1 AND completed_at > ?',
      cutoff,
    ),
  ]);

  const firstTurn = firstTurnRows[0] ?? {};
  const ws = wsRows[0] ?? {};
  const reconnects = reconnectRows[0] ?? {};

  const body: MetricsResponse = {
    generatedAt: Date.now(),
    windowDays,
    dailyActiveMatches: dailyActiveMatches.map((row) => ({
      day: row.day ?? 'unknown',
      matches: toNumber(row.matches),
    })),
    scenarioPlayMix: scenarioPlayMix.map((row) => ({
      scenario: row.scenario ?? 'unknown',
      matches: toNumber(row.matches),
    })),
    aiDifficultyDistribution: aiDifficultyDistribution.map((row) => ({
      difficulty: row.difficulty ?? 'unknown',
      games: toNumber(row.games),
    })),
    firstTurnCompletion: {
      completed: toNumber(firstTurn.completed),
      started: toNumber(firstTurn.started),
      rate: divide(toNumber(firstTurn.completed), toNumber(firstTurn.started)),
    },
    wsHealth: {
      errors: toNumber(ws.errors),
      started: toNumber(ws.started),
      errorRatePerMatch: divide(toNumber(ws.errors), toNumber(ws.started)),
    },
    reconnects: {
      succeeded: toNumber(reconnects.succeeded),
      failed: toNumber(reconnects.failed),
      successRate: divide(
        toNumber(reconnects.succeeded),
        toNumber(reconnects.succeeded) + toNumber(reconnects.failed),
      ),
    },
    averageTurnDurationByScenario: averageTurnDurationByScenario.map((row) => ({
      scenario: row.scenario ?? 'unknown',
      averageMs: Math.round(toNumber(row.averageMs)),
      turns: toNumber(row.turns),
    })),
    officialBot: {
      acceptedFills: toNumber(officialBotAcceptedRows[0]?.count),
      archivedMatches: toNumber(officialBotArchivedRows[0]?.count),
    },
  };

  return Response.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
};
