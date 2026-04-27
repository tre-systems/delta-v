import { describe, expect, it } from 'vitest';

import { asPlayerToken, asRoomCode } from '../shared/ids';
import {
  createRoomConfig,
  generatePlayerToken,
  generateRoomCode,
  isValidPlayerToken,
  normalizeScenarioKey,
  parseCreatePayload,
  parseInitPayload,
  resolveSeatAssignment,
} from './protocol';

const roomCode = (value = 'ABCDE') => asRoomCode(value);
const playerToken = (value = 'A'.repeat(32)) => asPlayerToken(value);

describe('protocol helpers', () => {
  it('generates 5-character room codes from the allowed alphabet', () => {
    const code = generateRoomCode();

    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('generates unique room codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));

    expect(codes.size).toBeGreaterThan(1);
  });

  it('generates 32-character player tokens', () => {
    expect(generatePlayerToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('generates unique player tokens', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generatePlayerToken()),
    );

    expect(tokens.size).toBeGreaterThan(1);
  });
});

describe('isValidPlayerToken', () => {
  it('accepts valid 32-char tokens', () => {
    expect(isValidPlayerToken('A'.repeat(32))).toBe(true);
    expect(isValidPlayerToken('abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(isValidPlayerToken('ABCDEFGHIJKLMNOPQRSTUVWXYZ_-0123')).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(isValidPlayerToken(null)).toBe(false);
    expect(isValidPlayerToken(undefined)).toBe(false);
    expect(isValidPlayerToken(42)).toBe(false);
    expect(isValidPlayerToken({})).toBe(false);
  });

  it('rejects wrong-length strings', () => {
    expect(isValidPlayerToken('A'.repeat(31))).toBe(false);
    expect(isValidPlayerToken('A'.repeat(33))).toBe(false);
    expect(isValidPlayerToken('')).toBe(false);
  });

  it('rejects strings with invalid characters', () => {
    expect(isValidPlayerToken(`${'A'.repeat(31)}!`)).toBe(false);
    expect(isValidPlayerToken(`${'A'.repeat(31)} `)).toBe(false);
  });
});

describe('normalizeScenarioKey', () => {
  const keys = ['biplanetary', 'duel', 'escape'] as const;

  it('returns known scenarios as-is', () => {
    expect(normalizeScenarioKey('duel', keys)).toBe('duel');
    expect(normalizeScenarioKey('escape', keys)).toBe('escape');
  });

  it('falls back to biplanetary for unknown scenarios', () => {
    expect(normalizeScenarioKey('bogus', keys)).toBe('biplanetary');
  });

  it('falls back to biplanetary for non-string values', () => {
    expect(normalizeScenarioKey(null, keys)).toBe('biplanetary');
    expect(normalizeScenarioKey(undefined, keys)).toBe('biplanetary');
    expect(normalizeScenarioKey(42, keys)).toBe('biplanetary');
    expect(normalizeScenarioKey({}, keys)).toBe('biplanetary');
  });
});

describe('parseCreatePayload', () => {
  const keys = ['biplanetary', 'escape'] as const;

  it('parses valid scenario', () => {
    expect(parseCreatePayload({ scenario: 'escape' }, keys)).toEqual({
      ok: true,
      value: { scenario: 'escape' },
    });
  });

  it('rejects unknown scenarios', () => {
    expect(parseCreatePayload({ scenario: 'fake' }, keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid scenario',
      },
    });
  });

  it('rejects non-object payloads', () => {
    expect(parseCreatePayload(null, keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid create payload',
      },
    });

    expect(parseCreatePayload(undefined, keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid create payload',
      },
    });

    expect(parseCreatePayload('string', keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid create payload',
      },
    });

    expect(parseCreatePayload(42, keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid create payload',
      },
    });
  });

  it('classifies empty objects as missing scenario', () => {
    expect(parseCreatePayload({}, keys)).toEqual({
      ok: false,
      error: {
        code: 'missing_scenario',
        message: 'Create payload must include a scenario.',
      },
    });
  });

  it('rejects arrays and extra fields', () => {
    expect(parseCreatePayload([], keys)).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Invalid create payload',
      },
    });

    expect(
      parseCreatePayload({ scenario: 'escape', extra: true }, keys),
    ).toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Create payload only supports scenario',
      },
    });
  });
});

