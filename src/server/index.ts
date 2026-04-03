import { asRoomCode } from '../shared/ids';
import type { Env } from './env';
import { GameDO } from './game-do/game-do';

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
export { GameDO };

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

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};
