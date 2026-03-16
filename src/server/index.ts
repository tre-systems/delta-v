import { GameDO } from './game-do';
import { generatePlayerToken, generateRoomCode, parseCreatePayload } from './protocol';
import { SCENARIOS } from '../shared/map-data';

export { GameDO };

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a new game
    if (url.pathname === '/create' && request.method === 'POST') {
      return handleCreate(request, env);
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

async function handleCreate(request: Request, env: Env): Promise<Response> {
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
    const initResponse = await stub.fetch(new Request('https://room.internal/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, scenario, playerToken }),
    }));

    if (initResponse.ok) {
      return Response.json({ code, playerToken });
    }

    if (initResponse.status !== 409) {
      return new Response('Failed to create game', { status: 500 });
    }
  }

  return new Response('Failed to allocate room code', { status: 503 });
}

async function handleWebSocket(request: Request, env: Env, code: string): Promise<Response> {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);
  return stub.fetch(request);
}
