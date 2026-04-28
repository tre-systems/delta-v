import {
  computeGroupRangeMod,
  computeGroupVelocityMod,
  getCombatStrength,
} from '../../combat';
import { hexDistance } from '../../hex';
import type { OrdnanceId, ShipId } from '../../ids';
import type { Ship } from '../../types';
import type { ShipRole } from '../logistics';
import {
  chooseBestPlan,
  type PlanDecision,
  type PlanIntent,
  planEvaluation,
} from '.';

export interface CombatTargetPlanInput {
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  score: number;
  passengerCarrier?: boolean;
  disabledTurns?: number;
}

export interface CombatTargetPlanAction {
  type: 'combatTarget';
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
}

export interface CombatAttackGroupPlanInput {
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  enemyShip: Ship | null;
  availableAttackers: readonly Ship[];
  shipRoles: ReadonlyMap<string, ShipRole>;
  minRollThreshold: number;
}

export interface CombatAttackGroupPlanAction {
  type: 'combatAttackGroup';
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  attackerIds: Ship['id'][];
  attackStrength: null;
}

export interface CombatHoldFirePlanAction {
  type: 'combatHoldFire';
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  reason: 'lowOdds' | 'protectPassengerCarrier';
}

const combatTargetIntent = (target: CombatTargetPlanInput): PlanIntent => {
  if (target.targetType === 'ordnance') {
    return 'defendAgainstOrdnance';
  }

  if (target.passengerCarrier) {
    return 'interceptPassengerCarrier';
  }

  if ((target.disabledTurns ?? 0) > 0) {
    return 'finishAttrition';
  }

  return 'attackThreat';
};

export const chooseCombatTargetPlan = (
  targets: readonly CombatTargetPlanInput[],
): PlanDecision<CombatTargetPlanAction> | null =>
  chooseBestPlan(
    targets.map((target) => {
      const intent = combatTargetIntent(target);

      return {
        id: `combat-target:${target.targetType}:${target.targetId}`,
        intent,
        action: {
          type: 'combatTarget' as const,
          targetId: target.targetId,
          targetType: target.targetType,
        },
        evaluation: planEvaluation({
          feasible: true,
          combat: target.score,
        }),
        diagnostics: [
          {
            reason:
              intent === 'interceptPassengerCarrier'
                ? 'target enemy passenger carrier'
                : intent === 'defendAgainstOrdnance'
                  ? 'target incoming ordnance'
                  : intent === 'finishAttrition'
                    ? 'finish disabled enemy'
                    : 'target combat threat',
            detail: `${target.targetType}:${target.targetId}`,
          },
        ],
      };
    }),
  );

export const chooseCombatAttackGroupPlan = (
  input: CombatAttackGroupPlanInput,
): PlanDecision<CombatAttackGroupPlanAction> | null => {
  if (input.availableAttackers.length === 0) return null;

  if (input.targetType === 'ordnance') {
    return chooseBestPlan([
      {
        id: `combat-attack-group:${input.targetType}:${input.targetId}:all`,
        intent: 'defendAgainstOrdnance',
        action: {
          type: 'combatAttackGroup',
          targetId: input.targetId,
          targetType: input.targetType,
          attackerIds: input.availableAttackers.map((attacker) => attacker.id),
          attackStrength: null,
        },
        evaluation: planEvaluation({
          feasible: true,
          survival: 30,
          combat: getCombatStrength([...input.availableAttackers]),
          effort: input.availableAttackers.length,
        }),
        diagnostics: [
          {
            reason: 'group available anti-ordnance fire',
            detail: `${input.targetType}:${input.targetId}`,
          },
        ],
      },
    ]);
  }

  const enemyShip = input.enemyShip;

  if (!enemyShip) return null;

  const roleDisciplinedAttackers = input.availableAttackers.filter(
    (attacker) =>
      input.shipRoles.get(attacker.id) !== 'race' ||
      hexDistance(attacker.position, enemyShip.position) <= 2,
  );
  const roleAvailable =
    roleDisciplinedAttackers.length > 0
      ? roleDisciplinedAttackers
      : input.availableAttackers;
  const nonPassengerAttackers = roleAvailable.filter(
    (attacker) => (attacker.passengersAboard ?? 0) === 0,
  );
  const available =
    nonPassengerAttackers.length > 0 ? nonPassengerAttackers : roleAvailable;
  const attackStrength = getCombatStrength([...available]);
  const defendStrength = getCombatStrength([enemyShip]);
  const rangeMod = computeGroupRangeMod([...available], enemyShip);
  const velMod = computeGroupVelocityMod([...available], enemyShip);

  if (
    6 - rangeMod - velMod < input.minRollThreshold &&
    attackStrength <= defendStrength
  ) {
    return null;
  }

  if (
    nonPassengerAttackers.length === 0 &&
    available.some((attacker) => (attacker.passengersAboard ?? 0) > 0) &&
    enemyShip.damage.disabledTurns === 0 &&
    attackStrength <= defendStrength
  ) {
    return null;
  }

  const withheldObjectiveRunnerCount =
    input.availableAttackers.length - roleAvailable.length;
  const intent =
    withheldObjectiveRunnerCount > 0 ? 'screenObjectiveRunner' : 'attackThreat';

  return chooseBestPlan([
    {
      id: `combat-attack-group:${input.targetType}:${input.targetId}:${available
        .map((attacker) => attacker.id)
        .join('+')}`,
      intent,
      action: {
        type: 'combatAttackGroup',
        targetId: input.targetId,
        targetType: input.targetType,
        attackerIds: available.map((attacker) => attacker.id),
        attackStrength: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: intent === 'screenObjectiveRunner' ? 35 : 0,
        combat: attackStrength - defendStrength,
        risk: Math.max(0, input.minRollThreshold - (6 - rangeMod - velMod)),
        effort: available.length,
      }),
      diagnostics: [
        {
          reason:
            intent === 'screenObjectiveRunner'
              ? 'hold objective runner out of opportunistic attack'
              : 'group available attackers against target',
          detail: `${input.targetType}:${input.targetId}`,
        },
      ],
    },
  ]);
};

export const chooseCombatHoldFirePlan = (
  input: CombatAttackGroupPlanInput,
  reason: CombatHoldFirePlanAction['reason'],
): PlanDecision<CombatHoldFirePlanAction> =>
  chooseBestPlan([
    {
      id: `combat-hold-fire:${input.targetType}:${input.targetId}:${reason}`,
      intent:
        reason === 'protectPassengerCarrier'
          ? 'deliverPassengers'
          : 'attackThreat',
      action: {
        type: 'combatHoldFire',
        targetId: input.targetId,
        targetType: input.targetType,
        reason,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: reason === 'protectPassengerCarrier' ? 45 : 0,
        survival: reason === 'protectPassengerCarrier' ? 30 : 0,
        risk: reason === 'lowOdds' ? 3 : 0,
      }),
      diagnostics: [
        {
          reason:
            reason === 'protectPassengerCarrier'
              ? 'hold passenger carrier out of unfavorable combat'
              : 'hold fire because attack odds are below threshold',
          detail: `${input.targetType}:${input.targetId}`,
        },
      ],
    },
  ]) as PlanDecision<CombatHoldFirePlanAction>;
