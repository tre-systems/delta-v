import { describe, expect, it } from 'vitest';
import {
  createRoomConfig,
  generatePlayerToken,
  generateRoomCode,
  normalizeScenarioKey,
  parseCreatePayload,
  parseInitPayload,
  resolveSeatAssignment,
  validateClientMessage,
} from '../protocol';

describe('protocol helpers', () => {
  it('generates 5-character room codes from the allowed alphabet', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('generates 32-character player tokens', () => {
    expect(generatePlayerToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('normalizes unknown scenarios to biplanetary', () => {
    expect(normalizeScenarioKey('duel', ['biplanetary', 'duel'])).toBe('duel');
    expect(normalizeScenarioKey('bogus', ['biplanetary', 'duel'])).toBe('biplanetary');
    expect(normalizeScenarioKey(null, ['biplanetary', 'duel'])).toBe('biplanetary');
  });

  it('parses create payloads safely', () => {
    expect(parseCreatePayload({ scenario: 'escape' }, ['biplanetary', 'escape'])).toEqual({ scenario: 'escape' });
    expect(parseCreatePayload({ scenario: 'fake' }, ['biplanetary', 'escape'])).toEqual({ scenario: 'biplanetary' });
    expect(parseCreatePayload(null, ['biplanetary', 'escape'])).toEqual({ scenario: 'biplanetary' });
  });

  it('parses init payloads and builds room config', () => {
    const parsed = parseInitPayload({
      code: 'ABCDE',
      scenario: 'escape',
      playerToken: 'A'.repeat(32),
      inviteToken: 'B'.repeat(32),
    }, ['biplanetary', 'escape']);
    expect(parsed).toEqual({
      ok: true,
      value: {
        code: 'ABCDE',
        scenario: 'escape',
        playerToken: 'A'.repeat(32),
        inviteToken: 'B'.repeat(32),
      },
    });
    if (!parsed.ok) {
      throw new Error('expected init payload to parse');
    }
    expect(createRoomConfig(parsed.value)).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, 'B'.repeat(32)],
    });
  });

  it('rejects malformed init payloads', () => {
    expect(parseInitPayload(null, ['biplanetary'])).toEqual({
      ok: false,
      error: 'Invalid init payload',
    });
    expect(parseInitPayload({
      code: 'ABCD',
      scenario: 'biplanetary',
      playerToken: 'A'.repeat(32),
      inviteToken: 'B'.repeat(32),
    }, ['biplanetary'])).toEqual({
      ok: false,
      error: 'Invalid room code',
    });
    expect(parseInitPayload({
      code: 'ABCDE',
      scenario: 'bogus',
      playerToken: 'A'.repeat(32),
      inviteToken: 'B'.repeat(32),
    }, ['biplanetary'])).toEqual({
      ok: false,
      error: 'Invalid scenario',
    });
    expect(parseInitPayload({
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerToken: 'bad',
      inviteToken: 'B'.repeat(32),
    }, ['biplanetary'])).toEqual({
      ok: false,
      error: 'Invalid player token',
    });
  });
});

describe('client message validation', () => {
  it('accepts valid astrogation payloads', () => {
    expect(validateClientMessage({
      type: 'astrogation',
      orders: [{ shipId: 'p0s0', burn: 1, overload: null, weakGravityChoices: { '0,1': true } }],
    })).toEqual({
      ok: true,
      value: {
        type: 'astrogation',
        orders: [{ shipId: 'p0s0', burn: 1, overload: null, weakGravityChoices: { '0,1': true } }],
      },
    });
  });

  it('rejects malformed combat payloads', () => {
    expect(validateClientMessage({ type: 'combat', attacks: null })).toEqual({
      ok: false,
      error: 'Invalid combat payload',
    });
  });

  it('rejects invalid ordnance payloads', () => {
    expect(validateClientMessage({
      type: 'ordnance',
      launches: [{ shipId: 'p0s0', ordnanceType: 'mine', torpedoAccel: 7 }],
    })).toEqual({
      ok: false,
      error: 'Invalid ordnance payload',
    });
  });

  it('rejects unknown message types', () => {
    expect(validateClientMessage({ type: 'godMode' })).toEqual({
      ok: false,
      error: 'Unknown message type',
    });
  });
});

describe('seat assignment', () => {
  it('lets the creator claim the reserved seat with the issued token', () => {
    expect(resolveSeatAssignment({
      presentedToken: 'creator-token',
      disconnectedPlayer: null,
      seatOpen: [true, true],
      playerTokens: ['creator-token', null],
      inviteTokens: [null, 'invite-token'],
    })).toEqual({
      type: 'join',
      playerId: 0,
      issueNewToken: false,
      consumeInviteToken: false,
    });
  });

  it('requires an invite token for the guest seat and rotates it into a player token', () => {
    expect(resolveSeatAssignment({
      presentedToken: null,
      disconnectedPlayer: null,
      seatOpen: [true, true],
      playerTokens: ['creator-token', null],
      inviteTokens: [null, 'invite-token'],
    })).toEqual({
      type: 'reject',
      status: 403,
      message: 'Join token required',
    });

    expect(resolveSeatAssignment({
      presentedToken: 'invite-token',
      disconnectedPlayer: null,
      seatOpen: [true, true],
      playerTokens: ['creator-token', null],
      inviteTokens: [null, 'invite-token'],
    })).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: true,
      consumeInviteToken: true,
    });
  });

  it('rejects invalid tokens', () => {
    expect(resolveSeatAssignment({
      presentedToken: 'bad-token',
      disconnectedPlayer: null,
      seatOpen: [true, true],
      playerTokens: ['creator-token', null],
      inviteTokens: [null, 'invite-token'],
    })).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });

  it('requires the stored token to reclaim a disconnected seat', () => {
    expect(resolveSeatAssignment({
      presentedToken: null,
      disconnectedPlayer: 1,
      seatOpen: [false, true],
      playerTokens: ['creator-token', 'guest-token'],
      inviteTokens: [null, null],
    })).toEqual({
      type: 'reject',
      status: 403,
      message: 'Join token required',
    });

    expect(resolveSeatAssignment({
      presentedToken: 'guest-token',
      disconnectedPlayer: 1,
      seatOpen: [false, true],
      playerTokens: ['creator-token', 'guest-token'],
      inviteTokens: [null, null],
    })).toEqual({
      type: 'join',
      playerId: 1,
      issueNewToken: false,
      consumeInviteToken: false,
    });
  });
});
