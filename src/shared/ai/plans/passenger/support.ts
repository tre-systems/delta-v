import { canAttack } from '../../../combat';
import { hexAdd, hexDistance, hexEqual, hexVecLength } from '../../../hex';
import { computeCourse } from '../../../movement';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../../types';
import {
  findDirectionToward,
  planShortHorizonMovementToHex,
} from '../../common';
import type { PassengerDoctrineContext } from '../../doctrine';
import { chooseBestPlan, type PlanDecision, planEvaluation } from '..';
import { findPrimaryPassengerCarrier } from './shared';
import type {
  PassengerDeliveryApproachAction,
  PassengerEscortFormationAction,
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

  if (primaryCarrier == null || primaryCarrier.id === ship.id) {
    return null;
  }

  const carrierOrder = plannedOrders.find(
    (order) => order.shipId === primaryCarrier.id,
  );

  if (!carrierOrder) {
    return null;
  }

  const carrierCourse = computeCourse(primaryCarrier, carrierOrder.burn, map, {
    ...(carrierOrder.overload !== null
      ? { overload: carrierOrder.overload }
      : {}),
    ...(carrierOrder.land ? { land: true } : {}),
    destroyedBases: state.destroyedBases,
  });

  if (carrierCourse.outcome === 'crash') {
    return null;
  }

  if (
    hexEqual(primaryCarrier.position, ship.position) &&
    primaryCarrier.velocity.dq === ship.velocity.dq &&
    primaryCarrier.velocity.dr === ship.velocity.dr
  ) {
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
  }

  if (carrierCourse.outcome === 'landing') {
    return null;
  }

  const targetHex = carrierCourse.destination;
  const plan = planShortHorizonMovementToHex(
    ship,
    targetHex,
    map,
    state.destroyedBases,
  );
  const burn = plan?.firstBurn ?? findDirectionToward(ship.position, targetHex);

  if (burn === null) {
    return null;
  }

  const course = computeCourse(ship, burn, map, {
    destroyedBases: state.destroyedBases,
  });

  if (course.outcome === 'crash') {
    return null;
  }

  const currentDistance = hexDistance(ship.position, targetHex);
  const newDistance = hexDistance(course.destination, targetHex);

  if (newDistance >= currentDistance) {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-fuel-support-regroup:${ship.id}:${primaryCarrier.id}`,
      intent: 'supportPassengerCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        carrierShipId: primaryCarrier.id,
        burn,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 30,
        survival: 0,
        fuel: ship.fuel - course.fuelSpent,
        formation: Math.max(0, currentDistance - newDistance) * 10,
        tempo: 3,
        risk: newDistance,
        effort: course.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'detached tanker regroups with passenger carrier',
          detail: `${ship.id} closes on ${primaryCarrier.id}`,
        },
      ],
    },
  ]);
};

export const choosePassengerEscortFormationPlan = (
  state: GameState,
  ship: Ship,
  primaryCarrier: Ship | null,
  enemyShips: readonly Ship[],
  map: SolarSystemMap,
): PlanDecision<PassengerEscortFormationAction> | null => {
  if (
    primaryCarrier == null ||
    ship.id === primaryCarrier.id ||
    ship.owner !== primaryCarrier.owner ||
    ship.lifecycle !== 'active' ||
    ship.fuel <= 0 ||
    !canAttack(ship) ||
    (ship.passengersAboard ?? 0) > 0 ||
    hexVecLength(ship.velocity) !== 0
  ) {
    return null;
  }

  const closeThreat = enemyShips.some(
    (enemy) =>
      enemy.lifecycle !== 'destroyed' &&
      canAttack(enemy) &&
      hexDistance(ship.position, enemy.position) <= 2,
  );

  if (closeThreat || hexDistance(ship.position, primaryCarrier.position) <= 3) {
    return null;
  }

  const targetHex = hexAdd(primaryCarrier.position, primaryCarrier.velocity);
  const plan = planShortHorizonMovementToHex(
    ship,
    targetHex,
    map,
    state.destroyedBases,
  );
  const burn = plan?.firstBurn ?? findDirectionToward(ship.position, targetHex);

  if (burn == null) {
    return null;
  }

  const course = computeCourse(ship, burn, map, {
    destroyedBases: state.destroyedBases,
  });

  if (course.outcome === 'crash') {
    return null;
  }

  const currentTargetDistance = hexDistance(ship.position, targetHex);
  const newTargetDistance = hexDistance(course.destination, targetHex);

  if (newTargetDistance >= currentTargetDistance) {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-escort-formation:${ship.id}:${primaryCarrier.id}`,
      intent: 'escortCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        carrierShipId: primaryCarrier.id,
        targetHex,
        burn,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 35,
        survival: 10,
        fuel: ship.fuel - course.fuelSpent,
        formation: Math.max(0, currentTargetDistance - newTargetDistance) * 20,
        tempo: 5,
        risk: hexDistance(course.destination, primaryCarrier.position),
        effort: course.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'idle passenger escort regroups toward carrier formation',
          detail: `${ship.id} closes on ${primaryCarrier.id}`,
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
