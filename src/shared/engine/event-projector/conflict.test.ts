import { describe, expect, it } from 'vitest';
import { must } from '../../assert';
import { DAMAGE_ELIMINATION_THRESHOLD } from '../../constants';
import { asOrdnanceId, asShipId } from '../../ids';
import {
  createTestOrdnance,
  createTestShip,
  createTestState,
} from '../../test-helpers';
import type { GameState } from '../../types/domain';
import { projectConflictEvent } from './conflict';
import type { ConflictProjectionEvent } from './support';

// Convenience: a minimal state with one ship and one ordnance.
const baseState = (): GameState =>
  createTestState({
    ships: [
      createTestShip({ id: asShipId('s1'), owner: 0 }),
      createTestShip({ id: asShipId('s2'), owner: 1 }),
    ],
    ordnance: [
      createTestOrdnance({
        id: asOrdnanceId('ord1'),
        owner: 0,
        sourceShipId: asShipId('s1'),
      }),
    ],
  });

describe('projectConflictEvent', () => {
  // ----- ordnanceLaunched -----

  it('returns error when state is null (ordnanceLaunched)', () => {
    const event: ConflictProjectionEvent = {
      type: 'ordnanceLaunched',
      ordnanceId: asOrdnanceId('ord2'),
      ordnanceType: 'torpedo',
      owner: 0,
      sourceShipId: asShipId('s1'),
      position: { q: 1, r: 2 },
      velocity: { dq: 0, dr: 1 },
      turnsRemaining: 5,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(null, event);
    expect(result.ok).toBe(false);
  });

  it('launches a torpedo and increases cargoUsed', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceLaunched',
      ordnanceId: asOrdnanceId('ord2'),
      ordnanceType: 'torpedo',
      owner: 0,
      sourceShipId: asShipId('s1'),
      position: { q: 1, r: 2 },
      velocity: { dq: 0, dr: 1 },
      turnsRemaining: 5,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ordnance).toHaveLength(2);
    expect(must(result.value.ships.find((s) => s.id === 's1')).cargoUsed).toBe(
      20,
    );
  });

  it('increments nukesLaunchedSinceResupply for nuke launches', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceLaunched',
      ordnanceId: asOrdnanceId('ord2'),
      ordnanceType: 'nuke',
      owner: 0,
      sourceShipId: asShipId('s1'),
      position: { q: 1, r: 2 },
      velocity: { dq: 0, dr: 1 },
      turnsRemaining: 5,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's1'));
    expect(ship.nukesLaunchedSinceResupply).toBe(1);
  });

  it('returns error for missing source ship on ordnanceLaunched', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceLaunched',
      ordnanceId: asOrdnanceId('ord2'),
      ordnanceType: 'torpedo',
      owner: 0,
      sourceShipId: asShipId('nonexistent'),
      position: { q: 1, r: 2 },
      velocity: { dq: 0, dr: 1 },
      turnsRemaining: 5,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });

  // ----- ordnanceMoved -----

  it('updates ordnance position and velocity on ordnanceMoved', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceMoved',
      ordnanceId: asOrdnanceId('ord1'),
      position: { q: 5, r: 5 },
      velocity: { dq: 1, dr: -1 },
      turnsRemaining: 2,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ord = must(result.value.ordnance.find((o) => o.id === 'ord1'));
    expect(ord.position).toEqual({ q: 5, r: 5 });
    expect(ord.velocity).toEqual({ dq: 1, dr: -1 });
    expect(ord.turnsRemaining).toBe(2);
  });

  it('returns error for missing ordnance on ordnanceMoved', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceMoved',
      ordnanceId: asOrdnanceId('missing'),
      position: { q: 5, r: 5 },
      velocity: { dq: 1, dr: -1 },
      turnsRemaining: 2,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });

  it('clears pendingAstrogationOrders on ordnanceMoved', () => {
    const state = baseState();
    state.pendingAstrogationOrders = [];
    const event: ConflictProjectionEvent = {
      type: 'ordnanceMoved',
      ordnanceId: asOrdnanceId('ord1'),
      position: { q: 5, r: 5 },
      velocity: { dq: 1, dr: -1 },
      turnsRemaining: 2,
      pendingGravityEffects: [],
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingAstrogationOrders).toBeNull();
  });

  // ----- ordnanceExpired -----

  it('removes ordnance on ordnanceExpired', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceExpired',
      ordnanceId: asOrdnanceId('ord1'),
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ordnance).toHaveLength(0);
  });

  // ----- ordnanceDestroyed -----

  it('removes ordnance on ordnanceDestroyed', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDestroyed',
      ordnanceId: asOrdnanceId('ord1'),
      cause: 'antiNuke',
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ordnance).toHaveLength(0);
  });

  it('returns error for missing ordnance on ordnanceDestroyed', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDestroyed',
      ordnanceId: asOrdnanceId('missing'),
      cause: 'antiNuke',
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });

  // ----- ordnanceDetonated -----

  it('does nothing when ordnanceDetonated has no target', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDetonated',
      ordnanceId: asOrdnanceId('ord1'),
      ordnanceType: 'nuke',
      hex: { q: 0, r: 0 },
      roll: 3,
      damageType: 'none',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
  });

  it('does nothing when ordnanceDetonated damageType is none', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDetonated',
      ordnanceId: asOrdnanceId('ord1'),
      ordnanceType: 'nuke',
      hex: { q: 0, r: 0 },
      targetShipId: asShipId('s1'),
      roll: 3,
      damageType: 'none',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's1')).damage.disabledTurns,
    ).toBe(0);
  });

  it('adds disabledTurns on ordnanceDetonated with disabled damage', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDetonated',
      ordnanceId: asOrdnanceId('ord1'),
      ordnanceType: 'nuke',
      hex: { q: 0, r: 0 },
      targetShipId: asShipId('s1'),
      roll: 3,
      damageType: 'disabled',
      disabledTurns: 3,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's1')).damage.disabledTurns,
    ).toBe(3);
  });

  it('returns error for missing target ship on ordnanceDetonated', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ordnanceDetonated',
      ordnanceId: asOrdnanceId('ord1'),
      ordnanceType: 'nuke',
      hex: { q: 0, r: 0 },
      targetShipId: asShipId('nonexistent'),
      roll: 3,
      damageType: 'disabled',
      disabledTurns: 3,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });

  // ----- ramming -----

  it('does nothing on ramming with damageType none', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ramming',
      shipId: asShipId('s1'),
      otherShipId: asShipId('s2'),
      hex: { q: 0, r: 0 },
      roll: 1,
      damageType: 'none',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's1')).damage.disabledTurns,
    ).toBe(0);
  });

  it('does nothing on ramming with damageType eliminated', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ramming',
      shipId: asShipId('s1'),
      otherShipId: asShipId('s2'),
      hex: { q: 0, r: 0 },
      roll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ship should not be modified (eliminated handled elsewhere)
    expect(must(result.value.ships.find((s) => s.id === 's1')).lifecycle).toBe(
      'active',
    );
  });

  it('adds disabledTurns on ramming with disabled damage', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ramming',
      shipId: asShipId('s1'),
      otherShipId: asShipId('s2'),
      hex: { q: 0, r: 0 },
      roll: 4,
      damageType: 'disabled',
      disabledTurns: 2,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's1')).damage.disabledTurns,
    ).toBe(2);
  });

  it('returns error for missing ship on ramming', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'ramming',
      shipId: asShipId('nonexistent'),
      otherShipId: asShipId('s2'),
      hex: { q: 0, r: 0 },
      roll: 4,
      damageType: 'disabled',
      disabledTurns: 2,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });

  // ----- combatAttack -----

  it('does nothing on combatAttack targeting ordnance', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asOrdnanceId('ord1'),
      targetType: 'ordnance',
      attackType: 'antiNuke',
      roll: 6,
      modifiedRoll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
  });

  it('does nothing on combatAttack with damageType none', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 1,
      modifiedRoll: 1,
      damageType: 'none',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's2')).damage.disabledTurns,
    ).toBe(0);
  });

  it('destroys ship on combatAttack with eliminated damage', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 6,
      modifiedRoll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's2'));
    expect(ship.lifecycle).toBe('destroyed');
    expect(ship.deathCause).toBe('gun');
    expect(ship.killedBy).toBe('s1');
    expect(ship.velocity).toEqual({ dq: 0, dr: 0 });
  });

  it('sets killedBy to null when attackerIds is empty on eliminated', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 6,
      modifiedRoll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's2'));
    expect(ship.killedBy).toBeNull();
  });

  it('adds disabledTurns on combatAttack with disabled damage', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 2,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      must(result.value.ships.find((s) => s.id === 's2')).damage.disabledTurns,
    ).toBe(2);
  });

  it('destroys ship when cumulative disabledTurns reaches threshold', () => {
    const state = baseState();
    // Pre-load the ship with damage just below the threshold
    const targetShip = must(state.ships.find((s) => s.id === 's2'));
    targetShip.damage.disabledTurns = DAMAGE_ELIMINATION_THRESHOLD - 1;

    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 1,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's2'));
    expect(ship.lifecycle).toBe('destroyed');
    expect(ship.deathCause).toBe('gun');
    expect(ship.killedBy).toBe('s1');
    expect(ship.velocity).toEqual({ dq: 0, dr: 0 });
    expect(ship.damage.disabledTurns).toBe(DAMAGE_ELIMINATION_THRESHOLD);
  });

  it('destroys ship when cumulative disabledTurns exceeds threshold', () => {
    const state = baseState();
    const targetShip = must(state.ships.find((s) => s.id === 's2'));
    targetShip.damage.disabledTurns = DAMAGE_ELIMINATION_THRESHOLD - 2;

    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 3,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's2'));
    expect(ship.lifecycle).toBe('destroyed');
    expect(ship.deathCause).toBe('gun');
  });

  it('does not destroy ship when disabledTurns stays below threshold', () => {
    const state = baseState();
    const targetShip = must(state.ships.find((s) => s.id === 's2'));
    targetShip.damage.disabledTurns = 1;

    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId('s2'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 1,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ship = must(result.value.ships.find((s) => s.id === 's2'));
    expect(ship.lifecycle).toBe('active');
    expect(ship.damage.disabledTurns).toBe(2);
  });

  it('returns error for missing target ship on combatAttack', () => {
    const state = baseState();
    const event: ConflictProjectionEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('s1')],
      targetId: asShipId(
        'nonexistent',
      ) as unknown as import('../../ids').OrdnanceId,
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 2,
    };
    const result = projectConflictEvent(state, event);
    expect(result.ok).toBe(false);
  });
});
