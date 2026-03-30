import { describe, expect, it } from 'vitest';

import type { CombatAttack } from '../../shared/types/domain';
import { effect } from '../reactive';
import type { CombatTargetPlan } from './combat';
import { createInitialPlanningState } from './planning';
import {
  applyCombatPlanUpdate,
  clearCombatSelectionState,
  clearShipPlanning,
  clearTorpedoAcceleration,
  popQueuedAttack,
  queueCombatAttack,
  resetAstrogationPlanning,
  resetCombatPlanning,
  selectShip,
  setCombatAttackStrength,
  setHoverHex,
  setSelectedShipId,
  setShipBurn,
  setShipOverload,
  setShipWeakGravityChoices,
  setTorpedoAcceleration,
  takeQueuedAttacks,
} from './planning-store';

const createAttack = (overrides: Partial<CombatAttack> = {}): CombatAttack => ({
  attackerIds: ['ship-0'],
  targetId: 'enemy',
  targetType: 'ship',
  attackStrength: 2,
  ...overrides,
});

describe('planning-store', () => {
  it('resets astrogation planning state', () => {
    const planning = createInitialPlanningState();
    planning.selectedShipId = 'ship-0';
    planning.lastSelectedHex = '0,0';
    planning.burns.set('ship-0', 2);
    planning.overloads.set('ship-0', 4);
    planning.weakGravityChoices.set('ship-0', { '1,0': true });

    resetAstrogationPlanning(planning);

    expect(planning.selectedShipId).toBeNull();
    expect(planning.lastSelectedHex).toBeNull();
    expect(planning.burns.size).toBe(0);
    expect(planning.overloads.size).toBe(0);
    expect(planning.weakGravityChoices.size).toBe(0);
  });

  it('selects ships and optionally updates the last clicked hex', () => {
    const planning = createInitialPlanningState();

    selectShip(planning, 'ship-1', '1,2');
    expect(planning.selectedShipId).toBe('ship-1');
    expect(planning.lastSelectedHex).toBe('1,2');

    setSelectedShipId(planning, 'ship-2');
    expect(planning.selectedShipId).toBe('ship-2');
    expect(planning.lastSelectedHex).toBe('1,2');
  });

  it('clears per-ship astrogation selections', () => {
    const planning = createInitialPlanningState();
    planning.burns.set('ship-0', 2);
    planning.overloads.set('ship-0', 4);
    planning.weakGravityChoices.set('ship-0', { '1,0': true });

    clearShipPlanning(planning, 'ship-0');

    expect(planning.burns.has('ship-0')).toBe(false);
    expect(planning.overloads.has('ship-0')).toBe(false);
    expect(planning.weakGravityChoices.has('ship-0')).toBe(false);
  });

  it('updates ship burn, overload, and weak-gravity choices', () => {
    const planning = createInitialPlanningState();
    planning.overloads.set('ship-0', 4);

    setShipBurn(planning, 'ship-0', 3, true);
    setShipOverload(planning, 'ship-1', 5);
    setShipWeakGravityChoices(planning, 'ship-1', { '2,2': true });

    expect(planning.burns.get('ship-0')).toBe(3);
    expect(planning.overloads.has('ship-0')).toBe(false);
    expect(planning.overloads.get('ship-1')).toBe(5);
    expect(planning.weakGravityChoices.get('ship-1')).toEqual({
      '2,2': true,
    });
  });

  it('applies and clears combat planning state', () => {
    const planning = createInitialPlanningState();
    const plan: CombatTargetPlan = {
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0', 'ship-1'],
      combatAttackStrength: 3,
    };

    applyCombatPlanUpdate(planning, plan, 'ship-1');
    expect(planning.combatTargetId).toBe('enemy');
    expect(planning.combatAttackerIds).toEqual(['ship-0', 'ship-1']);
    expect(planning.combatAttackStrength).toBe(3);
    expect(planning.selectedShipId).toBe('ship-1');

    clearCombatSelectionState(planning);
    expect(planning.combatTargetId).toBeNull();
    expect(planning.combatTargetType).toBeNull();
    expect(planning.combatAttackerIds).toEqual([]);
    expect(planning.combatAttackStrength).toBeNull();
  });

  it('queues, pops, drains, and resets combat attacks', () => {
    const planning = createInitialPlanningState();

    expect(queueCombatAttack(planning, createAttack())).toBe(1);
    expect(
      queueCombatAttack(planning, createAttack({ targetId: 'enemy-2' })),
    ).toBe(2);
    expect(popQueuedAttack(planning)).toBe(1);

    const drained = takeQueuedAttacks(planning);
    expect(drained).toHaveLength(1);
    expect(planning.queuedAttacks).toEqual([]);

    queueCombatAttack(planning, createAttack());
    planning.combatTargetId = 'enemy';
    resetCombatPlanning(planning);
    expect(planning.queuedAttacks).toEqual([]);
    expect(planning.combatTargetId).toBeNull();
  });

  it('updates combat strength, torpedo acceleration, and hover state', () => {
    const planning = createInitialPlanningState();

    setCombatAttackStrength(planning, 4);
    setTorpedoAcceleration(planning, 2, 1);
    setHoverHex(planning, { q: 1, r: -1 });

    expect(planning.combatAttackStrength).toBe(4);
    expect(planning.torpedoAccel).toBe(2);
    expect(planning.torpedoAccelSteps).toBe(1);
    expect(planning.hoverHex).toEqual({ q: 1, r: -1 });

    clearTorpedoAcceleration(planning);
    expect(planning.torpedoAccel).toBeNull();
    expect(planning.torpedoAccelSteps).toBeNull();
  });

  it('bumps the revision signal when planning mutates', () => {
    const planning = createInitialPlanningState();
    const revisionSignal = planning.revisionSignal;
    if (!revisionSignal) {
      throw new Error(
        'Expected createInitialPlanningState to provide a revision signal',
      );
    }
    const revisions: number[] = [];
    const dispose = effect(() => {
      revisions.push(revisionSignal.value);
    });

    setSelectedShipId(planning, 'ship-1');
    planning.combatTargetId = 'enemy';
    planning.queuedAttacks = [createAttack()];
    resetCombatPlanning(planning);

    expect(revisions).toEqual([0, 1, 2]);

    dispose();
  });
});
