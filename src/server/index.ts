import { asRoomCode } from '../shared/ids';
import { handleAgentTokenIssue } from './auth/issue-route';
import type { Env } from './env';
import { GameDO } from './game-do/game-do';
import { handleClaimName } from './leaderboard/claim-route';
import { handleLeaderboardQuery } from './leaderboard/query-route';
import { handleLiveMatchesList } from './live-matches-list';
import { LiveRegistryDO } from './live-registry-do';
import { handleMatchesList } from './matches-list';
import { MatchmakerDO } from './matchmaker-do';
import { handleMcpHttpRequest } from './mcp/handlers';

export type { CreateRateLimiterBinding, Env } from './env';

import {
  corsHeaders,
  handleReport,
  hashIp,
  insertEvent,
  isCreateRateLimited,
  isErrorReportRateLimited,
  isJoinProbeRateLimited,
  isReplayProbeRateLimited,
  isTelemetryReportRateLimited,
  isWsConnectRateLimited,
  tooManyRequests,
} from './reporting';
import {
  handleCreate,
  handleJoinCheck,
  handleReplayFetch,
  handleWebSocket,
} from './room-routes';

export {
  checkWindowedRateLimit,
  createRateMap,
  errorReportRateMap,
  hashIp,
  isCreateRateLimited,
  isCreateRateLimitedInMemory,
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
        headers: corsHeaders,
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

      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(
        new Request('https://matchmaker.internal/enqueue', {
          method: 'POST',
          headers: {
            'Content-Type':
              request.headers.get('content-type') ?? 'application/json',
          },
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
      if (isErrorReportRateLimited(ipHash)) {
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
      if (isTelemetryReportRateLimited(ipHash)) {
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
};
