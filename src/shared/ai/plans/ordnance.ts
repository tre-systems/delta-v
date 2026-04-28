import type { OrdnanceLaunch, Ship } from '../../types';
import {
  chooseBestPlan,
  type PlanDecision,
  type PlanIntent,
  planEvaluation,
} from '.';

export interface OrdnanceLaunchPlanAction {
  type: 'ordnanceLaunch';
  launch: OrdnanceLaunch;
}

export interface OrdnanceHoldPlanAction {
  type: 'ordnanceHold';
  shipId: Ship['id'];
  reason: 'preserveObjectiveRunner';
}

export const ordnanceLaunchIntent = (
  ordnanceType: OrdnanceLaunch['ordnanceType'],
): PlanIntent => {
  if (ordnanceType === 'nuke') return 'launchNuke';
  if (ordnanceType === 'torpedo') return 'launchTorpedo';
  return 'deployMine';
};

export const chooseOrdnanceLaunchPlan = (
  launch: OrdnanceLaunch,
  priority: number,
): PlanDecision<OrdnanceLaunchPlanAction> | null =>
  chooseBestPlan([
    {
      id: `ordnance-launch:${launch.shipId}:${launch.ordnanceType}`,
      intent: ordnanceLaunchIntent(launch.ordnanceType),
      action: {
        type: 'ordnanceLaunch',
        launch,
      },
      priority,
      evaluation: planEvaluation({
        feasible: true,
        combat:
          launch.ordnanceType === 'nuke'
            ? 40
            : launch.ordnanceType === 'torpedo'
              ? 25
              : 15,
        risk: launch.ordnanceType === 'nuke' ? 2 : 0,
        effort: 1,
      }),
    },
  ]);

export const chooseOrdnanceHoldPlan = (
  shipId: Ship['id'],
  reason: OrdnanceHoldPlanAction['reason'],
): PlanDecision<OrdnanceHoldPlanAction> =>
  chooseBestPlan([
    {
      id: `ordnance-hold:${shipId}:${reason}`,
      intent: 'screenObjectiveRunner',
      action: {
        type: 'ordnanceHold',
        shipId,
        reason,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 35,
      }),
    },
  ]) as PlanDecision<OrdnanceHoldPlanAction>;
