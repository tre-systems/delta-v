import type { RoomCode } from '../shared/ids';
import { SCENARIOS } from '../shared/map-data';
import type { Env } from './env';
import {
  generatePlayerToken,
  generateRoomCode,
  parseCreatePayload,
} from './protocol';

const getRoomStub = (
  env: Pick<Env, 'GAME'>,
  code: RoomCode,
): DurableObjectStub => env.GAME.get(env.GAME.idFromName(code));

export const handleWebSocket = (
  request: Request,
  env: Pick<Env, 'GAME'>,
  code: RoomCode,
): Promise<Response> | Response => getRoomStub(env, code).fetch(request);

export const handleJoinCheck = (
  request: Request,
  env: Pick<Env, 'GAME'>,
  code: RoomCode,
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
  code: RoomCode,
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
  const rawBody = await request.text();
  if (rawBody.length === 0) {
    return Response.json(
      { error: 'Create payload must include a scenario' },
      { status: 400 },
    );
  }
  if (rawBody.length > 1024) {
    return Response.json(
      { error: 'Create payload exceeds 1024 bytes' },
      { status: 413 },
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseCreatePayload(payload, Object.keys(SCENARIOS));
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { scenario } = parsed.value;

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
