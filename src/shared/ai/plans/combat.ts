import type { OrdnanceId, ShipId } from '../../ids';
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
