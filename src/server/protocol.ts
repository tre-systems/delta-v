import {
  asPlayerToken,
  asRoomCode,
  isPlayerToken,
  isRoomCode,
  type PlayerToken,
  type RoomCode,
} from '../shared/ids';
import {
  normalizePlayerKey,
  normalizeUsername,
  type PublicPlayerProfile,
} from '../shared/player';
import type { Result } from '../shared/types/domain';
import { isObject, isString } from '../shared/util';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TOKEN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const getRandomInt = (maxExclusive: number): number => {
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const bytes = new Uint32Array(1);
  let value: number;

  do {
    crypto.getRandomValues(bytes);
    value = bytes[0];
  } while (value >= limit);

  return value % maxExclusive;
};

const generateRandomString = (chars: string, length: number): string =>
  Array.from({ length }, () => chars[getRandomInt(chars.length)]).join('');

// 32 code chars ^ 5 = ~33.6M possible codes.
// At 12 retries, collision is negligible until
// ~thousands of concurrent active rooms.
export const generateRoomCode = (): RoomCode =>
  asRoomCode(generateRandomString(CODE_CHARS, 5));

export const generatePlayerToken = (): PlayerToken =>
  asPlayerToken(generateRandomString(TOKEN_CHARS, 32));

export const isValidPlayerToken = (value: unknown): value is PlayerToken =>
  isPlayerToken(value);

export const normalizeScenarioKey = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): string => {
  if (!isString(raw)) {
    return 'biplanetary';
  }

  return knownScenarioKeys.includes(raw) ? raw : 'biplanetary';
};

export const parseCreatePayload = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): { scenario: string } => {
  if (!isObject(raw)) {
    return { scenario: 'biplanetary' };
  }

  return {
    scenario: normalizeScenarioKey(raw.scenario, knownScenarioKeys),
  };
};

export interface InitPayload {
  code: RoomCode;
  scenario: string;
  playerToken: PlayerToken;
  guestPlayerToken: PlayerToken | null;
  players: [RoomPlayerProfile, RoomPlayerProfile];
}

export type RoomParticipantKind = 'human' | 'agent';

export interface RoomPlayerProfile extends PublicPlayerProfile {
  kind: RoomParticipantKind;
}

const DEFAULT_ROOM_PLAYERS: [RoomPlayerProfile, RoomPlayerProfile] = [
  {
    playerKey: 'seat0',
    username: 'Player 1',
    kind: 'human',
  },
  {
    playerKey: 'seat1',
    username: 'Player 2',
    kind: 'human',
  },
];

const normalizeRoomPlayerProfile = (
  raw: unknown,
  fallback: RoomPlayerProfile,
): RoomPlayerProfile => {
  if (!isObject(raw)) {
    return fallback;
  }

  const playerKey = normalizePlayerKey(raw.playerKey) ?? fallback.playerKey;
  const username = normalizeUsername(raw.username) ?? fallback.username;
  const kind: RoomParticipantKind =
    raw.kind === 'agent' || raw.kind === 'human' ? raw.kind : fallback.kind;

  return {
    playerKey,
    username,
    kind,
  };
};

export const parseInitPayload = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): Result<InitPayload> => {
  if (!isObject(raw)) {
    return { ok: false, error: 'Invalid init payload' };
  }

  if (!isRoomCode(raw.code)) {
    return { ok: false, error: 'Invalid room code' };
  }

  if (
    typeof raw.scenario !== 'string' ||
    !knownScenarioKeys.includes(raw.scenario)
  ) {
    return { ok: false, error: 'Invalid scenario' };
  }

  if (!isValidPlayerToken(raw.playerToken)) {
    return { ok: false, error: 'Invalid player token' };
  }

  const guestPlayerToken =
    raw.guestPlayerToken === null || raw.guestPlayerToken === undefined
      ? null
      : isValidPlayerToken(raw.guestPlayerToken)
        ? raw.guestPlayerToken
        : null;

  if (raw.guestPlayerToken !== undefined && guestPlayerToken === null) {
    return { ok: false, error: 'Invalid guest player token' };
  }

  const playersRaw = Array.isArray(raw.players) ? raw.players : null;
  const players: [RoomPlayerProfile, RoomPlayerProfile] = [
    normalizeRoomPlayerProfile(playersRaw?.[0], DEFAULT_ROOM_PLAYERS[0]),
    normalizeRoomPlayerProfile(playersRaw?.[1], DEFAULT_ROOM_PLAYERS[1]),
  ];

  return {
    ok: true,
    value: {
      code: raw.code,
      scenario: raw.scenario,
      playerToken: raw.playerToken,
      guestPlayerToken,
      players,
    },
  };
};

export interface RoomConfig {
  code: RoomCode;
  scenario: string;
  playerTokens: [PlayerToken, PlayerToken | null];
  players: [RoomPlayerProfile, RoomPlayerProfile];
}

export const createRoomConfig = ({
  code,
  scenario,
  playerToken,
  guestPlayerToken,
  players,
}: InitPayload): RoomConfig => ({
  code,
  scenario,
  playerTokens: [playerToken, guestPlayerToken],
  players,
});

export interface SeatAssignmentInput {
  presentedToken: PlayerToken | null;
  disconnectedPlayer: number | null;
  seatOpen: [boolean, boolean];
  playerTokens: [PlayerToken, PlayerToken | null];
}

export type SeatAssignmentDecision =
  | {
      type: 'join';
      playerId: 0 | 1;
      issueNewToken: boolean;
    }
  | {
      type: 'reject';
      status: number;
      message: string;
    };

export const resolveSeatAssignment = (
  input: SeatAssignmentInput,
): SeatAssignmentDecision => {
  const { presentedToken, seatOpen, playerTokens } = input;

  const seats = [0, 1] as const;

  // Stored player tokens reclaim by player identity,
  // even if the old socket has not closed yet.
  const tokenMatch = seats.find(
    (p) => playerTokens[p] && presentedToken === playerTokens[p],
  );

  if (tokenMatch !== undefined) {
    return {
      type: 'join',
      playerId: tokenMatch,
      issueNewToken: false,
    };
  }

  if (presentedToken) {
    return {
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    };
  }

  // Tokenless join: anyone with the room code can
  // claim an unclaimed open seat.
  const openSeat = seats.find((p) => seatOpen[p] && playerTokens[p] === null);

  if (openSeat !== undefined) {
    return {
      type: 'join',
      playerId: openSeat,
      issueNewToken: true,
    };
  }

  return {
    type: 'reject',
    status: 409,
    message: 'Game is full',
  };
};
