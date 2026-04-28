import { hexDistance, hexEqual, hexVecLength } from '../../../hex';
import { computeCourse } from '../../../movement';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../../types';
import { planShortHorizonMovementToHex } from '../../common';
import type { PassengerDoctrineContext } from '../../doctrine';
import { chooseBestPlan, type PlanDecision, planEvaluation } from '..';
import { findPrimaryPassengerCarrier } from './shared';
import type {
  PassengerDeliveryApproachAction,
  PassengerFuelSupportAction,
} from './types';

export const choosePassengerFuelSupportPlan = (
  state: GameState,
  playerId: PlayerId,
  ship: Ship,
  plannedOrders: readonly AstrogationOrder[],
  map: SolarSystemMap,
  passengerContext?: PassengerDoctrineContext,
): PlanDecision<PassengerFuelSupportAction> | null => {
  const player = state.players[playerId];
  const isPassengerMission =
    passengerContext?.isPassengerMission ??
    state.scenarioRules.targetWinRequiresPassengers;

  if (
    !isPassengerMission ||
    !player?.targetBody ||
    ship.type !== 'tanker' ||
    ship.lifecycle === 'destroyed' ||
    ship.damage.disabledTurns > 0
  ) {
    return null;
  }

  const primaryCarrier =
    passengerContext?.primaryCarrier ??
    findPrimaryPassengerCarrier(state, playerId);

  if (
    primaryCarrier == null ||
    primaryCarrier.id === ship.id ||
    !hexEqual(primaryCarrier.position, ship.position) ||
    primaryCarrier.velocity.dq !== ship.velocity.dq ||
    primaryCarrier.velocity.dr !== ship.velocity.dr
  ) {
    return null;
  }

  const carrierOrder = plannedOrders.find(
    (order) => order.shipId === primaryCarrier.id,
  );

  if (!carrierOrder) {
    return null;
  }

  const mirroredCourse = computeCourse(ship, carrierOrder.burn, map, {
    destroyedBases: state.destroyedBases,
  });

  if (mirroredCourse.outcome === 'crash') {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-fuel-support:${ship.id}:${primaryCarrier.id}`,
      intent: 'supportPassengerCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        carrierShipId: primaryCarrier.id,
        burn: carrierOrder.burn,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 40,
        survival: 0,
        fuel: ship.fuel - mirroredCourse.fuelSpent,
        formation: 50,
        risk: mirroredCourse.outcome === 'landing' ? 1 : 0,
        effort: mirroredCourse.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'tanker mirrors passenger carrier for fuel support',
          detail: `${ship.id} follows ${primaryCarrier.id}`,
        },
      ],
    },
  ]);
};

export const choosePassengerDeliveryApproachPlan = (
  state: GameState,
  ship: Ship,
  primaryCarrier: Ship | null,
  targetHex: { q: number; r: number } | null,
  map: SolarSystemMap,
): PlanDecision<PassengerDeliveryApproachAction> | null => {
  if (
    primaryCarrier == null ||
    targetHex == null ||
    ship.id !== primaryCarrier.id ||
    ship.lifecycle !== 'active' ||
    ship.fuel <= 0 ||
    hexVecLength(ship.velocity) !== 0
  ) {
    return null;
  }

  const plan = planShortHorizonMovementToHex(
    ship,
    targetHex,
    map,
    state.destroyedBases,
  );

  if (plan?.firstBurn === null || plan?.firstBurn === undefined) {
    return null;
  }

  const course = computeCourse(ship, plan.firstBurn, map, {
    destroyedBases: state.destroyedBases,
  });

  if (course.outcome === 'crash') {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-delivery-approach:${ship.id}`,
      intent: 'deliverPassengers',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        targetHex,
        burn: plan.firstBurn,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 80,
        landing: Math.max(
          0,
          hexDistance(ship.position, targetHex) -
            hexDistance(course.destination, targetHex),
        ),
        fuel: ship.fuel - course.fuelSpent,
        tempo: 1,
        risk: course.outcome === 'landing' ? 1 : 0,
        effort: course.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'stationary passenger carrier starts target approach',
          detail: `${ship.id} burns toward ${targetHex.q},${targetHex.r}`,
        },
      ],
    },
  ]);
};