describe('parseInitPayload', () => {
  const keys = ['biplanetary', 'escape'] as const;

  const validPayload = {
    code: roomCode(),
    scenario: 'escape',
    playerToken: playerToken(),
  };

  it('parses valid init payloads', () => {
    const result = parseInitPayload(validPayload, keys);

    expect(result).toEqual({
      ok: true,
      value: {
        ...validPayload,
        guestPlayerToken: null,
        players: [
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
        ],
      },
    });
  });

  it('rejects non-object payloads', () => {
    expect(parseInitPayload(null, keys)).toEqual({
      ok: false,
      error: 'Invalid init payload',
    });

    expect(parseInitPayload('string', keys)).toEqual({
      ok: false,
      error: 'Invalid init payload',
    });

    expect(parseInitPayload(42, keys)).toEqual({
      ok: false,
      error: 'Invalid init payload',
    });
  });

  it('rejects invalid room codes', () => {
    expect(parseInitPayload({ ...validPayload, code: 'ABCD' }, keys)).toEqual({
      ok: false,
      error: 'Invalid room code',
    });

    expect(parseInitPayload({ ...validPayload, code: 'abcde' }, keys)).toEqual({
      ok: false,
      error: 'Invalid room code',
    });

    expect(parseInitPayload({ ...validPayload, code: 123 }, keys)).toEqual({
      ok: false,
      error: 'Invalid room code',
    });

    expect(parseInitPayload({ ...validPayload, code: 'ABCDEF' }, keys)).toEqual(
      {
        ok: false,
        error: 'Invalid room code',
      },
    );
  });

  it('rejects invalid scenarios', () => {
    expect(
      parseInitPayload({ ...validPayload, scenario: 'bogus' }, keys),
    ).toEqual({
      ok: false,
      error: 'Invalid scenario',
    });

    expect(parseInitPayload({ ...validPayload, scenario: 42 }, keys)).toEqual({
      ok: false,
      error: 'Invalid scenario',
    });
  });

  it('rejects invalid player tokens', () => {
    expect(
      parseInitPayload({ ...validPayload, playerToken: 'bad' }, keys),
    ).toEqual({
      ok: false,
      error: 'Invalid player token',
    });

    expect(
      parseInitPayload({ ...validPayload, playerToken: null }, keys),
    ).toEqual({
      ok: false,
      error: 'Invalid player token',
    });
  });
});

describe('createRoomConfig', () => {
  it('builds room config from init payload', () => {
    expect(
      createRoomConfig({
        code: roomCode(),
        scenario: 'escape',
        playerToken: playerToken(),
        guestPlayerToken: null,
        players: [
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
        ],
      }),
    ).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      players: [
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
      ],
    });
  });
});

describe('seat assignment', () => {
  it('lets the creator reclaim their seat with the issued token', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: playerToken('creator-token'),
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: [playerToken('creator-token'), null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: false,
    });
  });

  it('allows tokenless join for the open guest seat', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: [playerToken('creator-token'), null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: true,
    });
  });

  it('rejects invalid tokens', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: playerToken('bad-token'),
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: [playerToken('creator-token'), null],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });

  it('rejects tokenless reclaim attempts with a consistent full-room message', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: 1,
        seatOpen: [false, true],
        playerTokens: [
          playerToken('creator-token'),
          playerToken('guest-token'),
        ],
      }),
    ).toEqual({
      type: 'reject',
      status: 409,
      message: 'That game is already full',
    });

    expect(
      resolveSeatAssignment({
        presentedToken: playerToken('guest-token'),
        disconnectedPlayer: 1,
        seatOpen: [false, true],
        playerTokens: [
          playerToken('creator-token'),
          playerToken('guest-token'),
        ],
      }),
    ).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: false,
    });
  });

  it('rejects when game is full with no disconnected player', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [false, false],
        playerTokens: [
          playerToken('creator-token'),
          playerToken('guest-token'),
        ],
      }),
    ).toEqual({
      type: 'reject',
      status: 409,
      message: 'That game is already full',
    });
  });

  it('rejects with invalid player token when presenting wrong token to full game', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: playerToken('wrong-token'),
        disconnectedPlayer: null,
        seatOpen: [false, false],
        playerTokens: [
          playerToken('creator-token'),
          playerToken('guest-token'),
        ],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });

  it('uses the same full-room message while a disconnected player owns a seat', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: 1,
        seatOpen: [false, false],
        playerTokens: [
          playerToken('creator-token'),
          playerToken('guest-token'),
        ],
      }),
    ).toEqual({
      type: 'reject',
      status: 409,
      message: 'That game is already full',
    });
  });

  it('allows tokenless join for seats with no token assigned', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: [null as unknown as ReturnType<typeof playerToken>, null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: true,
    });
  });

  it('lets stored player tokens reclaim occupied seats before the old socket closes', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: playerToken('creator-token'),
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: [playerToken('creator-token'), null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: false,
    });
  });
});
