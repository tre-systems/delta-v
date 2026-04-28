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

export interface OrdnanceRejectPlanAction {
  type: 'ordnanceReject';
  shipId: Ship['id'];
  ordnanceType: OrdnanceLaunch['ordnanceType'];
  reason: 'antiNukeReach';
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

export const chooseOrdnanceRejectPlan = (
  action: OrdnanceRejectPlanAction,
  diagnostics: {
    reachSurvival: number;
    requiredReachProbability: number;
    turnsToIntercept: number;
  },
): PlanDecision<OrdnanceRejectPlanAction> =>
  chooseBestPlan([
    {
      id: `ordnance-reject:${action.shipId}:${action.ordnanceType}:${action.reason}`,
      intent: ordnanceLaunchIntent(action.ordnanceType),
      action,
      evaluation: planEvaluation({
        feasible: false,
        combat: action.ordnanceType === 'nuke' ? 40 : 0,
        risk: 20,
      }),
      diagnostics: [
        {
          reason: 'reject nuke because anti-nuke reach odds are too strong',
          detail:
            `survival ${diagnostics.reachSurvival.toFixed(2)} < ` +
            `required ${diagnostics.requiredReachProbability.toFixed(2)} ` +
            `over ${diagnostics.turnsToIntercept} turn(s)`,
        },
      ],
    },
  ]) as PlanDecision<OrdnanceRejectPlanAction>;
