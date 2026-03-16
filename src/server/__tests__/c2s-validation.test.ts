import { describe, expect, it } from 'vitest';
import { validateC2SMessage } from '../c2s-validation';

describe('validateC2SMessage', () => {
  it('accepts valid messages for every C2S type', () => {
    const validMessages = [
      { type: 'fleetReady', purchases: [{ shipType: 'corvette' }] },
      {
        type: 'astrogation',
        orders: [
          {
            shipId: 'p0s0',
            burn: 2,
            overload: null,
            weakGravityChoices: { '0,1': true },
          },
        ],
      },
      {
        type: 'ordnance',
        launches: [{ shipId: 'p0s1', ordnanceType: 'torpedo', torpedoAccel: 3, torpedoAccelSteps: 2 }],
      },
      { type: 'emplaceBase', emplacements: [{ shipId: 'p0s2' }] },
      { type: 'skipOrdnance' },
      { type: 'beginCombat' },
      {
        type: 'combat',
        attacks: [{ attackerIds: ['p0s0'], targetId: 'p1s0', targetType: 'ship', attackStrength: 2 }],
      },
      { type: 'skipCombat' },
      { type: 'rematch' },
      { type: 'ping', t: Date.now() },
    ] as const;

    for (const message of validMessages) {
      const result = validateC2SMessage(message);
      expect(result.ok, JSON.stringify(message)).toBe(true);
    }
  });

  it('rejects non-object messages', () => {
    expect(validateC2SMessage('not-an-object')).toEqual({
      ok: false,
      error: 'Invalid message: expected object, received string',
    });
  });

  it('rejects unknown message types', () => {
    expect(validateC2SMessage({ type: 'warpDrive' })).toEqual({
      ok: false,
      error: 'Invalid message.type: unsupported "warpDrive". Expected one of fleetReady, astrogation, ordnance, emplaceBase, skipOrdnance, beginCombat, combat, skipCombat, rematch, ping',
    });
  });

  it('rejects unexpected fields', () => {
    expect(validateC2SMessage({ type: 'skipCombat', extra: true })).toEqual({
      ok: false,
      error: 'Invalid skipCombat message: unexpected field "extra"',
    });
  });

  it('rejects astrogation orders with non-direction burn values', () => {
    expect(validateC2SMessage({
      type: 'astrogation',
      orders: [{ shipId: 'p0s0', burn: 1.5 }],
    })).toEqual({
      ok: false,
      error: 'Invalid orders[0].burn: expected integer direction 0-5 or null',
    });
  });

  it('rejects invalid weakGravityChoices value types', () => {
    expect(validateC2SMessage({
      type: 'astrogation',
      orders: [{ shipId: 'p0s0', burn: null, weakGravityChoices: { '0,1': 'yes' } }],
    })).toEqual({
      ok: false,
      error: 'Invalid orders[0].weakGravityChoices.0,1: expected boolean, received string',
    });
  });

  it('rejects invalid ordnance type values', () => {
    expect(validateC2SMessage({
      type: 'ordnance',
      launches: [{ shipId: 'p0s0', ordnanceType: 'laser' }],
    })).toEqual({
      ok: false,
      error: 'Invalid launches[0].ordnanceType: expected "mine", "torpedo", or "nuke"',
    });
  });

  it('rejects combat attacks with invalid attackerIds shapes', () => {
    expect(validateC2SMessage({
      type: 'combat',
      attacks: [{ attackerIds: ['p0s0', 2], targetId: 'p1s0' }],
    })).toEqual({
      ok: false,
      error: 'Invalid attacks[0].attackerIds[1]: expected string, received number',
    });
  });

  it('rejects ping messages with non-numeric timestamps', () => {
    expect(validateC2SMessage({ type: 'ping', t: 'now' })).toEqual({
      ok: false,
      error: 'Invalid ping.t: expected finite number, received string',
    });
  });
});
