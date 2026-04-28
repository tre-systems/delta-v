import { canAttack, hasLineOfSight } from '../../combat';
import { hexAdd, hexDistance, hexEqual, hexVecLength } from '../../hex';
import { computeCourse } from '../../movement';
import type {
  AstrogationOrder,
  GameState,
  Ordnance,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../types';
import { maxBy, minBy } from '../../util';
import {
  estimateTurnsToTargetLanding,
  findDirectionToward,
  planShortHorizonMovementToHex,
} from '../common';
import type { PassengerDoctrineContext } from '../doctrine';
import {
  chooseBestPlan,
  type PlanCandidate,
  type PlanDecision,
  planEvaluation,
} from '.';

export interface PassengerCombatPlanAction {
  type: 'skipCombat';
  carrierShipId: string;
  landingTurns: number | null;
  reason: 'preserveLandingLine' | 'avoidAttritionFinish';
}

export interface PostCarrierLossPursuitAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetShipId: Ship['id'];
  interceptHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export interface PassengerFuelSupportAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  carrierShipId: Ship['id'];
  burn: number | null;
  overload: null;
}

export interface PassengerDeliveryApproachAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export interface PassengerCarrierEscortTargetAction {
  type: 'navigationTargetOverride';
  shipId: Ship['id'];
  carrierShipId: Ship['id'];
  threatShipId: Ship['id'];
  targetHex: null;
  targetBody: '';
}

export interface PassengerPostCarrierLossTargetAction {
  type: 'navigationTargetOverride';
  shipId: Ship['id'];
  targetHex: null;
  targetBody: '';
}

export interface PassengerCarrierInterceptAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetShipId: Ship['id'];
  interceptHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export const choosePassengerCombatPlan = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  enemyShips: readonly Ship[],
  enemyOrdnance: readonly Ordnance[] = [],
  passengerContext?: PassengerDoctrineContext,
): PlanDecision<PassengerCombatPlanAction> | null => {
  const player = state.players[playerId];
  const isPassengerMission =
    passengerContext?.isPassengerMission ??
    state.scenarioRules.targetWinRequiresPassengers;

  if (!isPassengerMission || !player.targetBody) {
    return null;
  }

  const activePassengerCarriers = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle === 'active' &&
      (ship.passengersAboard ?? 0) > 0,
  );
  const candidates: PlanCandidate<PassengerCombatPlanAction>[] = state.ships
    .filter((ship) => activePassengerCarriers.includes(ship))
    .flatMap((ship) => {
      const landingTurns = estimateTurnsToTargetLanding(
        ship,
        player.targetBody,
        map,
        state.destroyedBases,
      );
      const carrierUnderImmediateThreat = enemyShips.some(
        (enemy) => canAttack(enemy) && hasLineOfSight(enemy, ship, map),
      );

      if (
        landingTurns === null ||
        landingTurns > 2 ||
        carrierUnderImmediateThreat
      ) {
        return [];
      }

      return [
        {
          id: `preserve-landing-line:${ship.id}`,
          intent: 'preserveLandingLine' as const,
          action: {
            type: 'skipCombat' as const,
            carrierShipId: ship.id,
            landingTurns,
            reason: 'preserveLandingLine' as const,
          },
          evaluation: planEvaluation({
            feasible: true,
            objective: 100 - landingTurns,
            survival: 20,
            landing: 50 - landingTurns,
            fuel: ship.fuel,
            tempo: 2 - landingTurns,
            risk: carrierUnderImmediateThreat ? 1 : 0,
            effort: landingTurns,
          }),
          diagnostics: [
            {
              reason: 'passenger carrier has a near-term landing line',
              detail: `${ship.id} can land in ${landingTurns} turn(s)`,
            },
          ],
        },
      ];
    });

  if (
    activePassengerCarriers.length > 0 &&
    enemyShips.length > 0 &&
    enemyOrdnance.length === 0 &&
    enemyShips.every((enemy) => !canAttack(enemy))
  ) {
    candidates.push(
      ...activePassengerCarriers.map((ship) => {
        const landingTurns = estimateTurnsToTargetLanding(
          ship,
          player.targetBody,
          map,
          state.destroyedBases,
        );

        return {
          id: `avoid-attrition-finish:${ship.id}`,
          intent: 'deliverPassengers' as const,
          action: {
            type: 'skipCombat' as const,
            carrierShipId: ship.id,
            landingTurns,
            reason: 'avoidAttritionFinish' as const,
          },
          evaluation: planEvaluation({
            feasible: true,
            objective: 70,
            survival: 10,
            landing: landingTurns == null ? 0 : Math.max(0, 20 - landingTurns),
            fuel: ship.fuel,
            tempo: landingTurns == null ? 0 : Math.max(0, 8 - landingTurns),
            effort: landingTurns ?? 10,
          }),
          diagnostics: [
            {
              reason: 'avoid ending passenger scenario by attrition',
              detail: `${ship.id} can keep pursuing passenger delivery`,
            },
          ],
        };
      }),
    );
  }

  return chooseBestPlan(candidates);
};

