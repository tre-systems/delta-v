const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TOKEN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

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
export const generateRoomCode = (): string =>
  generateRandomString(CODE_CHARS, 5);

export const generatePlayerToken = (): string =>
  generateRandomString(TOKEN_CHARS, 32);

export const isValidPlayerToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);

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
  code: string;
  scenario: string;
  playerToken: string;
}

export const parseInitPayload = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): { ok: true; value: InitPayload } | { ok: false; error: string } => {
  if (!isObject(raw)) {
    return { ok: false, error: 'Invalid init payload' };
  }

  if (typeof raw.code !== 'string' || !/^[A-Z0-9]{5}$/.test(raw.code)) {
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

  return {
    ok: true,
    value: {
      code: raw.code,
      scenario: raw.scenario,
      playerToken: raw.playerToken,
    },
  };
};

export interface RoomConfig {
  code: string;
  scenario: string;
  playerTokens: [string, string | null];
}

export const createRoomConfig = ({
  code,
  scenario,
  playerToken,
}: InitPayload): RoomConfig => ({
  code,
  scenario,
  playerTokens: [playerToken, null],
});

export interface SeatAssignmentInput {
  presentedToken: string | null;
  disconnectedPlayer: number | null;
  seatOpen: [boolean, boolean];
  playerTokens: [string, string | null];
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

  // Once both seats are claimed, tokenless joins should
  // get a stable "room unavailable" answer instead of
  // leaking transient reconnect state.
  if (seatOpen.some(Boolean) || input.disconnectedPlayer !== null) {
    return {
      type: 'reject',
      status: 409,
      message: 'Game is full',
    };
  }

  return {
    type: 'reject',
    status: 409,
    message: 'Game is full',
  };
};
