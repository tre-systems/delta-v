import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asGameId, asOrdnanceId, asShipId } from './ids';
import { validateClientMessage, validateServerMessage } from './protocol';

const sharedContractFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/contracts.json', import.meta.url),
    'utf8',
  ),
) as {
  c2s: Record<string, { raw: unknown; expected: unknown }>;
  c2sRejected?: Record<string, { raw: unknown; expectedOk: false }>;
};

const normalizeFixtureValue = (value: unknown): unknown => {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeFixtureValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeFixtureValue(entry),
      ]),
    );
  }

  return value;
};

describe('validateClientMessage', () => {
  describe('basic validation', () => {
    it('rejects non-object payloads', () => {
      expect(validateClientMessage(null)).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });

      expect(validateClientMessage('string')).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });

      expect(validateClientMessage(42)).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });

      expect(validateClientMessage(undefined)).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });
    });

    it('rejects objects without a string type', () => {
      expect(validateClientMessage({})).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });

      expect(validateClientMessage({ type: 42 })).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });

      expect(validateClientMessage({ type: null })).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });
    });

    it('rejects unknown message types', () => {
      expect(validateClientMessage({ type: 'godMode' })).toEqual({
        ok: false,
        error: 'Unknown message type: godMode',
      });

      expect(validateClientMessage({ type: '' })).toEqual({
        ok: false,
        error: 'Unknown message type: ',
      });
    });
  });

  describe('simple message types', () => {
    it.each([
      'skipOrdnance',
      'beginCombat',
      'skipCombat',
      'rematch',
    ] as const)('accepts %s', (type) => {
      expect(validateClientMessage({ type })).toEqual({
        ok: true,
        value: { type },
      });
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
      expect(
        validateClientMessage({
          type: 'ping',
          t: Number.POSITIVE_INFINITY,
        }),
      ).toEqual({
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

  describe('chat', () => {
    it('accepts valid chat message', () => {
      expect(validateClientMessage({ type: 'chat', text: 'hello' })).toEqual({
        ok: true,
        value: { type: 'chat', text: 'hello' },
      });
    });

    it('trims whitespace', () => {
      expect(validateClientMessage({ type: 'chat', text: '  hi  ' })).toEqual({
        ok: true,
        value: { type: 'chat', text: 'hi' },
      });
    });

    it('rejects empty text', () => {
      expect(validateClientMessage({ type: 'chat', text: '' })).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });

    it('rejects whitespace-only text', () => {
      expect(validateClientMessage({ type: 'chat', text: '   ' })).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });

    it('rejects missing text', () => {
      expect(validateClientMessage({ type: 'chat' })).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });

    it('rejects text over 200 chars', () => {
      expect(
        validateClientMessage({
          type: 'chat',
          text: 'x'.repeat(201),
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });

    it('rejects non-string text', () => {
      expect(validateClientMessage({ type: 'chat', text: 42 })).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });
  });

  describe('fleetReady', () => {
    it('accepts valid fleet purchases', () => {
      const result = validateClientMessage({
        type: 'fleetReady',
        purchases: [{ shipType: 'corvette' }, { shipType: 'frigate' }],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'fleetReady',
          purchases: [
            { kind: 'ship', shipType: 'corvette' },
            { kind: 'ship', shipType: 'frigate' },
          ],
        },
      });
    });

    it('normalizes legacy orbital-base purchases to orbital-base cargo', () => {
      const result = validateClientMessage({
        type: 'fleetReady',
        purchases: [{ shipType: 'orbitalBase' }],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'fleetReady',
          purchases: [{ kind: 'orbitalBaseCargo' }],
        },
      });
    });

    it('accepts empty fleet purchases', () => {
      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: [],
        }),
      ).toEqual({
        ok: true,
        value: { type: 'fleetReady', purchases: [] },
      });
    });

    it('rejects non-array purchases', () => {
      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: null,
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });

      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: 'cruiser',
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });

    it('rejects purchases exceeding max count', () => {
      const purchases = Array.from({ length: 65 }, () => ({
        shipType: 'cruiser',
      }));

      expect(validateClientMessage({ type: 'fleetReady', purchases })).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });

    it('rejects purchases with missing or invalid shipType', () => {
      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: [{}],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });

      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: [{ shipType: '' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });

      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: [{ shipType: 42 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });

      expect(
        validateClientMessage({
          type: 'fleetReady',
          purchases: ['cruiser'],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid fleet payload',
      });
    });
  });

  describe('astrogation', () => {
    it('accepts valid astrogation orders', () => {
      const result = validateClientMessage({
        type: 'astrogation',
        orders: [
          {
            shipId: asShipId('p0s0'),
            burn: 1,
            overload: null,
            weakGravityChoices: { '0,1': true },
          },
        ],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'astrogation',
          orders: [
            {
              shipId: asShipId('p0s0'),
              burn: 1,
              overload: null,
              weakGravityChoices: { '0,1': true },
            },
          ],
        },
      });
    });

    it('accepts orders with undefined overload (defaults to null)', () => {
      const result = validateClientMessage({
        type: 'astrogation',
        orders: [{ shipId: asShipId('p0s0'), burn: 0 }],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'astrogation',
          orders: [
            {
              shipId: asShipId('p0s0'),
              burn: 0,
              overload: null,
              weakGravityChoices: undefined,
            },
          ],
        },
      });
    });

    it('accepts orders with valid overload values', () => {
      for (const overload of [null, 0, 1, 2, 3, 4, 5]) {
        const result = validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1, overload }],
        });

        expect(result.ok).toBe(true);
      }
    });

    it('accepts empty orders', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [],
        }),
      ).toEqual({
        ok: true,
        value: { type: 'astrogation', orders: [] },
      });
    });

    it('rejects non-array orders', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: null,
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders exceeding max count', () => {
      const orders = Array.from({ length: 65 }, () => ({
        shipId: asShipId('p0s0'),
        burn: 0,
      }));

      expect(validateClientMessage({ type: 'astrogation', orders })).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with missing or empty shipId', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ burn: 0 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId(''), burn: 0 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with invalid burn values', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: -1 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 6 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1.5 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 'fast' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with invalid overload values', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1, overload: -1 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1, overload: 6 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1, overload: 'max' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects orders with invalid weakGravityChoices', () => {
      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [
            {
              shipId: asShipId('p0s0'),
              burn: 1,
              weakGravityChoices: 'bad',
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [
            {
              shipId: asShipId('p0s0'),
              burn: 1,
              weakGravityChoices: { key: 'not-boolean' },
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });

    it('rejects weakGravityChoices exceeding max entries', () => {
      const weakGravityChoices: Record<string, boolean> = {};
      for (let i = 0; i <= 64; i++) {
        weakGravityChoices[`${i},0`] = true;
      }

      expect(
        validateClientMessage({
          type: 'astrogation',
          orders: [{ shipId: asShipId('p0s0'), burn: 1, weakGravityChoices }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid astrogation payload',
      });
    });
  });

  describe('ordnance', () => {
    it.each([
      'mine',
      'torpedo',
      'nuke',
    ] as const)('accepts valid %s launch', (ordnanceType) => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [{ shipId: asShipId('p0s0'), ordnanceType }],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType,
              torpedoAccel: null,
              torpedoAccelSteps: null,
            },
          ],
        },
      });
    });

    it('accepts torpedo with acceleration and steps', () => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [
          {
            shipId: asShipId('p0s0'),
            ordnanceType: 'torpedo',
            torpedoAccel: 3,
            torpedoAccelSteps: 2,
          },
        ],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccel: 3,
              torpedoAccelSteps: 2,
            },
          ],
        },
      });
    });

    it('accepts empty launches', () => {
      expect(validateClientMessage({ type: 'ordnance', launches: [] })).toEqual(
        {
          ok: true,
          value: { type: 'ordnance', launches: [] },
        },
      );
    });

    it('rejects non-array launches', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: 'mine',
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches exceeding max count', () => {
      const launches = Array.from({ length: 65 }, () => ({
        shipId: asShipId('p0s0'),
        ordnanceType: 'mine',
      }));

      expect(validateClientMessage({ type: 'ordnance', launches })).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with invalid ordnanceType', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: asShipId('p0s0'), ordnanceType: 'laser' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: asShipId('p0s0'), ordnanceType: 42 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with missing or empty shipId', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ ordnanceType: 'mine' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: asShipId(''), ordnanceType: 'mine' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [{ shipId: 42, ordnanceType: 'mine' }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with out-of-range torpedoAccel', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccel: 7,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccel: -1,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('rejects launches with invalid torpedoAccelSteps', () => {
      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccelSteps: 3,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccelSteps: 0,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });

      expect(
        validateClientMessage({
          type: 'ordnance',
          launches: [
            {
              shipId: asShipId('p0s0'),
              ordnanceType: 'torpedo',
              torpedoAccelSteps: 'two',
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid ordnance payload',
      });
    });

    it('accepts null torpedoAccelSteps', () => {
      const result = validateClientMessage({
        type: 'ordnance',
        launches: [
          {
            shipId: asShipId('p0s0'),
            ordnanceType: 'torpedo',
            torpedoAccelSteps: null,
          },
        ],
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('emplaceBase', () => {
    it('accepts valid emplacement', () => {
      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: [{ shipId: asShipId('p0s0') }],
        }),
      ).toEqual({
        ok: true,
        value: {
          type: 'emplaceBase',
          emplacements: [{ shipId: asShipId('p0s0') }],
        },
      });
    });

    it('accepts empty emplacements', () => {
      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: [],
        }),
      ).toEqual({
        ok: true,
        value: { type: 'emplaceBase', emplacements: [] },
      });
    });

    it('rejects non-array emplacements', () => {
      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: null,
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });

    it('rejects emplacements exceeding max count', () => {
      const emplacements = Array.from({ length: 33 }, () => ({
        shipId: asShipId('p0s0'),
      }));

      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements,
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });

    it('rejects emplacements with missing or empty shipId', () => {
      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: [{}],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });

      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: [{ shipId: asShipId('') }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });

      expect(
        validateClientMessage({
          type: 'emplaceBase',
          emplacements: [{ shipId: 42 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid emplacement payload',
      });
    });
  });

  describe('combat', () => {
    it('accepts valid combat attacks', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [
          { attackerIds: [asShipId('p0s0')], targetId: asShipId('p1s0') },
        ],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              targetType: 'ship',
              attackStrength: null,
            },
          ],
        },
      });
    });

    it('accepts combat with targetType and attackStrength', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0'), asShipId('p0s1')],
            targetId: asShipId('p1s0'),
            targetType: 'ship',
            attackStrength: 5,
          },
        ],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0'), asShipId('p0s1')],
              targetId: asShipId('p1s0'),
              targetType: 'ship',
              attackStrength: 5,
            },
          ],
        },
      });
    });

    it('accepts combat targeting ordnance', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0')],
            targetId: asOrdnanceId('nuke1'),
            targetType: 'ordnance',
          },
        ],
      });

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asOrdnanceId('nuke1'),
              targetType: 'ordnance',
              attackStrength: null,
            },
          ],
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

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: 'attack',
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks exceeding max count', () => {
      const attacks = Array.from({ length: 65 }, () => ({
        attackerIds: [asShipId('p0s0')],
        targetId: asShipId('p1s0'),
      }));

      expect(validateClientMessage({ type: 'combat', attacks })).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with non-array attackerIds', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: 'p0s0', targetId: asShipId('p1s0') }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with empty attackerIds', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: [], targetId: asShipId('p1s0') }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with too many attackers', () => {
      const attackerIds = Array.from({ length: 17 }, (_, i) => `p0s${i}`);

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds, targetId: asShipId('p1s0') }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with non-string attacker ids', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: [42], targetId: asShipId('p1s0') }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            { attackerIds: [asShipId('')], targetId: asShipId('p1s0') },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with missing or empty targetId', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: [asShipId('p0s0')] }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            { attackerIds: [asShipId('p0s0')], targetId: asShipId('') },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [{ attackerIds: [asShipId('p0s0')], targetId: 42 }],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with invalid targetType', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              targetType: 'base',
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('rejects attacks with invalid attackStrength', () => {
      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              attackStrength: 0,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              attackStrength: 100,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              attackStrength: 1.5,
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });

      expect(
        validateClientMessage({
          type: 'combat',
          attacks: [
            {
              attackerIds: [asShipId('p0s0')],
              targetId: asShipId('p1s0'),
              attackStrength: 'max',
            },
          ],
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid combat payload',
      });
    });

    it('accepts null attackStrength', () => {
      const result = validateClientMessage({
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0')],
            targetId: asShipId('p1s0'),
            attackStrength: null,
          },
        ],
      });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(
          result.value.type === 'combat' &&
            result.value.attacks[0].attackStrength,
        ).toBeNull();
      }
    });

    it('accepts boundary attackStrength values', () => {
      const min = validateClientMessage({
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0')],
            targetId: asShipId('p1s0'),
            attackStrength: 1,
          },
        ],
      });

      const max = validateClientMessage({
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0')],
            targetId: asShipId('p1s0'),
            attackStrength: 99,
          },
        ],
      });

      expect(min.ok).toBe(true);
      expect(max.ok).toBe(true);
    });
  });

  it('brands ordnance combat targets as ordnance ids', () => {
    const result = validateClientMessage({
      type: 'combat',
      attacks: [
        {
          attackerIds: [asShipId('p0s0')],
          targetId: 'nuke-7',
          targetType: 'ordnance',
          attackStrength: 1,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0')],
            targetId: asOrdnanceId('nuke-7'),
            targetType: 'ordnance',
            attackStrength: 1,
          },
        ],
      },
    });
  });
});

