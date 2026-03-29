import { SCENARIOS } from '../shared/map-data';
import type { Env } from './env';
import {
  generatePlayerToken,
  generateRoomCode,
  parseCreatePayload,
} from './protocol';

const getRoomStub = (env: Pick<Env, 'GAME'>, code: string): DurableObjectStub =>
  env.GAME.get(env.GAME.idFromName(code));

export const handleWebSocket = (
  request: Request,
  env: Pick<Env, 'GAME'>,
  code: string,
): Promise<Response> | Response => getRoomStub(env, code).fetch(request);

export const handleJoinCheck = (
  request: Request,
  env: Pick<Env, 'GAME'>,
  code: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const internalUrl = new URL('https://room.internal/join');
  const playerToken = url.searchParams.get('playerToken');

  if (playerToken) {
    internalUrl.searchParams.set('playerToken', playerToken);
  }

  return getRoomStub(env, code).fetch(
    new Request(internalUrl.toString(), {
      method: 'GET',
    }),
  );
};

export const handleReplayFetch = (
  request: Request,
  env: Pick<Env, 'GAME'>,
  code: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const internalUrl = new URL('https://room.internal/replay');
  const playerToken = url.searchParams.get('playerToken');
  const gameId = url.searchParams.get('gameId');
  const viewer = url.searchParams.get('viewer');

  if (playerToken) {
    internalUrl.searchParams.set('playerToken', playerToken);
  }

  if (gameId) {
    internalUrl.searchParams.set('gameId', gameId);
  }

  if (viewer === 'spectator') {
    internalUrl.searchParams.set('viewer', viewer);
  }

  return getRoomStub(env, code).fetch(
    new Request(internalUrl.toString(), {
      method: 'GET',
    }),
  );
};

export const handleCreate = async (
  request: Request,
  env: Pick<Env, 'GAME'>,
): Promise<Response> => {
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
    const initResponse = await getRoomStub(env, code).fetch(
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
