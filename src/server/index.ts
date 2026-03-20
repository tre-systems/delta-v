import { SCENARIOS } from '../shared/map-data';
import { GameDO } from './game-do/game-do';
import {
  generatePlayerToken,
  generateRoomCode,
  parseCreatePayload,
} from './protocol';

export { GameDO };

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
}

const handleWebSocket = (
  request: Request,
  env: Env,
  code: string,
): Promise<Response> => {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);

  return stub.fetch(request);
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
    const inviteToken = generatePlayerToken();
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
          inviteToken,
        }),
      }),
    );

    if (initResponse.ok) {
      return Response.json({
        code,
        playerToken,
        inviteToken,
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
): Promise<Response> => {
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return new Response('Content-Type must be JSON', {
      status: 415,
    });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_REPORT_BODY) {
    return new Response('Payload too large', {
      status: 413,
    });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (body.length > MAX_REPORT_BODY) {
    return new Response('Payload too large', {
      status: 413,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  logFn(`[${label}]`, payload);

  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a new game
    if (url.pathname === '/create' && request.method === 'POST') {
      return handleCreate(request, env);
    }

    // Client error reports
    if (url.pathname === '/error' && request.method === 'POST') {
      return handleReport(request, console.error, 'client-error');
    }

    // Client telemetry events
    if (url.pathname === '/telemetry' && request.method === 'POST') {
      return handleReport(request, console.log, 'telemetry');
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
