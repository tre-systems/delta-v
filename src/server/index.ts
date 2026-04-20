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
import { handleClaimName } from './leaderboard/claim-route';
import { handlePlayerRank } from './leaderboard/player-rank';
import { handleLeaderboardQuery } from './leaderboard/query-route';
import { handleLiveMatchesList } from './live-matches-list';
import { LiveRegistryDO } from './live-registry-do';
import { handleMatchesList } from './matches-list';
import { MatchmakerDO } from './matchmaker-do';
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
  logSampledOperationalEvent,
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
  const ipHash = await hashIp(
    incoming.headers.get('cf-connecting-ip') ?? 'unknown',
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
        response: Response.json(
          { ok: false, error: 'server_misconfigured' },
          { status: 500 },
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
      response: Response.json(
        { ok: false, error: 'agent_token_required' },
        { status: 403 },
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
      response: Response.json(
        { ok: false, error: 'invalid_agent_token' },
        { status: 401 },
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
  logSampledOperationalEvent,
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

  return (
    isLoopbackAddress(url.hostname) ||
    isLoopbackAddress(request.headers.get('cf-connecting-ip'))
  );
};

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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
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
        );
        const audit = await inspectCreateRequest(request);

        if (
          !isLoopbackRequest(request) &&
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

        const createResponse = await handleCreate(request, env);
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

      if (url.pathname === '/error' && request.method === 'POST') {
        const ipHash = await hashIp(
          request.headers.get('cf-connecting-ip') ?? 'unknown',
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
          const ua =
            (payload.ua as string) ?? request.headers.get('user-agent');
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
        if (!isLoopbackRequest(request)) {
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
          const ipHash = await hashIp(ip);

          if (isWsConnectRateLimited(ipHash)) {
            return tooManyRequests();
          }
        }
        return handleWebSocket(request, env, asRoomCode(wsMatch[1]));
      }

      if (url.pathname === '/api/agent-token') {
        const ipHash = await hashIp(
          request.headers.get('cf-connecting-ip') ?? 'unknown',
        );
        if (!isLoopbackRequest(request)) {
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
          if (
            error === 'Invalid JSON body' ||
            error === 'server_misconfigured'
          ) {
            logSampledOperationalEvent('auth-failure', ipHash, {
              route: '/api/agent-token',
              reason: error === 'Invalid JSON body' ? 'invalid_json' : error,
              status: agentTokenResponse.status,
            });
          }
        }
        return agentTokenResponse;
      }

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

      if (url.pathname === '/mcp') {
        return handleMcpHttpRequest(request, env);
      }

      if (url.pathname === '/api/matches' && request.method === 'GET') {
        if (!isLoopbackRequest(request)) {
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
          const ipHash = await hashIp(ip);
          if (isJoinProbeRateLimited(ipHash)) {
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
        return env.ASSETS.fetch(
          new Request(leaderboardUrl.toString(), request),
        );
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
  },
  // Scheduled retention purge for telemetry rows and archived match
  // storage. Wrangler cron fires the configured schedule (see
  // wrangler.toml [triggers.crons]).
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
  },
};
