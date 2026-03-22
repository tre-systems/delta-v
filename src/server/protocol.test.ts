import { describe, expect, it } from 'vitest';

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
      scenario: 'escape',
    });
  });

  it('defaults unknown scenario to biplanetary', () => {
    expect(parseCreatePayload({ scenario: 'fake' }, keys)).toEqual({
      scenario: 'biplanetary',
    });
  });

  it('defaults non-object payloads to biplanetary', () => {
    expect(parseCreatePayload(null, keys)).toEqual({
      scenario: 'biplanetary',
    });

    expect(parseCreatePayload(undefined, keys)).toEqual({
      scenario: 'biplanetary',
    });

    expect(parseCreatePayload('string', keys)).toEqual({
      scenario: 'biplanetary',
    });

    expect(parseCreatePayload(42, keys)).toEqual({
      scenario: 'biplanetary',
    });
  });

  it('defaults arrays to biplanetary (arrays are not plain objects)', () => {
    expect(parseCreatePayload([], keys)).toEqual({
      scenario: 'biplanetary',
    });
  });
});

describe('parseInitPayload', () => {
  const keys = ['biplanetary', 'escape'] as const;

  const validPayload = {
    code: 'ABCDE',
    scenario: 'escape',
    playerToken: 'A'.repeat(32),
    inviteToken: 'B'.repeat(32),
  };

  it('parses valid init payloads', () => {
    const result = parseInitPayload(validPayload, keys);

    expect(result).toEqual({ ok: true, value: validPayload });
  });

  it('parses payloads without invite token', () => {
    const { inviteToken: _, ...noInvite } = validPayload;
    const result = parseInitPayload(noInvite, keys);

    expect(result).toEqual({
      ok: true,
      value: { ...noInvite, inviteToken: null },
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

  it('treats invalid or missing invite tokens as null', () => {
    const badResult = parseInitPayload(
      { ...validPayload, inviteToken: 'bad' },
      keys,
    );

    expect(badResult).toEqual({
      ok: true,
      value: { ...validPayload, inviteToken: null },
    });

    const nullResult = parseInitPayload(
      { ...validPayload, inviteToken: null },
      keys,
    );

    expect(nullResult).toEqual({
      ok: true,
      value: { ...validPayload, inviteToken: null },
    });
  });
});

describe('createRoomConfig', () => {
  it('builds room config from init payload', () => {
    expect(
      createRoomConfig({
        code: 'ABCDE',
        scenario: 'escape',
        playerToken: 'A'.repeat(32),
        inviteToken: 'B'.repeat(32),
      }),
    ).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, 'B'.repeat(32)],
    });
  });

  it('builds room config with null invite token', () => {
    expect(
      createRoomConfig({
        code: 'ABCDE',
        scenario: 'escape',
        playerToken: 'A'.repeat(32),
        inviteToken: null,
      }),
    ).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, null],
    });
  });
});

describe('seat assignment', () => {
  it('lets the creator claim the reserved seat with the issued token', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: 'creator-token',
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: false,
      consumeInviteToken: false,
    });
  });

  it('requires an invite token for the guest seat and rotates it into a player token', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Join token required',
    });

    expect(
      resolveSeatAssignment({
        presentedToken: 'invite-token',
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: true,
      consumeInviteToken: true,
    });
  });

  it('rejects invalid tokens', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: 'bad-token',
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });

  it('requires the stored token to reclaim a disconnected seat', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: 1,
        seatOpen: [false, true],
        playerTokens: ['creator-token', 'guest-token'],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Join token required',
    });

    expect(
      resolveSeatAssignment({
        presentedToken: 'guest-token',
        disconnectedPlayer: 1,
        seatOpen: [false, true],
        playerTokens: ['creator-token', 'guest-token'],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: false,
      consumeInviteToken: false,
    });
  });

  it('rejects when game is full with no disconnected player', () => {
    // presentedToken must be null to avoid hitting "Invalid player token" first
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [false, false],
        playerTokens: ['creator-token', 'guest-token'],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'reject',
      status: 409,
      message: 'Game is full',
    });
  });

  it('rejects with invalid player token when presenting wrong token to full game', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: 'wrong-token',
        disconnectedPlayer: null,
        seatOpen: [false, false],
        playerTokens: ['creator-token', 'guest-token'],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });

  it('reports waiting for reconnection when disconnected player exists but no seats open', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: 1,
        seatOpen: [false, false],
        playerTokens: ['creator-token', 'guest-token'],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'reject',
      status: 409,
      message: 'Waiting for player reconnection',
    });
  });

  it('allows tokenless fallback for seats with no tokens assigned', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [true, true],
        playerTokens: [null as unknown as string, null],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: true,
      consumeInviteToken: false,
    });
  });

  it('tokenless fallback allows joining second seat when it has no tokens', () => {
    // Seat 1 is open with no playerToken and no inviteToken — tokenless fallback applies
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, null],
      }),
    ).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: true,
      consumeInviteToken: false,
    });
  });

  it('requires token when open seat has an invite token assigned', () => {
    // Seat 1 is open but has an inviteToken — tokenless fallback does NOT apply
    expect(
      resolveSeatAssignment({
        presentedToken: null,
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Join token required',
    });
  });

  it('lets stored player tokens reclaim occupied seats before the old socket closes', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: 'creator-token',
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: false,
      consumeInviteToken: false,
    });
  });
});
