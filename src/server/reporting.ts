import type { CreateRateLimiterBinding } from './env';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_REPORT_BODY = 4096;
const RATE_LIMIT_MAP_MAX_KEYS = 1000;

const CREATE_RATE_WINDOW_MS = 60_000;
const CREATE_RATE_LIMIT = 5;

const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_RATE_LIMIT = 120;

const ERROR_REPORT_RATE_WINDOW_MS = 60_000;
const ERROR_REPORT_RATE_LIMIT = 40;

const JOIN_REPLAY_PROBE_WINDOW_MS = 60_000;
const JOIN_REPLAY_PROBE_LIMIT = 100;

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

export const joinReplayProbeRateMap = new Map<
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

export const isJoinReplayProbeRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    joinReplayProbeRateMap,
    ipHash,
    JOIN_REPLAY_PROBE_LIMIT,
    JOIN_REPLAY_PROBE_WINDOW_MS,
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

export const isErrorReportRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    errorReportRateMap,
    ipHash,
    ERROR_REPORT_RATE_LIMIT,
    ERROR_REPORT_RATE_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

export const isTelemetryReportRateLimited = (ipHash: string): boolean =>
  checkWindowedRateLimit(
    telemetryReportRateMap,
    ipHash,
    TELEMETRY_RATE_LIMIT,
    TELEMETRY_RATE_WINDOW_MS,
    RATE_LIMIT_MAP_MAX_KEYS,
  );

export const insertEvent = async (
  db: D1Database,
  payload: Record<string, unknown>,
  ipHash: string,
  ua: string | null,
): Promise<void> => {
  const { event, anonId, ts, ...rest } = payload;

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
        ua,
      )
      .run();
  } catch (err) {
    console.error('[D1 insert failed]', err);
  }
};

export const handleReport = async (
  request: Request,
  logFn: (msg: string, payload: unknown) => void,
  label: string,
): Promise<{ response: Response; payload?: Record<string, unknown> }> => {
  const contentType = request.headers.get('content-type');

  if (!contentType?.includes('application/json')) {
    return {
      response: new Response('Content-Type must be JSON', {
        status: 415,
        headers: corsHeaders,
      }),
    };
  }

  const contentLength = request.headers.get('content-length');

  if (contentLength && parseInt(contentLength, 10) > MAX_REPORT_BODY) {
    return {
      response: new Response('Payload too large', {
        status: 413,
        headers: corsHeaders,
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
        headers: corsHeaders,
      }),
    };
  }

  if (body.length > MAX_REPORT_BODY) {
    return {
      response: new Response('Payload too large', {
        status: 413,
        headers: corsHeaders,
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
        headers: corsHeaders,
      }),
    };
  }

  logFn(`[${label}]`, payload);

  return {
    response: new Response(null, {
      status: 204,
      headers: corsHeaders,
    }),
    payload,
  };
};
