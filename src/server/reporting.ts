import type { CreateRateLimiterBinding } from './env';

// Reporting endpoints (/telemetry, /error) are called by the delta-v
// first-party client only. Cross-origin callers are never expected; a
// permissive wildcard CORS on these routes just gives third-party
// scripts a free channel to wake the rate-limited D1 insert path.
const DEFAULT_ALLOWED_ORIGIN = 'https://delta-v.tre.systems';

export const resolveReportingAllowedOrigin = (request: Request): string => {
  const origin = request.headers.get('Origin');
  if (!origin) return DEFAULT_ALLOWED_ORIGIN;
  // Allow the canonical production origin and localhost for dev /
  // `wrangler dev`. Everything else falls through to the production
  // origin so cross-site scripts get a CORS rejection.
  if (
    origin === DEFAULT_ALLOWED_ORIGIN ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1')
  ) {
    return origin;
  }
  return DEFAULT_ALLOWED_ORIGIN;
};

export const buildReportingCorsHeaders = (
  request: Request,
): Record<string, string> => ({
  'Access-Control-Allow-Origin': resolveReportingAllowedOrigin(request),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
});

// Back-compat export: some legacy call sites still reach for the
// constant headers map. Prefer buildReportingCorsHeaders(request) for
// new code so the Origin reflection stays accurate.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

const MAX_REPORT_BODY = 4096;
const RATE_LIMIT_MAP_MAX_KEYS = 1000;

const CREATE_RATE_WINDOW_MS = 60_000;
const CREATE_RATE_LIMIT = 5;

const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_RATE_LIMIT = 120;

const ERROR_REPORT_RATE_WINDOW_MS = 60_000;
const ERROR_REPORT_RATE_LIMIT = 40;

const JOIN_PROBE_WINDOW_MS = 60_000;
/** Preflight for real joins and quick-match ticket polling (per hashed IP, per isolate). */
const JOIN_PROBE_LIMIT = 100;

const REPLAY_PROBE_WINDOW_MS = 60_000;
/** Replay history probes — separate bucket so replay scraping cannot starve joins. */
const REPLAY_PROBE_LIMIT = 250;

const WS_CONNECT_WINDOW_MS = 60_000;
const WS_CONNECT_LIMIT = 20;

export const createRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const telemetryReportRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const errorReportRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const joinProbeRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const replayProbeRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const wsConnectRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const hashIp = async (ip: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ip),
  );

  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const checkWindowedRateLimit = (
  map: Map<string, { count: number; windowStart: number }>,
  key: string,
  limit: number,
  windowMs: number,
  maxKeys: number,
): boolean => {
  const now = Date.now();

  if (map.size > maxKeys) {
    for (const [currentKey, value] of map) {
      if (now - value.windowStart >= windowMs) {
        map.delete(currentKey);
      }
    }
  }

  const entry = map.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    map.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > limit;
};

export const tooManyRequests = (): Response =>
  new Response('Too many requests', {
    status: 429,
    headers: {
      ...corsHeaders,
      'Retry-After': '60',
    },
  });

export const isCreateRateLimitedInMemory = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    createRateMap,
    ipHash,
    CREATE_RATE_LIMIT,
    CREATE_RATE_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

export const isCreateRateLimited = async (
  env: { CREATE_RATE_LIMITER?: CreateRateLimiterBinding },
  ipHash: string,
): Promise<boolean> => {
  if (env.CREATE_RATE_LIMITER) {
    const result = await env.CREATE_RATE_LIMITER.limit({
      key: `create:${ipHash}`,
    });

    return !result.success;
  }

  return isCreateRateLimitedInMemory(ipHash);
};

export const isJoinProbeRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    joinProbeRateMap,
    ipHash,
    JOIN_PROBE_LIMIT,
    JOIN_PROBE_WINDOW_MS,
    2000,
  );

export const isReplayProbeRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    replayProbeRateMap,
    ipHash,
    REPLAY_PROBE_LIMIT,
    REPLAY_PROBE_WINDOW_MS,
    2000,
  );

export const isWsConnectRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    wsConnectRateMap,
    ipHash,
    WS_CONNECT_LIMIT,
    WS_CONNECT_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

export const isErrorReportRateLimitedInMemory = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    errorReportRateMap,
    ipHash,
    ERROR_REPORT_RATE_LIMIT,
    ERROR_REPORT_RATE_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

export const isTelemetryReportRateLimitedInMemory = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    telemetryReportRateMap,
    ipHash,
    TELEMETRY_RATE_LIMIT,
    TELEMETRY_RATE_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

