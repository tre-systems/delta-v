import { handleMcpHttpRequest } from '@delta-v/mcp-adapter';
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
import {
  MATCH_ARCHIVE_RETENTION_MS,
  purgeExpiredMatchArchives,
} from './game-do/match-archive';
import { jsonError } from './json-errors';
import { handleClaimName } from './leaderboard/claim-route';
import { handlePlayerRank } from './leaderboard/player-rank';
import { handleLeaderboardQuery } from './leaderboard/query-route';
import {
  handlePlayerRecoveryIssue,
  handlePlayerRecoveryRestore,
  handlePlayerRecoveryRevoke,
} from './leaderboard/recovery-route';
import { handleLiveMatchesList } from './live-matches-list';
import { LiveRegistryDO } from './live-registry-do';
import { handleMatchesList } from './matches-list';
import { MatchmakerDO } from './matchmaker-do';
import { handleMetricsRoute } from './metrics-route';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from './quick-match-internal';
import {
  applyResponseHeaders,
  buildPublicCorsPreflightResponse,
} from './response-headers';

let workerBootedAt: string | null = null;

const resolveWorkerBootedAt = (): string => {
  if (workerBootedAt === null) {
    workerBootedAt = new Date(Date.now()).toISOString();
  }

  return workerBootedAt;
};

export const __resetWorkerBootedAtForTests = (): void => {
  workerBootedAt = null;
};

export type { CreateRateLimiterBinding, Env } from './env';

import {
  buildReportingCorsHeaders,
  checkWindowedRateLimit,
  EVENTS_RETENTION_MS,
  handleReport,
  hashIp,
  insertEvent,
  isActiveRoomLimited,
  isCreateRateLimited,
  isErrorReportRateLimited,
  isTelemetryReportRateLimited,
  JOIN_PROBE_LIMIT,
  JOIN_PROBE_WINDOW_MS,
  joinProbeRateMap,
  logSampledOperationalEvent,
  purgeOldEvents,
  RATE_LIMIT_MAP_MAX_KEYS,
  REPLAY_PROBE_LIMIT,
  REPLAY_PROBE_WINDOW_MS,
  registerActiveRoom,
  replayProbeRateMap,
  tooManyRequests,
  WS_CONNECT_LIMIT,
  WS_CONNECT_WINDOW_MS,
  wsConnectRateMap,
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
  const ipHash = await hashIp(
    incoming.headers.get('cf-connecting-ip') ?? 'unknown',
    env,
  );

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
      logSampledOperationalEvent('auth-failure', ipHash, {
        route: '/quick-match',
        reason: 'server_misconfigured',
      });
      return {
        ok: false,
        response: jsonError(
          500,
          'server_misconfigured',
          'AGENT_TOKEN_SECRET is not set on this deployment.',
        ),
      };
    }
    throw error;
  }

  if (!bearer) {
    logSampledOperationalEvent('auth-failure', ipHash, {
      route: '/quick-match',
      reason: 'agent_token_required',
      playerKey: pk,
    });
    return {
      ok: false,
      response: jsonError(
        403,
        'agent_token_required',
        'Agent quick-match requests require a Bearer token.',
      ),
    };
  }

  const verified = await verifyAgentToken(bearer, { secret });
  if (!verified.ok) {
    logSampledOperationalEvent('auth-failure', ipHash, {
      route: '/quick-match',
      reason: 'invalid_agent_token',
      detail: verified.reason,
      playerKey: pk,
    });
    return {
      ok: false,
      response: jsonError(
        401,
        'invalid_agent_token',
        'Agent token is invalid or expired.',
      ),
    };
  }

  if (verified.payload.playerKey !== pk) {
    logSampledOperationalEvent('auth-failure', ipHash, {
      route: '/quick-match',
      reason: 'agent_token_player_key_mismatch',
      tokenPlayerKey: verified.payload.playerKey,
      bodyPlayerKey: pk,
    });
    return {
      ok: false,
      response: jsonError(
        403,
        'agent_token_player_key_mismatch',
        'Agent token does not match the requested playerKey.',
      ),
    };
  }

  return {
    ok: true,
    headers: { ...base, [QUICK_MATCH_VERIFIED_AGENT_HEADER]: '1' },
  };
};

export {
  activeRoomMap,
  checkWindowedRateLimit,
  createRateMap,
  errorReportRateMap,
  hashIp,
  isActiveRoomLimited,
  isCreateRateLimited,
  joinProbeRateMap,
  logSampledOperationalEvent,
  registerActiveRoom,
  replayProbeRateMap,
  shouldSampleOperationalLog,
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

  return isLoopbackAddress(url.hostname);
};

const shouldBypassIpRateLimits = (request: Request, env: Env): boolean =>
  env.DEV_MODE === '1' || isLoopbackRequest(request);