describe('C2S contract fixtures', () => {
  it('fleetReady wire shape', () => {
    const result = validateClientMessage({
      type: 'fleetReady',
      purchases: [{ kind: 'ship', shipType: 'corvette' }],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'fleetReady',
        purchases: [{ kind: 'ship', shipType: 'corvette' }],
      },
    });
  });

  it('astrogation wire shape with burn and overload', () => {
    const result = validateClientMessage({
      type: 'astrogation',
      orders: [
        {
          shipId: asShipId('p0s0'),
          burn: 2,
          overload: 1,
          weakGravityChoices: { q3r5: true },
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'astrogation',
        orders: [
          {
            shipId: asShipId('p0s0'),
            burn: 2,
            overload: 1,
            weakGravityChoices: { q3r5: true },
          },
        ],
      },
    });
  });

  it('astrogation wire shape with null burn (drift)', () => {
    const result = validateClientMessage({
      type: 'astrogation',
      orders: [{ shipId: asShipId('p0s0'), burn: null }],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'astrogation',
        orders: [
          {
            shipId: asShipId('p0s0'),
            burn: null,
            overload: null,
            weakGravityChoices: undefined,
          },
        ],
      },
    });
  });

  it('ordnance wire shape with torpedo', () => {
    const result = validateClientMessage({
      type: 'ordnance',
      launches: [
        {
          shipId: asShipId('p0s0'),
          ordnanceType: 'torpedo',
          torpedoAccel: 3,
          torpedoAccelSteps: 2,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'ordnance',
        launches: [
          {
            shipId: asShipId('p0s0'),
            ordnanceType: 'torpedo',
            torpedoAccel: 3,
            torpedoAccelSteps: 2,
          },
        ],
      },
    });
  });

  it('combat wire shape with multi-attacker and target type', () => {
    const result = validateClientMessage({
      type: 'combat',
      attacks: [
        {
          attackerIds: [asShipId('p0s0'), asShipId('p0s1')],
          targetId: asShipId('p1s0'),
          targetType: 'ship',
          attackStrength: 4,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'combat',
        attacks: [
          {
            attackerIds: [asShipId('p0s0'), asShipId('p0s1')],
            targetId: asShipId('p1s0'),
            targetType: 'ship',
            attackStrength: 4,
          },
        ],
      },
    });
  });

  it('logistics wire shape', () => {
    const result = validateClientMessage({
      type: 'logistics',
      transfers: [
        {
          sourceShipId: asShipId('p0s0'),
          targetShipId: 'p0s1',
          transferType: 'fuel',
          amount: 3,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'logistics',
        transfers: [
          {
            sourceShipId: asShipId('p0s0'),
            targetShipId: 'p0s1',
            transferType: 'fuel',
            amount: 3,
          },
        ],
      },
    });
  });

  it('emplaceBase wire shape', () => {
    const result = validateClientMessage({
      type: 'emplaceBase',
      emplacements: [{ shipId: asShipId('p0s0') }],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'emplaceBase',
        emplacements: [{ shipId: asShipId('p0s0') }],
      },
    });
  });

  it('surrender wire shape', () => {
    const result = validateClientMessage({
      type: 'surrender',
      shipIds: ['p0s0', 'p0s1'],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'surrender',
        shipIds: ['p0s0', 'p0s1'],
      },
    });
  });

  it('supports shorthand surrender wire shape without shipIds', () => {
    const result = validateClientMessage({
      type: 'surrender',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        type: 'surrender',
        shipIds: [],
      },
    });
  });

  it('rejects surrender shipIds list longer than 64', () => {
    const shipIds = Array.from({ length: 65 }, (_, i) => `s${i}`);
    expect(validateClientMessage({ type: 'surrender', shipIds }).ok).toBe(
      false,
    );
  });

  it('parameterless action wire shapes', () => {
    for (const type of [
      'skipOrdnance',
      'beginCombat',
      'endCombat',
      'skipCombat',
      'skipLogistics',
      'rematch',
    ] as const) {
      expect(validateClientMessage({ type })).toEqual({
        ok: true,
        value: { type },
      });
    }
  });

  it('chat wire shape', () => {
    const result = validateClientMessage({
      type: 'chat',
      text: 'gg',
    });

    expect(result).toEqual({
      ok: true,
      value: { type: 'chat', text: 'gg' },
    });
  });

  it('ping wire shape', () => {
    const result = validateClientMessage({
      type: 'ping',
      t: 1711234567890,
    });

    expect(result).toEqual({
      ok: true,
      value: { type: 'ping', t: 1711234567890 },
    });
  });

  it('matches the reviewed C2S fixture set', () => {
    for (const fixture of Object.values(sharedContractFixtures.c2s)) {
      expect(normalizeFixtureValue(validateClientMessage(fixture.raw))).toEqual(
        fixture.expected,
      );
    }
  });

  it('rejects every documented invalid C2S payload', () => {
    // Negative-case fixtures live alongside the happy paths so regressions
    // surface immediately: if someone relaxes a schema and an invalid
    // payload silently starts passing, the corresponding fixture here
    // fails and calls attention to the change.
    const rejected = sharedContractFixtures.c2sRejected ?? {};
    for (const [name, fixture] of Object.entries(rejected)) {
      const result = validateClientMessage(fixture.raw);
      expect(
        result.ok,
        `expected rejection for fixture ${name}, got: ${JSON.stringify(result)}`,
      ).toBe(false);
    }
  });
});

