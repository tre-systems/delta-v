import type { ViewerId } from '../../shared/engine/game-engine';
import { SCENARIOS } from '../../shared/map-data';
import {
  createRoomConfig,
  parseInitPayload,
  type RoomConfig,
  type SeatAssignmentDecision,
  type SeatAssignmentInput,
} from '../protocol';
import { getProjectedReplayTimeline, getReplayViewerId } from './archive';

type Storage = DurableObjectStorage;

type ResolveJoinAttemptResult =
  | {
      ok: false;
      response: Response;
    }
  | {
      ok: true;
      roomConfig: RoomConfig;
      playerId: 0 | 1;
      issueNewToken: boolean;
      disconnectedPlayer: number | null;
      seatOpen: [boolean, boolean];
    };

type ResolveJoinDeps = {
  getRoomConfig: () => Promise<RoomConfig | null>;
  isRoomArchived: () => Promise<boolean>;
  getDisconnectedPlayer: () => Promise<number | null>;
  getSeatOpen: () => [boolean, boolean];
  isValidPlayerToken: (token: string) => boolean;
  resolveSeatAssignment: (input: {
    presentedToken: SeatAssignmentInput['presentedToken'];
    disconnectedPlayer: SeatAssignmentInput['disconnectedPlayer'];
    seatOpen: SeatAssignmentInput['seatOpen'];
    playerTokens: SeatAssignmentInput['playerTokens'];
  }) => SeatAssignmentDecision;
};

export const resolveJoinAttempt = async (
  deps: ResolveJoinDeps,
  presentedTokenRaw: string | null,
): Promise<ResolveJoinAttemptResult> => {
  const roomConfig = await deps.getRoomConfig();

  if (!roomConfig) {
    return {
      ok: false,
      response: new Response('Game not found', {
        status: 404,
      }),
    };
  }

  if (
    presentedTokenRaw !== null &&
    !deps.isValidPlayerToken(presentedTokenRaw)
  ) {
    return {
      ok: false,
      response: new Response('Invalid player token', {
        status: 400,
      }),
    };
  }

  if (await deps.isRoomArchived()) {
    return {
      ok: false,
      response: new Response('Game archived', {
        status: 410,
      }),
    };
  }

  const disconnectedPlayer = await deps.getDisconnectedPlayer();
  const seatOpen = deps.getSeatOpen();
  const seatDecision = deps.resolveSeatAssignment({
    presentedToken: presentedTokenRaw,
    disconnectedPlayer,
    seatOpen,
    playerTokens: roomConfig.playerTokens,
  });

  if (seatDecision.type === 'reject') {
    return {
      ok: false,
      response: new Response(seatDecision.message, {
        status: seatDecision.status,
      }),
    };
  }

  return {
    ok: true,
    roomConfig,
    playerId: seatDecision.playerId,
    issueNewToken: seatDecision.issueNewToken,
    disconnectedPlayer,
    seatOpen,
  };
};

type HandleInitDeps = {
  getRoomConfig: () => Promise<RoomConfig | null>;
  saveRoomConfig: (config: RoomConfig) => Promise<void>;
  setGameCode: (code: string) => Promise<void>;
  touchInactivity: () => Promise<void>;
};

export const handleInitRequest = async (
  deps: HandleInitDeps,
  request: Request,
): Promise<Response> => {
  const existing = await deps.getRoomConfig();

  if (existing) {
    return new Response('Room already initialized', {
      status: 409,
    });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid init payload', {
      status: 400,
    });
  }

  const parsed = parseInitPayload(payload, Object.keys(SCENARIOS));

  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400 });
  }

  const roomConfig = createRoomConfig(parsed.value);
  await deps.saveRoomConfig(roomConfig);
  await deps.setGameCode(roomConfig.code);
  await deps.touchInactivity();

  return Response.json({ ok: true }, { status: 201 });
};

type HandleJoinCheckDeps = {
  resolveJoinAttempt: (
    playerToken: string | null,
  ) => Promise<ResolveJoinAttemptResult>;
};

export const handleJoinCheckRequest = async (
  deps: HandleJoinCheckDeps,
  request: Request,
): Promise<Response> => {
  const playerToken = new URL(request.url).searchParams.get('playerToken');
  const joinAttempt = await deps.resolveJoinAttempt(playerToken);

  return joinAttempt.ok
    ? Response.json({ ok: true }, { status: 200 })
    : joinAttempt.response;
};

type HandleReplayDeps = {
  storage: Storage;
  getRoomConfig: () => Promise<RoomConfig | null>;
  getLatestGameId: () => Promise<string | null>;
  touchInactivity: () => Promise<void>;
};

const resolveReplayViewer = (
  roomConfig: RoomConfig,
  requestUrl: URL,
): ViewerId | null =>
  getReplayViewerId(
    roomConfig,
    requestUrl.searchParams.get('playerToken'),
    requestUrl.searchParams.get('viewer'),
  );

export const handleReplayRequest = async (
  deps: HandleReplayDeps,
  request: Request,
): Promise<Response> => {
  const roomConfig = await deps.getRoomConfig();

  if (!roomConfig) {
    return new Response('Game not found', {
      status: 404,
    });
  }

  const requestUrl = new URL(request.url);
  const viewerId = resolveReplayViewer(roomConfig, requestUrl);

  if (viewerId === null) {
    return new Response('Invalid player token', {
      status: 403,
    });
  }

  const gameId =
    requestUrl.searchParams.get('gameId') ?? (await deps.getLatestGameId());

  if (!gameId) {
    return new Response('Replay not found', {
      status: 404,
    });
  }

  const timeline = await getProjectedReplayTimeline(
    deps.storage,
    gameId,
    viewerId,
  );

  if (!timeline) {
    return new Response('Replay not found', {
      status: 404,
    });
  }

  await deps.touchInactivity();

  return Response.json(timeline);
};
