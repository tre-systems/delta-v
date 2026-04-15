import { asRoomCode } from '../shared/ids';
import type { Env } from './env';
import { GameDO } from './game-do/game-do';
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
  isJoinReplayProbeRateLimited,
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
  joinReplayProbeRateMap,
  telemetryReportRateMap,
  wsConnectRateMap,
} from './reporting';
export { GameDO, MatchmakerDO };

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
      if (isJoinReplayProbeRateLimited(ipHash)) {
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
      if (isJoinReplayProbeRateLimited(ipHash)) {
        return tooManyRequests();
      }
      return handleJoinCheck(request, env, asRoomCode(joinMatch[1]));
    }

    const replayMatch = url.pathname.match(/^\/replay\/([A-Z0-9]{5})$/);

    if (replayMatch && request.method === 'GET') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
      );
      if (isJoinReplayProbeRateLimited(ipHash)) {
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

    // Hosted streamable-HTTP MCP endpoint — POST JSON-RPC, JSON response.
    // No SSE; agents poll via delta_v_wait_for_turn instead.
    if (url.pathname === '/mcp') {
      return handleMcpHttpRequest(request, env);
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

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};
