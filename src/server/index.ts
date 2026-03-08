import { GameDO } from './game-do';

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

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/1/I to avoid confusion
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const code = generateCode();
  let scenario = 'biplanetary';
  try {
    const body = await request.json() as { scenario?: string };
    if (body.scenario && typeof body.scenario === 'string') {
      scenario = body.scenario;
    }
  } catch {
    // Default scenario if no body
  }
  return Response.json({ code, scenario });
}

async function handleWebSocket(request: Request, env: Env, code: string): Promise<Response> {
  const id = env.GAME.idFromName(code);
  const stub = env.GAME.get(id);
  return stub.fetch(request);
}