const hasLivePassengerCarrier = (state: GameState): boolean =>
  state.ships.some(
    (ship) => ship.lifecycle === 'active' && (ship.passengersAboard ?? 0) > 0,
  );

const findPrimaryPassengerCarrier = (
  state: GameState,
  playerId: PlayerId,
): Ship | null =>
  maxBy(
    state.ships.filter(
      (candidate) =>
        candidate.owner === playerId &&
        candidate.lifecycle !== 'destroyed' &&
        (candidate.passengersAboard ?? 0) > 0,
    ),
    (candidate) => (candidate.passengersAboard ?? 0) * 1000,
  ) ?? null;

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

export const choosePassengerCarrierEscortTargetPlan = (
  state: GameState,
  playerId: PlayerId,
  ship: Ship,
  primaryCarrier: Ship | null,
  enemyShips: readonly Ship[],
  passengerContext?: PassengerDoctrineContext,
): PlanDecision<PassengerCarrierEscortTargetAction> | null => {
  const player = state.players[playerId];
  const isPassengerMission =
    passengerContext?.isPassengerMission ??
    state.scenarioRules.targetWinRequiresPassengers;
  const carrier = passengerContext?.primaryCarrier ?? primaryCarrier;

  if (
    !isPassengerMission ||
    !player?.targetBody ||
    carrier == null ||
    ship.owner !== playerId ||
    ship.id === carrier.id ||
    !canAttack(ship) ||
    (ship.passengersAboard ?? 0) > 0
  ) {
    return null;
  }

  const nearestThreat =
    passengerContext?.activeThreat ??
    minBy(enemyShips.filter(canAttack), (enemy) =>
      hexDistance(carrier.position, enemy.position),
    );

  if (
    nearestThreat == null ||
    hexDistance(carrier.position, nearestThreat.position) > 5
  ) {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-carrier-escort-target:${ship.id}:${carrier.id}`,
      intent: 'escortCarrier',
      action: {
        type: 'navigationTargetOverride',
        shipId: ship.id,
        carrierShipId: carrier.id,
        threatShipId: nearestThreat.id,
        targetHex: null,
        targetBody: '',
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 45,
        survival: 35,
        fuel: ship.fuel,
        combat: 20,
        formation: Math.max(
          0,
          10 - hexDistance(ship.position, carrier.position),
        ),
        tempo: Math.max(
          0,
          5 - hexDistance(carrier.position, nearestThreat.position),
        ),
        risk: hexDistance(carrier.position, nearestThreat.position),
      }),
      diagnostics: [
        {
          reason: 'escort drops objective navigation to protect carrier',
          detail: `${ship.id} screens ${carrier.id} from ${nearestThreat.id}`,
        },
      ],
    },
  ]);
};

export const choosePassengerPostCarrierLossTargetPlan = (
  state: GameState,
  playerId: PlayerId,
  ship: Ship,
  primaryCarrier: Ship | null,
  passengerContext?: PassengerDoctrineContext,
): PlanDecision<PassengerPostCarrierLossTargetAction> | null => {
  const player = state.players[playerId];
  const isPassengerMission =
    passengerContext?.isPassengerMission ??
    state.scenarioRules.targetWinRequiresPassengers;
  const carrier = passengerContext?.primaryCarrier ?? primaryCarrier;

  if (
    !isPassengerMission ||
    !player?.targetBody ||
    carrier != null ||
    ship.owner !== playerId ||
    !canAttack(ship) ||
    (ship.passengersAboard ?? 0) > 0
  ) {
    return null;
  }

  return chooseBestPlan([
    {
      id: `passenger-post-carrier-loss-target:${ship.id}`,
      intent: 'postCarrierLossPursuit',
      action: {
        type: 'navigationTargetOverride',
        shipId: ship.id,
        targetHex: null,
        targetBody: '',
      },
      evaluation: planEvaluation({
        feasible: true,
        fuel: ship.fuel,
        combat: 20,
        tempo: 1,
      }),
      diagnostics: [
        {
          reason: 'passenger carrier is gone; release ship to pursue',
          detail: `${ship.id} drops passenger objective navigation`,
        },
      ],
    },
  ]);
};

export const choosePassengerCarrierInterceptPlan = (
  state: GameState,
  ship: Ship,
  targetCarrier: Ship,
  map: SolarSystemMap,
): PlanDecision<PassengerCarrierInterceptAction> | null => {
  if (!state.scenarioRules.targetWinRequiresPassengers) return null;
  if (ship.lifecycle !== 'active') return null;
  if (ship.fuel <= 0 || hexVecLength(ship.velocity) !== 0) return null;
  if ((targetCarrier.passengersAboard ?? 0) <= 0) return null;
  if (hexDistance(ship.position, targetCarrier.position) <= 2) return null;

  const interceptHex = hexAdd(targetCarrier.position, targetCarrier.velocity);
  const plan = planShortHorizonMovementToHex(
    ship,
    interceptHex,
    map,
    state.destroyedBases,
  );
  const fallbackBurn = findDirectionToward(ship.position, interceptHex);
  const correctiveBurn = plan?.firstBurn ?? fallbackBurn;
  const correctiveCourse = computeCourse(ship, correctiveBurn, map, {
    destroyedBases: state.destroyedBases,
  });
  const selected =
    correctiveCourse.outcome !== 'crash'
      ? { direction: correctiveBurn, course: correctiveCourse }
      : (() => {
          const currentDistance = hexDistance(ship.position, interceptHex);
          const directions = [0, 1, 2, 3, 4, 5] as const;

          return minBy(
            directions
              .map((direction) => ({
                direction,
                course: computeCourse(ship, direction, map, {
                  destroyedBases: state.destroyedBases,
                }),
              }))
              .filter(
                ({ course }) =>
                  course.outcome !== 'crash' &&
                  hexDistance(course.destination, interceptHex) <
                    currentDistance,
              ),
            ({ course }) => hexDistance(course.destination, interceptHex),
          );
        })();

  if (!selected) return null;

  const currentDistance = hexDistance(ship.position, interceptHex);
  const nextDistance = hexDistance(selected.course.destination, interceptHex);

  return chooseBestPlan([
    {
      id: `intercept-passenger-carrier:${ship.id}:${targetCarrier.id}`,
      intent: 'interceptPassengerCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        targetShipId: targetCarrier.id,
        interceptHex,
        burn: selected.direction,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 35,
        fuel: ship.fuel - selected.course.fuelSpent,
        combat: Math.max(0, 14 - nextDistance),
        tempo: currentDistance - nextDistance,
        risk: selected.course.outcome === 'landing' ? 1 : 0,
        effort: selected.course.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'intercept enemy passenger carrier',
          detail: `${ship.id} closes on ${targetCarrier.id}`,
        },
      ],
    },
  ]);
};

export const choosePostCarrierLossPursuitPlan = (
  state: GameState,
  ship: Ship,
  map: SolarSystemMap,
  enemyShips: readonly Ship[],
): PlanDecision<PostCarrierLossPursuitAction> | null => {
  if (!state.scenarioRules.targetWinRequiresPassengers) return null;
  if (hasLivePassengerCarrier(state)) return null;
  if (ship.lifecycle !== 'active') return null;
  if (ship.fuel <= 0 || hexVecLength(ship.velocity) !== 0) return null;

  const nearestEnemy = minBy(enemyShips, (enemy) =>
    hexDistance(ship.position, enemy.position),
  );

  if (!nearestEnemy || hexDistance(ship.position, nearestEnemy.position) <= 2) {
    return null;
  }

  const interceptHex = hexAdd(nearestEnemy.position, nearestEnemy.velocity);
  const plan = planShortHorizonMovementToHex(
    ship,
    interceptHex,
    map,
    state.destroyedBases,
  );
  const fallbackBurn = findDirectionToward(ship.position, interceptHex);
  const correctiveBurn = plan?.firstBurn ?? fallbackBurn;
  const correctiveCourse = computeCourse(ship, correctiveBurn, map, {
    destroyedBases: state.destroyedBases,
  });
  const selected =
    correctiveCourse.outcome !== 'crash'
      ? { direction: correctiveBurn, course: correctiveCourse }
      : (() => {
          const currentDistance = hexDistance(ship.position, interceptHex);
          const directions = [0, 1, 2, 3, 4, 5] as const;

          return minBy(
            directions
              .map((direction) => ({
                direction,
                course: computeCourse(ship, direction, map, {
                  destroyedBases: state.destroyedBases,
                }),
              }))
              .filter(
                ({ course }) =>
                  course.outcome !== 'crash' &&
                  hexDistance(course.destination, interceptHex) <
                    currentDistance,
              ),
            ({ course }) => hexDistance(course.destination, interceptHex),
          );
        })();

  if (!selected) return null;

  const currentDistance = hexDistance(ship.position, interceptHex);
  const nextDistance = hexDistance(selected.course.destination, interceptHex);

  return chooseBestPlan([
    {
      id: `post-carrier-loss-pursuit:${ship.id}:${nearestEnemy.id}`,
      intent: 'postCarrierLossPursuit',
      action: {
        type: 'astrogationOrder',
        shipId: ship.id,
        targetShipId: nearestEnemy.id,
        interceptHex,
        burn: selected.direction,
        overload: null,
      },
      evaluation: planEvaluation({
        feasible: true,
        fuel: ship.fuel - selected.course.fuelSpent,
        combat: Math.max(0, 12 - nextDistance),
        tempo: currentDistance - nextDistance,
        risk: selected.course.outcome === 'landing' ? 1 : 0,
        effort: selected.course.fuelSpent,
      }),
      diagnostics: [
        {
          reason: 'passenger objective is gone; pursue remaining ships',
          detail: `${ship.id} closes on ${nearestEnemy.id}`,
        },
      ],
    },
  ]);
};