describe('validateServerMessage', () => {
  describe('basic validation', () => {
    it('rejects non-object payloads', () => {
      for (const bad of [null, 'string', 42, undefined, [], true]) {
        expect(validateServerMessage(bad)).toEqual({
          ok: false,
          error: 'Invalid message payload',
        });
      }
    });

    it('rejects objects without a string type', () => {
      expect(validateServerMessage({})).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });
      expect(validateServerMessage({ type: 42 })).toEqual({
        ok: false,
        error: 'Invalid message payload',
      });
    });

    it('rejects unknown message types', () => {
      expect(validateServerMessage({ type: 'godMode' })).toEqual({
        ok: false,
        error: 'Unknown message type: godMode',
      });
    });
  });

  describe('welcome', () => {
    it('accepts valid welcome', () => {
      const msg = {
        type: 'welcome',
        playerId: 0,
        code: 'ABCDE',
        playerToken: 'tok-123',
      };
      const result = validateServerMessage(msg);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe('welcome');
    });

    it('rejects welcome with invalid playerId', () => {
      expect(
        validateServerMessage({
          type: 'welcome',
          playerId: 2,
          code: 'ABCDE',
          playerToken: 'tok',
        }),
      ).toEqual({ ok: false, error: 'Invalid welcome payload' });
    });

    it('rejects welcome with missing fields', () => {
      expect(validateServerMessage({ type: 'welcome', playerId: 0 })).toEqual({
        ok: false,
        error: 'Invalid welcome payload',
      });
    });
  });

  describe('actionRejected', () => {
    const minimalRejected = {
      type: 'actionRejected' as const,
      reason: 'staleTurn' as const,
      message: 'turn mismatch',
      expected: {},
      actual: {
        turn: 2,
        phase: 'astrogation' as const,
        activePlayer: 0 as const,
      },
      state: { gameId: asGameId('G1') },
    };

    it('accepts optional submitterPlayerId for seats 0 and 1', () => {
      for (const submitterPlayerId of [0, 1] as const) {
        const result = validateServerMessage({
          ...minimalRejected,
          submitterPlayerId,
        });
        expect(result.ok).toBe(true);
      }
    });

    it('rejects invalid submitterPlayerId', () => {
      expect(
        validateServerMessage({
          ...minimalRejected,
          submitterPlayerId: 2,
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid actionRejected payload',
      });
    });
  });

  describe('actionAccepted', () => {
    const minimalAccepted = {
      type: 'actionAccepted' as const,
      guardStatus: 'inSync' as const,
      expected: {},
      actual: {
        turn: 2,
        phase: 'astrogation' as const,
        activePlayer: 0 as const,
      },
    };

    it('accepts valid actionAccepted payloads', () => {
      const result = validateServerMessage(minimalAccepted);
      expect(result.ok).toBe(true);
    });

    it('rejects invalid actionAccepted payloads', () => {
      expect(
        validateServerMessage({
          ...minimalAccepted,
          guardStatus: 'bad',
        }),
      ).toEqual({
        ok: false,
        error: 'Invalid actionAccepted payload',
      });
    });
  });

  describe('spectatorWelcome', () => {
    it('accepts valid spectatorWelcome', () => {
      const result = validateServerMessage({
        type: 'spectatorWelcome',
        code: 'ABCDE',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects spectatorWelcome without code', () => {
      expect(validateServerMessage({ type: 'spectatorWelcome' })).toEqual({
        ok: false,
        error: 'Invalid spectatorWelcome payload',
      });
    });
  });

  describe('simple types', () => {
    it.each(['matchFound', 'rematchPending'] as const)('accepts %s', (type) => {
      const result = validateServerMessage({ type });
      expect(result.ok).toBe(true);
    });
  });

  describe('state-carrying messages', () => {
    const fakeState = {
      gameId: asGameId('G1'),
      phase: 'astrogation',
      ships: [],
    };

    it('accepts gameStart with state object', () => {
      const result = validateServerMessage({
        type: 'gameStart',
        state: fakeState,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects gameStart without state', () => {
      expect(validateServerMessage({ type: 'gameStart' })).toEqual({
        ok: false,
        error: 'Invalid gameStart payload',
      });
    });

    it('accepts movementResult with required arrays', () => {
      const result = validateServerMessage({
        type: 'movementResult',
        state: fakeState,
        movements: [],
        ordnanceMovements: [],
        events: [],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects movementResult with missing movements', () => {
      expect(
        validateServerMessage({
          type: 'movementResult',
          state: fakeState,
          ordnanceMovements: [],
          events: [],
        }),
      ).toEqual({ ok: false, error: 'Invalid movementResult payload' });
    });

    it('accepts combatResult with state and results', () => {
      const result = validateServerMessage({
        type: 'combatResult',
        state: fakeState,
        results: [],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects combatResult without results array', () => {
      expect(
        validateServerMessage({ type: 'combatResult', state: fakeState }),
      ).toEqual({ ok: false, error: 'Invalid combatResult payload' });
    });

    it('accepts stateUpdate with state', () => {
      const result = validateServerMessage({
        type: 'stateUpdate',
        state: fakeState,
      });
      expect(result.ok).toBe(true);
    });

    it('accepts stateUpdate with optional transferEvents', () => {
      const result = validateServerMessage({
        type: 'stateUpdate',
        state: fakeState,
        transferEvents: [
          {
            type: 'fuelTransferred',
            fromShipId: 'a',
            toShipId: 'b',
            amount: 1,
          },
        ],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('gameOver', () => {
    it('accepts valid gameOver', () => {
      const result = validateServerMessage({
        type: 'gameOver',
        winner: 1,
        reason: 'Fleet eliminated!',
        ratingDelta: 18,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects gameOver with invalid winner', () => {
      expect(
        validateServerMessage({ type: 'gameOver', winner: 3, reason: 'x' }),
      ).toEqual({ ok: false, error: 'Invalid gameOver payload' });
    });
  });

  describe('chat', () => {
    it('accepts valid chat', () => {
      const result = validateServerMessage({
        type: 'chat',
        playerId: 0,
        text: 'hello',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects chat without playerId', () => {
      expect(validateServerMessage({ type: 'chat', text: 'hi' })).toEqual({
        ok: false,
        error: 'Invalid chat payload',
      });
    });
  });

  describe('error', () => {
    it('accepts error with message', () => {
      const result = validateServerMessage({
        type: 'error',
        message: 'Bad request',
      });
      expect(result.ok).toBe(true);
    });

    it('accepts error with optional code', () => {
      const result = validateServerMessage({
        type: 'error',
        message: 'Bad request',
        code: 'INVALID_INPUT',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects error without message', () => {
      expect(validateServerMessage({ type: 'error' })).toEqual({
        ok: false,
        error: 'Invalid error payload',
      });
    });
  });

  describe('pong', () => {
    it('accepts valid pong', () => {
      const result = validateServerMessage({ type: 'pong', t: 12345 });
      expect(result.ok).toBe(true);
    });

    it('rejects pong with non-finite t', () => {
      expect(
        validateServerMessage({ type: 'pong', t: Number.POSITIVE_INFINITY }),
      ).toEqual({ ok: false, error: 'Invalid pong payload' });
    });

    it('rejects pong without t', () => {
      expect(validateServerMessage({ type: 'pong' })).toEqual({
        ok: false,
        error: 'Invalid pong payload',
      });
    });
  });
});

describe('ActionGuards in C2S messages', () => {
  it('attaches well-formed guards to the validated message', () => {
    const result = validateClientMessage({
      type: 'skipCombat',
      guards: {
        expectedTurn: 5,
        expectedPhase: 'combat',
        idempotencyKey: 'turn5-skipCombat',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({
      type: 'skipCombat',
      guards: {
        expectedTurn: 5,
        expectedPhase: 'combat',
        idempotencyKey: 'turn5-skipCombat',
      },
    });
  });

  it('omits guards entirely when no valid fields are present', () => {
    const result = validateClientMessage({
      type: 'skipCombat',
      guards: { expectedTurn: 'not-a-number', expectedPhase: 'bogus' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ type: 'skipCombat' });
    expect(result.value).not.toHaveProperty('guards');
  });

  it('drops an out-of-range expectedTurn while keeping a valid phase', () => {
    const result = validateClientMessage({
      type: 'skipCombat',
      guards: { expectedTurn: -1, expectedPhase: 'combat' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({
      type: 'skipCombat',
      guards: { expectedPhase: 'combat' },
    });
  });

  it('drops an over-length idempotencyKey', () => {
    const longKey = 'x'.repeat(200);
    const result = validateClientMessage({
      type: 'skipCombat',
      guards: { idempotencyKey: longKey },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ type: 'skipCombat' });
  });

  it('accepts messages without a guards field', () => {
    const result = validateClientMessage({ type: 'skipCombat' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ type: 'skipCombat' });
  });
});
