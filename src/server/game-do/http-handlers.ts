import type { ViewerId } from '../../shared/engine/game-engine';
import type { PlayerToken } from '../../shared/ids';
import { SCENARIOS } from '../../shared/map-data';
import {
  ErrorCode,
  type PlayerId,
  type Result,
} from '../../shared/types/domain';
import {
  createRoomConfig,
  parseInitPayload,
  type RoomConfig,
  type SeatAssignmentDecision,
  type SeatAssignmentInput,
} from '../protocol';
import { getProjectedReplayTimeline, getReplayViewerId } from './archive';

type Storage = DurableObjectStorage;

export interface JoinAttemptSuccess {
  roomConfig: RoomConfig;
  playerId: 0 | 1;
  issueNewToken: boolean;
  disconnectedPlayer: PlayerId | null;
  seatOpen: [boolean, boolean];
}

type JoinSeatStatus = 'host-only' | 'open' | 'full';

const deriveJoinSeatStatus = ({
  playerTokens,
  seatOpen,
}: {
  playerTokens: RoomConfig['playerTokens'];
  seatOpen: JoinAttemptSuccess['seatOpen'];
}): JoinSeatStatus => {
  if (playerTokens[1] === null) {
    return 'host-only';
  }
  return seatOpen.some(Boolean) ? 'open' : 'full';
};

type ResolveJoinDeps = {
  getRoomConfig: () => Promise<RoomConfig | null>;
  isRoomArchived: () => Promise<boolean>;
  getDisconnectedPlayer: () => Promise<PlayerId | null>;
  getSeatOpen: () => [boolean, boolean];
  isValidPlayerToken: (token: string) => token is PlayerToken;
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
): Promise<Result<JoinAttemptSuccess, Response>> => {
  const roomConfig = await deps.getRoomConfig();

  if (!roomConfig) {
    return {
      ok: false,
      error: Response.json(
        { code: ErrorCode.ROOM_NOT_FOUND, message: 'Game not found' },
        { status: 404 },
      ),
    };
  }

  if (
    presentedTokenRaw !== null &&
    !deps.isValidPlayerToken(presentedTokenRaw)
  ) {
    return {
      ok: false,
      error: new Response('Invalid player token', { status: 400 }),
    };
  }

  if (await deps.isRoomArchived()) {
    return {
      ok: false,
      error: Response.json(
        { code: ErrorCode.GAME_COMPLETED, message: 'Game already completed' },
        { status: 410 },
      ),
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
    const code = seatDecision.status === 409 ? ErrorCode.ROOM_FULL : undefined;
    return {
      ok: false,
      error:
        code !== undefined
          ? Response.json(
              { code, message: seatDecision.message },
              { status: seatDecision.status },
            )
          : new Response(seatDecision.message, {
              status: seatDecision.status,
            }),
    };
  }

  return {
    ok: true,
    value: {
      roomConfig,
      playerId: seatDecision.playerId,
      issueNewToken: seatDecision.issueNewToken,
      disconnectedPlayer,
      seatOpen,
    },
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
  ) => Promise<Result<JoinAttemptSuccess, Response>>;
};

export const handleJoinCheckRequest = async (
  deps: HandleJoinCheckDeps,
  request: Request,
): Promise<Response> => {
  const playerToken = new URL(request.url).searchParams.get('playerToken');
  const joinAttempt = await deps.resolveJoinAttempt(playerToken);

  return joinAttempt.ok
    ? Response.json(
        {
          ok: true,
          scenario: joinAttempt.value.roomConfig.scenario,
          seatStatus: deriveJoinSeatStatus({
            playerTokens: joinAttempt.value.roomConfig.playerTokens,
            seatOpen: joinAttempt.value.seatOpen,
          }),
        },
        { status: 200 },
      )
    : joinAttempt.error;
};

type HandleReplayDeps = {
  storage: Storage;
  getRoomConfig: () => Promise<RoomConfig | null>;
  getLatestGameId: () => Promise<import('../../shared/ids').GameId | null>;
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
    (requestUrl.searchParams.get('gameId') as
      | import('../../shared/ids').GameId
      | null) ?? (await deps.getLatestGameId());

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

  // Completed matches are immutable — their projected event stream will
  // never change, so cache them aggressively at the CDN (1 hour) with a
  // short browser cache (1 minute) to avoid repeated projection cost on
  // scraped replays. Mid-match timelines stay uncached; the client
  // re-polls as the game advances.
  const lastEntry = timeline.entries.at(-1);
  const terminal = lastEntry?.message.state.phase === 'gameOver';
  const cacheControl = terminal
    ? 'public, max-age=60, s-maxage=3600'
    : 'no-store';

  return Response.json(timeline, {
    headers: { 'Cache-Control': cacheControl },
  });
};
