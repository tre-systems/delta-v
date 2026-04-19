import { asGameId, type RoomCode } from '../shared/ids';
import { SCENARIOS, type ScenarioKey } from '../shared/map-data';
import type { Env } from './env';
import { projectReplayTimeline } from './game-do/archive';
import { fetchArchivedMatch } from './game-do/match-archive';
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
  env: Pick<Env, 'GAME' | 'MATCH_ARCHIVE'>,
  code: RoomCode,
): Promise<Response> | Response => {
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

  return (async (): Promise<Response> => {
    const roomResponse = await getRoomStub(env, code).fetch(
      new Request(internalUrl.toString(), {
        method: 'GET',
      }),
    );

    if (
      roomResponse.status !== 404 ||
      viewer !== 'spectator' ||
      !gameId ||
      !env.MATCH_ARCHIVE
    ) {
      return roomResponse;
    }

    const archivedMatch = await fetchArchivedMatch(
      env.MATCH_ARCHIVE,
      asGameId(gameId),
    );

    if (!archivedMatch) {
      return roomResponse;
    }

    const timeline = projectReplayTimeline(
      archivedMatch.checkpoint,
      archivedMatch.eventStream,
      'spectator',
      archivedMatch.createdAt,
    );

    if (!timeline) {
      return roomResponse;
    }

    return Response.json(timeline, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=3600',
      },
    });
  })();
};

export const handleCreate = async (
  request: Request,
  env: Pick<Env, 'GAME'>,
): Promise<Response> => {
  const invalidRequest = (
    status: number,
    error: string,
    message?: string,
  ): Response =>
    Response.json(
      {
        ok: false,
        error,
        ...(message ? { message } : {}),
      },
      { status },
    );

  const rawBody = await request.text();
  if (rawBody.length === 0) {
    return invalidRequest(
      400,
      'missing_scenario',
      'Create payload must include a scenario.',
    );
  }
  if (rawBody.length > 1024) {
    return invalidRequest(
      413,
      'payload_too_large',
      'Create payload exceeds 1024 bytes.',
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return invalidRequest(400, 'invalid_json', 'Invalid JSON body.');
  }

  const parsed = parseCreatePayload(
    payload,
    Object.keys(SCENARIOS) as ScenarioKey[],
  );
  if (!parsed.ok) {
    return invalidRequest(400, 'invalid_payload', parsed.error);
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
      return invalidRequest(500, 'create_failed', 'Failed to create game.');
    }
  }

  return invalidRequest(
    503,
    'room_code_unavailable',
    'Failed to allocate room code.',
  );
};
