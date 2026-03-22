import { SCENARIOS } from '../shared/map-data';
import { GameDO } from './game-do/game-do';
import {
  generatePlayerToken,
  generateRoomCode,
  parseCreatePayload,
} from './protocol';

export { GameDO };

export interface CreateRateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  DB: D1Database;
  CREATE_RATE_LIMITER?: CreateRateLimiterBinding;
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const handleWebSocket = (
  request: Request,
  env: Env,
  code: string,
): Promise<Response> => {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);

  return stub.fetch(request);
};

const handleJoinCheck = (
  request: Request,
  env: Env,
  code: string,
): Promise<Response> => {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);
  const url = new URL(request.url);
  const internalUrl = new URL('https://room.internal/join');
  const playerToken = url.searchParams.get('playerToken');

  if (playerToken) {
    internalUrl.searchParams.set('playerToken', playerToken);
  }

  return stub.fetch(
    new Request(internalUrl.toString(), {
      method: 'GET',
    }),
  );
};

const handleReplayFetch = (
  request: Request,
  env: Env,
  code: string,
): Promise<Response> => {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);
  const url = new URL(request.url);
  const internalUrl = new URL('https://room.internal/replay');
  const playerToken = url.searchParams.get('playerToken');
  const gameId = url.searchParams.get('gameId');

  if (playerToken) {
    internalUrl.searchParams.set('playerToken', playerToken);
  }

  if (gameId) {
    internalUrl.searchParams.set('gameId', gameId);
  }

  return stub.fetch(
    new Request(internalUrl.toString(), {
      method: 'GET',
    }),
  );
};

const handleCreate = async (request: Request, env: Env): Promise<Response> => {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    // Default scenario if no body.
  }

  const { scenario } = parseCreatePayload(payload, Object.keys(SCENARIOS));

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateRoomCode();
    const playerToken = generatePlayerToken();
    const id = env.GAME.idFromName(code);
    const stub = env.GAME.get(id);

    const initResponse = await stub.fetch(
      new Request('https://room.internal/init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          scenario,
          playerToken,
        }),
      }),
    );

    if (initResponse.ok) {
      return Response.json({
        code,
        playerToken,
      });
    }

    if (initResponse.status !== 409) {
      return new Response('Failed to create game', {
        status: 500,
      });
    }
  }

  return new Response('Failed to allocate room code', {
    status: 503,
  });
};

// Max body size for telemetry/error payloads (4 KB)
const MAX_REPORT_BODY = 4096;

// Hash an IP address to a 16-char hex string.
// One-way — no raw IPs are stored.
export const hashIp = async (ip: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ip),
  );
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// --- /create rate limiter (per-isolate) ---

const CREATE_RATE_WINDOW_MS = 60_000;
const CREATE_RATE_LIMIT = 5;

export const createRateMap = new Map<
  string,
  { count: number; windowStart: number }
>();

export const isCreateRateLimitedInMemory = (ipHash: string): boolean => {
  const now = Date.now();
  if (createRateMap.size > 1000) {
    for (const [key, val] of createRateMap) {
      if (now - val.windowStart >= CREATE_RATE_WINDOW_MS) {
        createRateMap.delete(key);
      }
    }
  }
  const entry = createRateMap.get(ipHash);
  if (!entry || now - entry.windowStart >= CREATE_RATE_WINDOW_MS) {
    createRateMap.set(ipHash, {
      count: 1,
      windowStart: now,
    });
    return false;
  }
  entry.count++;
  return entry.count > CREATE_RATE_LIMIT;
};

export const isCreateRateLimited = async (
  env: Env,
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

// Insert an event row into D1. Fire-and-forget via
// waitUntil — never blocks the response.
const insertEvent = async (
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

// Shared handler for fire-and-forget reporting
// endpoints (/error, /telemetry). Security measures:
// - POST only (enforced by caller)
// - Content-Type must be application/json
// - Body capped at 4 KB to prevent abuse
// - Payload is logged but never echoed back
// - Returns 204 No Content on success
const handleReport = async (
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
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const ipHash = await hashIp(ip);
      if (await isCreateRateLimited(env, ipHash)) {
        return new Response('Too many requests', {
          status: 429,
          headers: { 'Retry-After': '60' },
        });
      }
      return handleCreate(request, env);
    }

    const joinMatch = url.pathname.match(/^\/join\/([A-Z0-9]{5})$/);

    if (joinMatch && request.method === 'GET') {
      return handleJoinCheck(request, env, joinMatch[1]);
    }

    const replayMatch = url.pathname.match(/^\/replay\/([A-Z0-9]{5})$/);

    if (replayMatch && request.method === 'GET') {
      return handleReplayFetch(request, env, replayMatch[1]);
    }

    // Client error reports
    if (url.pathname === '/error' && request.method === 'POST') {
      const { response, payload } = await handleReport(
        request,
        console.error,
        'client-error',
      );

      if (payload && env.DB) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ua = (payload.ua as string) ?? request.headers.get('user-agent');
        ctx.waitUntil(
          insertEvent(
            env.DB,
            { event: 'client_error', ...payload },
            await hashIp(ip),
            ua,
          ),
        );
      }

      return response;
    }

    // Client telemetry events
    if (url.pathname === '/telemetry' && request.method === 'POST') {
      const { response, payload } = await handleReport(
        request,
        console.log,
        'telemetry',
      );

      if (payload && env.DB) {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const ua = request.headers.get('user-agent');
        ctx.waitUntil(insertEvent(env.DB, payload, await hashIp(ip), ua));
      }

      return response;
    }

    // WebSocket upgrade to game DO
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{5})$/);

    if (wsMatch) {
      return handleWebSocket(request, env, wsMatch[1]);
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};
