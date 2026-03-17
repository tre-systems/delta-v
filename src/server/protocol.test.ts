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
  validateClientMessage,
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
    const tokens = new Set(Array.from({ length: 20 }, () => generatePlayerToken()));
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
    expect(isValidPlayerToken('A'.repeat(31) + '!')).toBe(false);
    expect(isValidPlayerToken('A'.repeat(31) + ' ')).toBe(false);
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
    expect(parseCreatePayload({ scenario: 'escape' }, keys)).toEqual({ scenario: 'escape' });
  });

  it('defaults unknown scenario to biplanetary', () => {
    expect(parseCreatePayload({ scenario: 'fake' }, keys)).toEqual({ scenario: 'biplanetary' });
  });

  it('defaults non-object payloads to biplanetary', () => {
    expect(parseCreatePayload(null, keys)).toEqual({ scenario: 'biplanetary' });
    expect(parseCreatePayload(undefined, keys)).toEqual({ scenario: 'biplanetary' });
    expect(parseCreatePayload('string', keys)).toEqual({ scenario: 'biplanetary' });
    expect(parseCreatePayload(42, keys)).toEqual({ scenario: 'biplanetary' });
  });

  it('defaults arrays to biplanetary (arrays are not plain objects)', () => {
    expect(parseCreatePayload([], keys)).toEqual({ scenario: 'biplanetary' });
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

  it('rejects non-object payloads', () => {
    expect(parseInitPayload(null, keys)).toEqual({ ok: false, error: 'Invalid init payload' });
    expect(parseInitPayload('string', keys)).toEqual({ ok: false, error: 'Invalid init payload' });
    expect(parseInitPayload(42, keys)).toEqual({ ok: false, error: 'Invalid init payload' });
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
    expect(parseInitPayload({ ...validPayload, code: 'ABCDEF' }, keys)).toEqual({
      ok: false,
      error: 'Invalid room code',
    });
  });

  it('rejects invalid scenarios', () => {
    expect(parseInitPayload({ ...validPayload, scenario: 'bogus' }, keys)).toEqual({
      ok: false,
      error: 'Invalid scenario',
    });
    expect(parseInitPayload({ ...validPayload, scenario: 42 }, keys)).toEqual({
      ok: false,
      error: 'Invalid scenario',
    });
  });

  it('rejects invalid player tokens', () => {
    expect(parseInitPayload({ ...validPayload, playerToken: 'bad' }, keys)).toEqual({
      ok: false,
      error: 'Invalid player token',
    });
    expect(parseInitPayload({ ...validPayload, playerToken: null }, keys)).toEqual({
      ok: false,
      error: 'Invalid player token',
    });
  });

  it('rejects invalid invite tokens', () => {
    expect(parseInitPayload({ ...validPayload, inviteToken: 'bad' }, keys)).toEqual({
      ok: false,
      error: 'Invalid invite token',
    });
    expect(parseInitPayload({ ...validPayload, inviteToken: null }, keys)).toEqual({
      ok: false,
      error: 'Invalid invite token',
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
});

describe('validateClientMessage', () => {
  describe('basic validation', () => {
    it('rejects non-object payloads', () => {
      expect(validateClientMessage(null)).toEqual({ ok: false, error: 'Invalid message payload' });
      expect(validateClientMessage('string')).toEqual({ ok: false, error: 'Invalid message payload' });
      expect(validateClientMessage(42)).toEqual({ ok: false, error: 'Invalid message payload' });
      expect(validateClientMessage(undefined)).toEqual({ ok: false, error: 'Invalid message payload' });
    });

    it('rejects objects without a string type', () => {
      expect(validateClientMessage({})).toEqual({ ok: false, error: 'Invalid message payload' });
      expect(validateClientMessage({ type: 42 })).toEqual({ ok: false, error: 'Invalid message payload' });
      expect(validateClientMessage({ type: null })).toEqual({ ok: false, error: 'Invalid message payload' });
    });

    it('rejects unknown message types', () => {
      expect(validateClientMessage({ type: 'godMode' })).toEqual({ ok: false, error: 'Unknown message type' });
      expect(validateClientMessage({ type: '' })).toEqual({ ok: false, error: 'Unknown message type' });
    });
  });

  describe('simple message types', () => {
    it.each(['skipOrdnance', 'beginCombat', 'skipCombat', 'rematch'] as const)('accepts %s', (type) => {
      expect(validateClientMessage({ type })).toEqual({ ok: true, value: { type } });
    });
  });

  describe('ping', () => {
    it('accepts valid ping with finite timestamp', () => {
      expect(validateClientMessage({ type: 'ping', t: 1234567890 })).toEqual({
        ok: true,
        value: { type: 'ping', t: 1234567890 },
      });
      expect(validateClientMessage({ type: 'ping', t: 0 })).toEqual({
        ok: true,
        value: { type: 'ping', t: 0 },
      });
      expect(validateClientMessage({ type: 'ping', t: -1 })).toEqual({
        ok: true,
        value: { type: 'ping', t: -1 },
      });
    });

    it('rejects ping with non-finite or non-number timestamp', () => {
      expect(validateClientMessage({ type: 'ping', t: Number.POSITIVE_INFINITY })).toEqual({
        ok: false,
        error: 'Invalid ping payload',
      });
      expect(validateClientMessage({ type: 'ping', t: Number.NaN })).toEqual({
        ok: false,
        error: 'Invalid ping payload',
      });
      expect(validateClientMessage({ type: 'ping', t: 'string' })).toEqual({
        ok: false,
        error: 'Invalid ping payload',
      });
      expect(validateClientMessage({ type: 'ping', t: null })).toEqual({
        ok: false,
        error: 'Invalid ping payload',
      });
      expect(validateClientMessage({ type: 'ping' })).toEqual({
        ok: false,
        error: 'Invalid ping payload',
      });
    });
  });

  describe('fleetReady', () => {
    it('accepts valid fleet purchases', () => {
      const result = validateClientMessage({
        type: 'fleetReady',
        purchases: [{ shipType: 'cruiser' }, { shipType: 'destroyer' }],
      });
      expect(result).toEqual({
        ok: true,
        value: { type: 'fleetReady', purchases: [{ shipType: 'cruiser' }, { shipType: 'destroyer' }] },
      });
    });

    it('accepts empty fleet purchases', () => {
      expect(validateClientMessage({ type: 'fleetReady', purchases: [] })).toEqual({
        ok: true,
        value: { type: 'fleetReady', purchases: [] },
      });
    });

    it('rejects non-array purchases', () => {
      expect(validateClientMessage({ type: 'fleetReady', purchases: null })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
      expect(validateClientMessage({ type: 'fleetReady', purchases: 'cruiser' })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });

    it('rejects purchases exceeding max count', () => {
      const purchases = Array.from({ length: 65 }, () => ({ shipType: 'cruiser' }));
      expect(validateClientMessage({ type: 'fleetReady', purchases })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });

    it('rejects purchases with missing or invalid shipType', () => {
      expect(validateClientMessage({ type: 'fleetReady', purchases: [{}] })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
      expect(validateClientMessage({ type: 'fleetReady', purchases: [{ shipType: '' }] })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
      expect(validateClientMessage({ type: 'fleetReady', purchases: [{ shipType: 42 }] })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
      expect(validateClientMessage({ type: 'fleetReady', purchases: ['cruiser'] })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });
  });

  describe('astrogation', () => {
    it('accepts valid astrogation orders', () => {
      const result = validateClientMessage({
        type: 'astrogation',
        orders: [{ shipId: 'p0s0', burn: 1, overload: null, weakGravityChoices: { '0,1': true } }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 1, overload: null, weakGravityChoices: { '0,1': true } }],
        },
      });
    });

    it('accepts orders with undefined overload (defaults to null)', () => {
      const result = validateClientMessage({
        type: 'astrogation',
        orders: [{ shipId: 'p0s0', burn: 0 }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 0, overload: null, weakGravityChoices: undefined }],
        },
      });
    });

    it('accepts orders with valid overload values', () => {
      for (const overload of [null, 0, 1, 2, 3, 4, 5]) {
        const result = validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 1, overload }],
        });
        expect(result.ok).toBe(true);
      }
    });

    it('accepts empty orders', () => {
      expect(validateClientMessage({ type: 'astrogation', orders: [] })).toEqual({
        ok: true,
        value: { type: 'astrogation', orders: [] },
      });
    });

    it('rejects non-array orders', () => {
      expect(validateClientMessage({ type: 'astrogation', orders: null })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders exceeding max count', () => {
      const orders = Array.from({ length: 65 }, () => ({ shipId: 'p0s0', burn: 0 }));
      expect(validateClientMessage({ type: 'astrogation', orders })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with missing or empty shipId', () => {
      expect(validateClientMessage({ type: 'astrogation', orders: [{ burn: 0 }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
      expect(validateClientMessage({ type: 'astrogation', orders: [{ shipId: '', burn: 0 }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with invalid burn values', () => {
      expect(validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: -1 }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
      expect(validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 6 }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
      expect(validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 1.5 }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
      expect(validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 'fast' }] })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with invalid overload values', () => {
      expect(
        validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 1, overload: -1 }] }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
      expect(
        validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 1, overload: 6 }] }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
      expect(
        validateClientMessage({ type: 'astrogation', orders: [{ shipId: 'p0s0', burn: 1, overload: 'max' }] }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
    });

    it('rejects orders with invalid weakGravityChoices', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 1, weakGravityChoices: 'bad' }],
        }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 1, weakGravityChoices: { key: 'not-boolean' } }],
        }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
    });

    it('rejects weakGravityChoices exceeding max entries', () => {
      const weakGravityChoices: Record<string, boolean> = {};
      for (let i = 0; i <= 64; i++) {
        weakGravityChoices[`${i},0`] = true;
      }
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: 'p0s0', burn: 1, weakGravityChoices }],
        }),
      ).toEqual({ ok: false, error: 'Invalid astrogation payload' });
    });
  });

  describe('ordnance', () => {
    it.each(['mine', 'torpedo', 'nuke'] as const)('accepts valid %s launch', (ordnanceType) => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [{ shipId: 'p0s0', ordnanceType }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType, torpedoAccel: null, torpedoAccelSteps: null }],
        },
      });
    });

    it('accepts torpedo with acceleration and steps', () => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccel: 3, torpedoAccelSteps: 2 }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccel: 3, torpedoAccelSteps: 2 }],
        },
      });
    });

    it('accepts empty launches', () => {
      expect(validateClientMessage({ type: 'ordnance', launches: [] })).toEqual({
        ok: true,
        value: { type: 'ordnance', launches: [] },
      });
    });

    it('rejects non-array launches', () => {
      expect(validateClientMessage({ type: 'ordnance', launches: 'mine' })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches exceeding max count', () => {
      const launches = Array.from({ length: 65 }, () => ({ shipId: 'p0s0', ordnanceType: 'mine' }));
      expect(validateClientMessage({ type: 'ordnance', launches })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with invalid ordnanceType', () => {
      expect(
        validateClientMessage({ type: 'ordnance', launches: [{ shipId: 'p0s0', ordnanceType: 'laser' }] }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
      expect(validateClientMessage({ type: 'ordnance', launches: [{ shipId: 'p0s0', ordnanceType: 42 }] })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with missing or empty shipId', () => {
      expect(validateClientMessage({ type: 'ordnance', launches: [{ ordnanceType: 'mine' }] })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
      expect(validateClientMessage({ type: 'ordnance', launches: [{ shipId: '', ordnanceType: 'mine' }] })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with out-of-range torpedoAccel', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccel: 7 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccel: -1 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
    });

    it('rejects launches with invalid torpedoAccelSteps', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccelSteps: 3 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccelSteps: 0 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccelSteps: 'two' }],
        }),
      ).toEqual({ ok: false, error: 'Invalid ordnance payload' });
    });

    it('accepts null torpedoAccelSteps', () => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [{ shipId: 'p0s0', ordnanceType: 'torpedo', torpedoAccelSteps: null }],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('emplaceBase', () => {
    it('accepts valid emplacement', () => {
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: [{ shipId: 'p0s0' }] })).toEqual({
        ok: true,
        value: { type: 'emplaceBase', emplacements: [{ shipId: 'p0s0' }] },
      });
    });

    it('accepts empty emplacements', () => {
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: [] })).toEqual({
        ok: true,
        value: { type: 'emplaceBase', emplacements: [] },
      });
    });

    it('rejects non-array emplacements', () => {
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: null })).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });

    it('rejects emplacements exceeding max count', () => {
      const emplacements = Array.from({ length: 33 }, () => ({ shipId: 'p0s0' }));
      expect(validateClientMessage({ type: 'emplaceBase', emplacements })).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });

    it('rejects emplacements with missing or empty shipId', () => {
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: [{}] })).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: [{ shipId: '' }] })).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
      expect(validateClientMessage({ type: 'emplaceBase', emplacements: [{ shipId: 42 }] })).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });
  });

  describe('combat', () => {
    it('accepts valid combat attacks', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0' }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', targetType: undefined, attackStrength: null }],
        },
      });
    });

    it('accepts combat with targetType and attackStrength', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0', 'p0s1'], targetId: 'p1s0', targetType: 'ship', attackStrength: 5 }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0', 'p0s1'], targetId: 'p1s0', targetType: 'ship', attackStrength: 5 }],
        },
      });
    });

    it('accepts combat targeting ordnance', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'nuke1', targetType: 'ordnance' }],
      });
      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'nuke1', targetType: 'ordnance', attackStrength: null }],
        },
      });
    });

    it('accepts empty attacks', () => {
      expect(validateClientMessage({ type: 'combat', attacks: [] })).toEqual({
        ok: true,
        value: { type: 'combat', attacks: [] },
      });
    });

    it('rejects non-array attacks', () => {
      expect(validateClientMessage({ type: 'combat', attacks: null })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
      expect(validateClientMessage({ type: 'combat', attacks: 'attack' })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks exceeding max count', () => {
      const attacks = Array.from({ length: 65 }, () => ({ attackerIds: ['p0s0'], targetId: 'p1s0' }));
      expect(validateClientMessage({ type: 'combat', attacks })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with non-array attackerIds', () => {
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: 'p0s0', targetId: 'p1s0' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with empty attackerIds', () => {
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: [], targetId: 'p1s0' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with too many attackers', () => {
      const attackerIds = Array.from({ length: 17 }, (_, i) => `p0s${i}`);
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds, targetId: 'p1s0' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with non-string attacker ids', () => {
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: [42], targetId: 'p1s0' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: [''], targetId: 'p1s0' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with missing or empty targetId', () => {
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: ['p0s0'] }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: ['p0s0'], targetId: '' }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
      expect(validateClientMessage({ type: 'combat', attacks: [{ attackerIds: ['p0s0'], targetId: 42 }] })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with invalid targetType', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', targetType: 'base' }],
        }),
      ).toEqual({ ok: false, error: 'Invalid combat payload' });
    });

    it('rejects attacks with invalid attackStrength', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 0 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid combat payload' });
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 100 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid combat payload' });
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 1.5 }],
        }),
      ).toEqual({ ok: false, error: 'Invalid combat payload' });
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 'max' }],
        }),
      ).toEqual({ ok: false, error: 'Invalid combat payload' });
    });

    it('accepts null attackStrength', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: null }],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type === 'combat' && result.value.attacks[0].attackStrength).toBeNull();
      }
    });

    it('accepts boundary attackStrength values', () => {
      const min = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 1 }],
      });
      const max = validateClientMessage({
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', attackStrength: 99 }],
      });
      expect(min.ok).toBe(true);
      expect(max.ok).toBe(true);
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

  it('does not match token against a closed seat', () => {
    expect(
      resolveSeatAssignment({
        presentedToken: 'creator-token',
        disconnectedPlayer: null,
        seatOpen: [false, true],
        playerTokens: ['creator-token', null],
        inviteTokens: [null, 'invite-token'],
      }),
    ).toEqual({
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    });
  });
});
