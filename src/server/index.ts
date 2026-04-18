import { asRoomCode } from '../shared/ids';
import { normalizePlayerKey } from '../shared/player';
import {
  extractBearerToken,
  MissingAgentTokenSecretError,
  resolveAgentTokenSecret,
  verifyAgentToken,
} from './auth';
import { handleAgentTokenIssue } from './auth/issue-route';
import type { Env } from './env';
import { GameDO } from './game-do/game-do';
import { handleClaimName } from './leaderboard/claim-route';
import { handlePlayerRank } from './leaderboard/player-rank';
import { handleLeaderboardQuery } from './leaderboard/query-route';
import { handleLiveMatchesList } from './live-matches-list';
import { LiveRegistryDO } from './live-registry-do';
import { handleMatchesList } from './matches-list';
import { MatchmakerDO } from './matchmaker-do';
import { handleMcpHttpRequest } from './mcp/handlers';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from './quick-match-internal';

export type { CreateRateLimiterBinding, Env } from './env';

import {
  buildReportingCorsHeaders,
  EVENTS_RETENTION_MS,
  handleReport,
  hashIp,
  insertEvent,
  isCreateRateLimited,
  isErrorReportRateLimited,
  isJoinProbeRateLimited,
  isReplayProbeRateLimited,
  isTelemetryReportRateLimited,
  isWsConnectRateLimited,
  purgeOldEvents,
  tooManyRequests,
} from './reporting';
import {
  handleCreate,
  handleJoinCheck,
  handleReplayFetch,
  handleWebSocket,
} from './room-routes';

const buildQuickMatchEnqueueHeaders = async (
  incoming: Request,
  bodyText: string,
  env: Env,
): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response }
> => {
  const contentType =
    incoming.headers.get('content-type') ?? 'application/json';
  const base: Record<string, string> = { 'Content-Type': contentType };

  let parsed: { player?: { playerKey?: unknown } };
  try {
    parsed = JSON.parse(bodyText) as { player?: { playerKey?: unknown } };
  } catch {
    return { ok: true, headers: base };
  }

  const pk = normalizePlayerKey(parsed.player?.playerKey);
  if (!pk?.startsWith('agent_')) {
    return { ok: true, headers: base };
  }

  const bearer = extractBearerToken(incoming.headers.get('Authorization'));
  let secret: string;
  try {
    secret = resolveAgentTokenSecret(env);
  } catch (error) {
    if (error instanceof MissingAgentTokenSecretError) {
      return {
        ok: false,
        response: Response.json(
          { ok: false, error: 'server_misconfigured' },
          { status: 500 },
        ),
      };
    }
    throw error;
  }

  if (!bearer) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: 'agent_token_required' },
        { status: 403 },
      ),
    };
  }

  const verified = await verifyAgentToken(bearer, { secret });
  if (!verified.ok) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: 'invalid_agent_token' },
        { status: 401 },
      ),
    };
  }

  if (verified.payload.playerKey !== pk) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: 'agent_token_player_key_mismatch' },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    headers: { ...base, [QUICK_MATCH_VERIFIED_AGENT_HEADER]: '1' },
  };
};

export {
  checkWindowedRateLimit,
  createRateMap,
  errorReportRateMap,
  hashIp,
  isCreateRateLimited,
  isCreateRateLimitedInMemory,
  isErrorReportRateLimitedInMemory,
  isTelemetryReportRateLimitedInMemory,
  joinProbeRateMap,
  replayProbeRateMap,
  telemetryReportRateMap,
  wsConnectRateMap,
} from './reporting';
export { GameDO, LiveRegistryDO, MatchmakerDO };

const isLoopbackAddress = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  return (
    value === '127.0.0.1' ||
    value === 'localhost' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1'
  );
};