// Prefer the global [[ratelimits]] namespace when bound. In its absence
// (local dev, test environments, or mis-deployed workers) fall back to
// the per-isolate Map so the endpoint still has some rate protection.
// A distributed attacker cycling POPs previously bypassed the per-
// isolate counter entirely; the binding version enforces the limit
// across isolates.
export const isTelemetryReportRateLimited = async (
  env: { TELEMETRY_RATE_LIMITER?: CreateRateLimiterBinding },
  ipHash: string,
): Promise<boolean> => {
  if (env.TELEMETRY_RATE_LIMITER) {
    const result = await env.TELEMETRY_RATE_LIMITER.limit({
      key: `telemetry:${ipHash}`,
    });
    return !result.success;
  }
  return isTelemetryReportRateLimitedInMemory(ipHash);
};

export const isErrorReportRateLimited = async (
  env: { ERROR_RATE_LIMITER?: CreateRateLimiterBinding },
  ipHash: string,
): Promise<boolean> => {
  if (env.ERROR_RATE_LIMITER) {
    const result = await env.ERROR_RATE_LIMITER.limit({
      key: `error:${ipHash}`,
    });
    return !result.success;
  }
  return isErrorReportRateLimitedInMemory(ipHash);
};

// Hard cap on any single string field we persist. The /error and
// /telemetry bodies already cap at 4 KB total, but individual fields
// (`stack`, `ua`, etc.) can still arrive as multi-KB blobs before we
// serialize them back out; clip them here so a single row can't blow
// past the D1 row-size budget.
const MAX_STRING_FIELD_LEN = 1024;

const clipString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  return value.length > MAX_STRING_FIELD_LEN
    ? value.slice(0, MAX_STRING_FIELD_LEN)
    : value;
};

export const scrubReportPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    scrubbed[key] = clipString(value);
  }
  return scrubbed;
};

export const insertEvent = async (
  db: D1Database,
  payload: Record<string, unknown>,
  ipHash: string,
  ua: string | null,
): Promise<void> => {
  const scrubbed = scrubReportPayload(payload);
  const { event, anonId, ts, ...rest } = scrubbed;

  try {
    await db
      .prepare(
        'INSERT INTO events ' +
          '(ts, anon_id, event, props, ip_hash, ua) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        (ts as number) ?? Date.now(),
        (anonId as string) ?? null,
        (event as string) ?? 'unknown',
        JSON.stringify(rest),
        ipHash,
        clipString(ua) as string | null,
      )
      .run();
  } catch (err) {
    console.error('[D1 insert failed]', err);
  }
};

// Scheduled retention: delete events older than the given window. Driven
// from the Worker's [triggers.crons] handler (or by a manual SQL run
// documented in docs/OBSERVABILITY.md). Returns the number of rows
// removed so the caller can log it.
export const purgeOldEvents = async (
  db: D1Database,
  maxAgeMs: number,
): Promise<number> => {
  const cutoff = Date.now() - maxAgeMs;
  try {
    const result = await db
      .prepare('DELETE FROM events WHERE ts < ?')
      .bind(cutoff)
      .run();
    const meta = (result as { meta?: { changes?: number } }).meta;
    return meta?.changes ?? 0;
  } catch (err) {
    console.error('[D1 purgeOldEvents failed]', err);
    return 0;
  }
};

export const EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const handleReport = async (
  request: Request,
  logFn: (msg: string, payload: unknown) => void,
  label: string,
): Promise<{ response: Response; payload?: Record<string, unknown> }> => {
  const headers = buildReportingCorsHeaders(request);
  const contentType = request.headers.get('content-type');

  if (!contentType?.includes('application/json')) {
    return {
      response: new Response('Content-Type must be JSON', {
        status: 415,
        headers,
      }),
    };
  }

  const contentLength = request.headers.get('content-length');

  if (contentLength && parseInt(contentLength, 10) > MAX_REPORT_BODY) {
    return {
      response: new Response('Payload too large', {
        status: 413,
        headers,
      }),
    };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return {
      response: new Response('Bad request', {
        status: 400,
        headers,
      }),
    };
  }

  if (body.length > MAX_REPORT_BODY) {
    return {
      response: new Response('Payload too large', {
        status: 413,
        headers,
      }),
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      response: new Response('Invalid JSON', {
        status: 400,
        headers,
      }),
    };
  }

  logFn(`[${label}]`, payload);

  return {
    response: new Response(null, {
      status: 204,
      headers,
    }),
    payload,
  };
};
