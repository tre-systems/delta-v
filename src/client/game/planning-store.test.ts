import { describe, expect, it } from 'vitest';
import { asShipId } from '../../shared/ids';
import type { CombatAttack } from '../../shared/types/domain';
import { effect } from '../reactive';
import type { CombatTargetPlan } from './combat';
import { createPlanningStore } from './planning';

const createAttack = (overrides: Partial<CombatAttack> = {}): CombatAttack => ({
  attackerIds: [asShipId('ship-0')],
  targetId: asShipId('enemy'),
  targetType: 'ship',
  attackStrength: 2,
  ...overrides,
});

describe('planning', () => {
  it('resets astrogation planning state', () => {
    const planning = createPlanningStore();
    planning.selectedShipId = 'ship-0';
    planning.lastSelectedHex = '0,0';
    planning.burns.set('ship-0', 2);
    planning.overloads.set('ship-0', 4);
    planning.weakGravityChoices.set('ship-0', { '1,0': true });

    planning.resetAstrogationPlanning();

    expect(planning.selectedShipId).toBeNull();
    expect(planning.lastSelectedHex).toBeNull();
    expect(planning.burns.size).toBe(0);
    expect(planning.overloads.size).toBe(0);
    expect(planning.weakGravityChoices.size).toBe(0);
  });

  it('recreates the active phase plan on entry and drops stale phase state', () => {
    const planning = createPlanningStore();
    planning.setShipBurn('ship-0', 2);
    planning.queueOrdnanceLaunch({
      shipId: asShipId('ship-0'),
      ordnanceType: 'mine',
      torpedoAccel: null,
      torpedoAccelSteps: null,
    });
    planning.queueCombatAttack(createAttack());

    planning.enterPhase('combat', 'ship-1');

    expect(planning.selectedShipId).toBe('ship-1');
    expect(planning.burns.size).toBe(0);
    expect(planning.queuedOrdnanceLaunches).toEqual([]);
    expect(planning.queuedAttacks).toEqual([]);
  });

  it('selects ships and optionally updates the last clicked hex', () => {
    const planning = createPlanningStore();

    planning.selectShip('ship-1', '1,2');
    expect(planning.selectedShipId).toBe('ship-1');
    expect(planning.lastSelectedHex).toBe('1,2');

    planning.setSelectedShipId('ship-2');
    expect(planning.selectedShipId).toBe('ship-2');
    expect(planning.lastSelectedHex).toBe('1,2');
  });

  it('clears per-ship astrogation selections', () => {
    const planning = createPlanningStore();
    planning.burns.set('ship-0', 2);
    planning.overloads.set('ship-0', 4);
    planning.weakGravityChoices.set('ship-0', { '1,0': true });

    planning.clearShipPlanning('ship-0');

    expect(planning.burns.has('ship-0')).toBe(false);
    expect(planning.overloads.has('ship-0')).toBe(false);
    expect(planning.weakGravityChoices.has('ship-0')).toBe(false);
  });

  it('updates ship burn, overload, and weak-gravity choices', () => {
    const planning = createPlanningStore();
    planning.overloads.set('ship-0', 4);

    planning.setShipBurn('ship-0', 3, true);
    planning.setShipOverload('ship-1', 5);
    planning.setShipWeakGravityChoices('ship-1', { '2,2': true });

    expect(planning.burns.get('ship-0')).toBe(3);
    expect(planning.overloads.has('ship-0')).toBe(false);
    expect(planning.overloads.get('ship-1')).toBe(5);
    expect(planning.weakGravityChoices.get('ship-1')).toEqual({
      '2,2': true,
    });
  });

  it('applies and clears combat planning state', () => {
    const planning = createPlanningStore();
    const plan: CombatTargetPlan = {
      combatTargetId: 'enemy',
      combatTargetType: 'ship',
      combatAttackerIds: ['ship-0', 'ship-1'],
      combatAttackStrength: 3,
    };

    planning.applyCombatPlanUpdate(plan, 'ship-1');
    expect(planning.combatTargetId).toBe('enemy');
    expect(planning.combatAttackerIds).toEqual(['ship-0', 'ship-1']);
    expect(planning.combatAttackStrength).toBe(3);
    expect(planning.selectedShipId).toBe('ship-1');

    planning.clearCombatSelectionState();
    expect(planning.combatTargetId).toBeNull();
    expect(planning.combatTargetType).toBeNull();
    expect(planning.combatAttackerIds).toEqual([]);
    expect(planning.combatAttackStrength).toBeNull();
  });

  it('queues, pops, drains, and resets combat attacks', () => {
    const planning = createPlanningStore();

    expect(planning.queueCombatAttack(createAttack())).toBe(1);
    expect(
      planning.queueCombatAttack(
        createAttack({ targetId: asShipId('enemy-2') }),
      ),
    ).toBe(2);
    expect(planning.popQueuedAttack()).toBe(1);

    const drained = planning.takeQueuedAttacks();
    expect(drained).toHaveLength(1);
    expect(planning.queuedAttacks).toEqual([]);

    planning.queueCombatAttack(createAttack());
    planning.combatTargetId = 'enemy';
    planning.resetCombatPlanning();
    expect(planning.queuedAttacks).toEqual([]);
    expect(planning.combatTargetId).toBeNull();
  });

  it('updates combat strength, torpedo acceleration, and hover state', () => {
    const planning = createPlanningStore();

    planning.setCombatAttackStrength(4);
    planning.setTorpedoAcceleration(2, 1);
    planning.setHoverHex({ q: 1, r: -1 });

    expect(planning.combatAttackStrength).toBe(4);
    expect(planning.torpedoAccel).toBe(2);
    expect(planning.torpedoAccelSteps).toBe(1);
    expect(planning.hoverHex).toEqual({ q: 1, r: -1 });

    planning.clearTorpedoAcceleration();
    expect(planning.torpedoAccel).toBeNull();
    expect(planning.torpedoAccelSteps).toBeNull();
  });

  it('bumps the revision signal when planning mutates', () => {
    const planning = createPlanningStore();
    const revisionSignal = planning.revisionSignal;
    if (!revisionSignal) {
      throw new Error(
        'Expected createPlanningStore to provide a revision signal',
      );
    }
    const revisions: number[] = [];
    const dispose = effect(() => {
      revisions.push(revisionSignal.value);
    });

    planning.setSelectedShipId('ship-1');
    planning.combatTargetId = 'enemy';
    planning.queuedAttacks = [createAttack()];
    planning.resetCombatPlanning();

    expect(revisions).toEqual([0, 1, 2]);

    dispose();
  });
});