const isLoopbackRequest = (request: Request): boolean => {
  const url = new URL(request.url);

  return (
    isLoopbackAddress(url.hostname) ||
    isLoopbackAddress(request.headers.get('cf-connecting-ip'))
  );
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for reporting endpoints
    if (
      request.method === 'OPTIONS' &&
      (url.pathname === '/error' || url.pathname === '/telemetry')
    ) {
      return new Response(null, {
        status: 204,
        headers: buildReportingCorsHeaders(request),
      });
    }

    // Create a new game
    if (url.pathname === '/create' && request.method === 'POST') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);

        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }
      return handleCreate(request, env);
    }

    if (url.pathname === '/quick-match' && request.method === 'POST') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);

        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }

      const body = await request.text();
      const built = await buildQuickMatchEnqueueHeaders(request, body, env);
      if (!built.ok) {
        return built.response;
      }

      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(
        new Request('https://matchmaker.internal/enqueue', {
          method: 'POST',
          headers: built.headers,
          body,
        }),
      );
    }

    const quickMatchTicketMatch = url.pathname.match(
      /^\/quick-match\/([A-Za-z0-9]+)$/,
    );

    if (quickMatchTicketMatch && request.method === 'GET') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (isJoinProbeRateLimited(ipHash)) {
        return tooManyRequests();
      }

      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(
        new Request(
          `https://matchmaker.internal/ticket/${quickMatchTicketMatch[1]}`,
          {
            method: 'GET',
          },
        ),
      );
    }

    const joinMatch = url.pathname.match(/^\/join\/([A-Z0-9]{5})$/);

    if (joinMatch && request.method === 'GET') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (isJoinProbeRateLimited(ipHash)) {
        return tooManyRequests();
      }
      return handleJoinCheck(request, env, asRoomCode(joinMatch[1]));
    }

    const replayMatch = url.pathname.match(/^\/replay\/([A-Z0-9]{5})$/);

    if (replayMatch && request.method === 'GET') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (isReplayProbeRateLimited(ipHash)) {
        return tooManyRequests();
      }
      return handleReplayFetch(request, env, asRoomCode(replayMatch[1]));
    }

    // Client error reports
    if (url.pathname === '/error' && request.method === 'POST') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (await isErrorReportRateLimited(env, ipHash)) {
        return tooManyRequests();
      }

      const { response, payload } = await handleReport(
        request,
        console.error,
        'client-error',
      );

      if (payload && env.DB) {
        const ua = (payload.ua as string) ?? request.headers.get('user-agent');
        ctx.waitUntil(
          insertEvent(
            env.DB,
            { event: 'client_error', ...payload },
            ipHash,
            ua,
          ),
        );
      }

      return response;
    }

    // Client telemetry events
    if (url.pathname === '/telemetry' && request.method === 'POST') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (await isTelemetryReportRateLimited(env, ipHash)) {
        return tooManyRequests();
      }

      const { response, payload } = await handleReport(
        request,
        console.log,
        'telemetry',
      );

      if (payload && env.DB) {
        const ua = request.headers.get('user-agent');
        ctx.waitUntil(insertEvent(env.DB, payload, ipHash, ua));
      }

      return response;
    }

    // WebSocket upgrade to game DO
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{5})$/);

    if (wsMatch) {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);

        if (isWsConnectRateLimited(ipHash)) {
          return tooManyRequests();
        }
      }
      return handleWebSocket(request, env, asRoomCode(wsMatch[1]));
    }

    // POST /api/agent-token — issue a 24h HMAC-signed agentToken bound to
    // the supplied playerKey. Agents send this as Authorization: Bearer …
    // on /mcp calls so playerKey + per-agent rate limiting work without
    // exposing match credentials in tool arguments.
    if (url.pathname === '/api/agent-token') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);
        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }
      return handleAgentTokenIssue(request, env);
    }

    // POST /api/claim-name — bind a human playerKey to a username
    // for the public leaderboard. Same per-IP rate limiter as /create.
    // Turnstile gating is deferred (see docs/BACKLOG.md Future features).
    if (url.pathname === '/api/claim-name') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);
        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }
      return handleClaimName(request, env);
    }

    // GET /api/leaderboard — public read-only leaderboard. Edge-
    // cached for 60s; rate-limited per IP via the shared join-probe
    // counter to blunt scrapers.
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);
        if (isJoinProbeRateLimited(ipHash)) {
          return tooManyRequests();
        }
      }
      return handleLeaderboardQuery(request, env);
    }

    // GET /api/leaderboard/me?playerKey=... — per-player rank lookup
    // for the home-screen hint. Shares the join-probe rate limiter.
    if (url.pathname === '/api/leaderboard/me' && request.method === 'GET') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);
        if (isJoinProbeRateLimited(ipHash)) {
          return tooManyRequests();
        }
      }
      return handlePlayerRank(request, env);
    }

    // Hosted streamable-HTTP MCP endpoint — POST JSON-RPC, JSON response.
    // No SSE; agents poll via delta_v_wait_for_turn instead.
    if (url.pathname === '/mcp') {
      return handleMcpHttpRequest(request, env);
    }

    // GET /api/matches — public listing of matches. ?status=live returns
    // in-progress matches from the LIVE_REGISTRY DO; default returns
    // completed matches from D1. Rate-limited by IP to blunt scrapers.
    if (url.pathname === '/api/matches' && request.method === 'GET') {
      if (!isLoopbackRequest(request)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip);
        if (isJoinProbeRateLimited(ipHash)) {
          return tooManyRequests();
        }
      }
      if (url.searchParams.get('status') === 'live') {
        return handleLiveMatchesList(env);
      }
      return handleMatchesList(request, env);
    }

    // /.well-known/agent.json — machine-readable agent manifest
    if (url.pathname === '/.well-known/agent.json') {
      const manifestUrl = new URL(request.url);
      manifestUrl.pathname = '/.well-known/agent.json';
      const manifestResponse = await env.ASSETS.fetch(
        new Request(manifestUrl.toString(), request),
      );
      const headers = new Headers(manifestResponse.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('Cache-Control', 'public, max-age=3600');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(manifestResponse.body, {
        status: manifestResponse.status,
        headers,
      });
    }

    // /agents → serve agents.html
    if (url.pathname === '/agents' || url.pathname === '/agents/') {
      const agentsUrl = new URL(request.url);
      agentsUrl.pathname = '/agents.html';
      return env.ASSETS.fetch(new Request(agentsUrl.toString(), request));
    }

    // /matches → serve the public match-history page.
    if (url.pathname === '/matches' || url.pathname === '/matches/') {
      const matchesUrl = new URL(request.url);
      matchesUrl.pathname = '/matches.html';
      return env.ASSETS.fetch(new Request(matchesUrl.toString(), request));
    }

    // /leaderboard → serve the public leaderboard page.
    if (url.pathname === '/leaderboard' || url.pathname === '/leaderboard/') {
      const leaderboardUrl = new URL(request.url);
      leaderboardUrl.pathname = '/leaderboard.html';
      return env.ASSETS.fetch(new Request(leaderboardUrl.toString(), request));
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
  // Scheduled retention purge for telemetry / error rows. Wrangler cron
  // fires the configured schedule (see wrangler.toml [triggers.crons]).
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.DB) return;
    ctx.waitUntil(
      (async () => {
        const removed = await purgeOldEvents(env.DB, EVENTS_RETENTION_MS);
        if (removed > 0) {
          console.log(`[events purge] removed ${removed} rows`);
        }
      })(),
    );
  },
};