const resolveWorkerSha = (env: Env): string | null => {
  const candidate =
    env.CF_VERSION_METADATA?.id ??
    env.CF_PAGES_COMMIT_SHA ??
    env.GIT_COMMIT_SHA;
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveBuildAssetSha = async (
  request: Request,
  env: Env,
): Promise<string | null> => {
  try {
    const assetUrl = new URL('/version.json', request.url);
    const response = await env.ASSETS.fetch(
      new Request(assetUrl.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      assetsHash?: unknown;
      packageVersion?: unknown;
    };
    const candidate =
      typeof payload.assetsHash === 'string' &&
      payload.assetsHash.trim().length > 0
        ? payload.assetsHash
        : typeof payload.packageVersion === 'string' &&
            payload.packageVersion.trim().length > 0
          ? payload.packageVersion
          : null;

    return candidate?.trim() ?? null;
  } catch {
    return null;
  }
};

const readResponseErrorCode = async (
  response: Response,
): Promise<string | null> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
};

const inspectCreateRequest = async (
  request: Request,
): Promise<{ scenario: string | null; payloadBytes: number }> => {
  const rawBody = await request.clone().text();
  if (rawBody.length === 0) {
    return { scenario: null, payloadBytes: 0 };
  }
  try {
    const parsed = JSON.parse(rawBody) as { scenario?: unknown };
    return {
      scenario: typeof parsed.scenario === 'string' ? parsed.scenario : null,
      payloadBytes: rawBody.length,
    };
  } catch {
    return { scenario: null, payloadBytes: rawBody.length };
  }
};

const scheduleServerAuditEvent = (
  ctx: ExecutionContext,
  db: D1Database | undefined,
  ipHash: string,
  ua: string | null,
  payload: Record<string, unknown>,
): void => {
  if (!db) {
    return;
  }
  ctx.waitUntil(insertEvent(db, payload, ipHash, ua));
};

const fetchHandler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  // RFC 9110: HEAD MUST be supported wherever GET is and return the same
  // headers without a body. The route handlers below are GET-only; rather
  // than thread `(method === 'GET' || method === 'HEAD')` through every
  // matcher, re-enter with the request rewritten as GET and strip the
  // body on the way out. CORS preflight on `/api/matches` etc. advertises
  // `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, so before this
  // every HEAD probe collided with the 404 fallback even though the
  // OPTIONS contract said HEAD was supported.
  if (request.method === 'HEAD') {
    const getRequest = new Request(request, { method: 'GET' });
    const headResponse = await fetchHandler(getRequest, env, ctx);
    return new Response(null, {
      status: headResponse.status,
      headers: headResponse.headers,
    });
  }

  const url = new URL(request.url);
  const publicCorsPreflight = buildPublicCorsPreflightResponse(request);
  if (publicCorsPreflight) {
    return applyResponseHeaders(request, publicCorsPreflight);
  }

  const response = await (async (): Promise<Response> => {
    if (
      (url.pathname === '/healthz' ||
        url.pathname === '/health' ||
        url.pathname === '/status') &&
      request.method === 'GET'
    ) {
      const sha =
        resolveWorkerSha(env) ?? (await resolveBuildAssetSha(request, env));
      return Response.json({
        ok: true,
        sha,
        bootedAt: resolveWorkerBootedAt(),
      });
    }

    if (
      request.method === 'OPTIONS' &&
      (url.pathname === '/error' || url.pathname === '/telemetry')
    ) {
      return new Response(null, {
        status: 204,
        headers: buildReportingCorsHeaders(request),
      });
    }

    if (url.pathname === '/create' && request.method === 'POST') {
      const ua = request.headers.get('user-agent');
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
        env,
      );
      const audit = await inspectCreateRequest(request);

      if (
        !shouldBypassIpRateLimits(request, env) &&
        (await isCreateRateLimited(env, ipHash))
      ) {
        logSampledOperationalEvent('rate-limit', ipHash, {
          route: '/create',
          reason: 'create_bucket',
          scenario: audit.scenario,
        });
        scheduleServerAuditEvent(ctx, env.DB, ipHash, ua, {
          event: 'server_create_request',
          route: '/create',
          outcome: 'rate_limited',
          scenario: audit.scenario,
          payloadBytes: audit.payloadBytes,
          status: 429,
        });
        return tooManyRequests();
      }

      if (
        !shouldBypassIpRateLimits(request, env) &&
        isActiveRoomLimited(ipHash)
      ) {
        logSampledOperationalEvent('rate-limit', ipHash, {
          route: '/create',
          reason: 'active_room_cap',
          scenario: audit.scenario,
        });
        scheduleServerAuditEvent(ctx, env.DB, ipHash, ua, {
          event: 'server_create_request',
          route: '/create',
          outcome: 'rate_limited',
          scenario: audit.scenario,
          payloadBytes: audit.payloadBytes,
          status: 429,
        });
        return tooManyRequests();
      }

      const createResponse = await handleCreate(request, env);
      if (!shouldBypassIpRateLimits(request, env) && createResponse.ok) {
        const payload = (await createResponse
          .clone()
          .json()
          .catch(() => null)) as { code?: unknown } | null;
        if (typeof payload?.code === 'string') {
          registerActiveRoom(ipHash, payload.code);
        }
      }
      scheduleServerAuditEvent(ctx, env.DB, ipHash, ua, {
        event: 'server_create_request',
        route: '/create',
        outcome: createResponse.ok ? 'created' : 'rejected',
        scenario: audit.scenario,
        payloadBytes: audit.payloadBytes,
        status: createResponse.status,
        error: await readResponseErrorCode(createResponse),
      });
      return createResponse;
    }

    if (url.pathname === '/quick-match' && request.method === 'POST') {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);

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
        env,
      );
      if (
        checkWindowedRateLimit(
          joinProbeRateMap,
          ipHash,
          JOIN_PROBE_LIMIT,
          JOIN_PROBE_WINDOW_MS,
          2000,
        )
      ) {
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
        env,
      );
      if (
        checkWindowedRateLimit(
          joinProbeRateMap,
          ipHash,
          JOIN_PROBE_LIMIT,
          JOIN_PROBE_WINDOW_MS,
          2000,
        )
      ) {
        return tooManyRequests();
      }
      return handleJoinCheck(request, env, asRoomCode(joinMatch[1]));
    }

    if (url.pathname.startsWith('/join/') && request.method === 'GET') {
      return Response.json(
        {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        },
        { status: 404 },
      );
    }

    const replayMatch = url.pathname.match(/^\/replay\/([A-Z0-9]{5})$/);
    if (replayMatch && request.method === 'GET') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
        env,
      );
      if (
        checkWindowedRateLimit(
          replayProbeRateMap,
          ipHash,
          REPLAY_PROBE_LIMIT,
          REPLAY_PROBE_WINDOW_MS,
          2000,
        )
      ) {
        return tooManyRequests();
      }
      return handleReplayFetch(request, env, asRoomCode(replayMatch[1]));
    }

    if (url.pathname === '/error' && request.method === 'POST') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
        env,
      );
      if (await isErrorReportRateLimited(env, ipHash)) {
        return tooManyRequests();
      }

      const { response: errorResponse, payload } = await handleReport(
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

      return errorResponse;
    }

    if (url.pathname === '/telemetry' && request.method === 'POST') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
        env,
      );
      if (await isTelemetryReportRateLimited(env, ipHash)) {
        return tooManyRequests();
      }

      const { response: telemetryResponse, payload } = await handleReport(
        request,
        console.log,
        'telemetry',
      );

      if (payload && env.DB) {
        const ua = request.headers.get('user-agent');
        ctx.waitUntil(insertEvent(env.DB, payload, ipHash, ua));
      }

      return telemetryResponse;
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{5})$/);
    if (wsMatch) {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);

        if (
          checkWindowedRateLimit(
            wsConnectRateMap,
            ipHash,
            WS_CONNECT_LIMIT,
            WS_CONNECT_WINDOW_MS,
            RATE_LIMIT_MAP_MAX_KEYS,
          )
        ) {
          return tooManyRequests();
        }
      }
      return handleWebSocket(request, env, asRoomCode(wsMatch[1]));
    }

    if (url.pathname === '/api/agent-token') {
      const ipHash = await hashIp(
        request.headers.get('cf-connecting-ip') ?? 'unknown',
        env,
      );
      if (!shouldBypassIpRateLimits(request, env)) {
        if (await isCreateRateLimited(env, ipHash)) {
          logSampledOperationalEvent('auth-failure', ipHash, {
            route: '/api/agent-token',
            reason: 'rate_limited',
          });
          return tooManyRequests();
        }
      }
      const agentTokenResponse = await handleAgentTokenIssue(request, env);
      if (!agentTokenResponse.ok) {
        const error = await readResponseErrorCode(agentTokenResponse);
        if (error === 'invalid_json' || error === 'server_misconfigured') {
          logSampledOperationalEvent('auth-failure', ipHash, {
            route: '/api/agent-token',
            reason: error,
            status: agentTokenResponse.status,
          });
        }
      }
      return agentTokenResponse;
    }

    if (url.pathname === '/api/claim-name') {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);
        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }
      return handleClaimName(request, env);
    }

    if (url.pathname.startsWith('/api/player-recovery/')) {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);
        if (await isCreateRateLimited(env, ipHash)) {
          return tooManyRequests();
        }
      }
      if (url.pathname === '/api/player-recovery/issue') {
        return handlePlayerRecoveryIssue(request, env);
      }
      if (url.pathname === '/api/player-recovery/restore') {
        return handlePlayerRecoveryRestore(request, env);
      }
      if (url.pathname === '/api/player-recovery/revoke') {
        return handlePlayerRecoveryRevoke(request, env);
      }
      return jsonError(
        404,
        'recovery_route_not_found',
        'Recovery route not found.',
      );
    }

    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);
        if (
          checkWindowedRateLimit(
            joinProbeRateMap,
            ipHash,
            JOIN_PROBE_LIMIT,
            JOIN_PROBE_WINDOW_MS,
            2000,
          )
        ) {
          return tooManyRequests();
        }
      }
      return handleLeaderboardQuery(request, env);
    }

    if (url.pathname === '/api/leaderboard/me' && request.method === 'GET') {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);
        if (
          checkWindowedRateLimit(
            joinProbeRateMap,
            ipHash,
            JOIN_PROBE_LIMIT,
            JOIN_PROBE_WINDOW_MS,
            2000,
          )
        ) {
          return tooManyRequests();
        }
      }
      return handlePlayerRank(request, env);
    }

    if (url.pathname === '/api/metrics' && request.method === 'GET') {
      return handleMetricsRoute(request, env, {
        loopbackAllowed: isLoopbackRequest(request),
      });
    }

    if (url.pathname === '/mcp') {
      return handleMcpHttpRequest(request, env);
    }

    if (url.pathname === '/api/matches' && request.method === 'GET') {
      if (!shouldBypassIpRateLimits(request, env)) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ipHash = await hashIp(ip, env);
        if (
          checkWindowedRateLimit(
            joinProbeRateMap,
            ipHash,
            JOIN_PROBE_LIMIT,
            JOIN_PROBE_WINDOW_MS,
            2000,
          )
        ) {
          return tooManyRequests();
        }
      }
      const status = url.searchParams.get('status');
      if (status === 'live') {
        return handleLiveMatchesList(env);
      }
      return handleMatchesList(request, env);
    }

    if (url.pathname === '/.well-known/agent.json') {
      const manifestUrl = new URL(request.url);
      manifestUrl.pathname = '/.well-known/agent.json';
      const manifestResponse = await env.ASSETS.fetch(
        new Request(manifestUrl.toString(), request),
      );
      const headers = new Headers(manifestResponse.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('Cache-Control', 'public, max-age=3600');
      return new Response(manifestResponse.body, {
        status: manifestResponse.status,
        headers,
      });
    }

    if (url.pathname === '/agents' || url.pathname === '/agents/') {
      const agentsUrl = new URL(request.url);
      agentsUrl.pathname = '/agents.html';
      return env.ASSETS.fetch(new Request(agentsUrl.toString(), request));
    }

    if (url.pathname === '/matches' || url.pathname === '/matches/') {
      const matchesUrl = new URL(request.url);
      matchesUrl.pathname = '/matches.html';
      return env.ASSETS.fetch(new Request(matchesUrl.toString(), request));
    }

    if (url.pathname === '/leaderboard' || url.pathname === '/leaderboard/') {
      const leaderboardUrl = new URL(request.url);
      leaderboardUrl.pathname = '/leaderboard.html';
      return env.ASSETS.fetch(new Request(leaderboardUrl.toString(), request));
    }

    if (url.pathname === '/favicon.ico') {
      const faviconUrl = new URL(request.url);
      faviconUrl.pathname = '/favicon.svg';
      return env.ASSETS.fetch(new Request(faviconUrl.toString(), request));
    }

    if (url.pathname === '/apple-touch-icon.png') {
      const touchIconUrl = new URL(request.url);
      touchIconUrl.pathname = '/icons/apple-touch-icon.png';
      return env.ASSETS.fetch(new Request(touchIconUrl.toString(), request));
    }

    return env.ASSETS.fetch(request);
  })();

  return applyResponseHeaders(request, response);
};

// Scheduled retention purge for telemetry rows and archived match
// storage. Wrangler cron fires the configured schedule (see
// wrangler.toml [triggers.crons]).
const scheduledHandler = async (
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> => {
  if (!env.DB) return;
  ctx.waitUntil(
    (async () => {
      const removed = await purgeOldEvents(env.DB, EVENTS_RETENTION_MS);
      if (removed > 0) {
        console.log(`[events purge] removed ${removed} rows`);
      }
      const archives = await purgeExpiredMatchArchives(
        env.DB,
        env.MATCH_ARCHIVE,
        MATCH_ARCHIVE_RETENTION_MS,
      );
      if (archives.deletedRows > 0 || archives.deletedObjects > 0) {
        console.log(
          `[match archive purge] removed ${archives.deletedRows} rows / ${archives.deletedObjects} objects`,
        );
      }
    })(),
  );
};

export default {
  fetch: fetchHandler,
  scheduled: scheduledHandler,
};
