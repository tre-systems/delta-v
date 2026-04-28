import { hexAdd, hexDistance, hexVecLength } from '../../../hex';
import { computeCourse } from '../../../movement';
import type { GameState, Ship, SolarSystemMap } from '../../../types';
import { minBy } from '../../../util';
import {
  findDirectionToward,
  planShortHorizonMovementToHex,
} from '../../common';
import { chooseBestPlan, type PlanDecision, planEvaluation } from '..';
import { hasLivePassengerCarrier } from './shared';
import type {
  PassengerCarrierInterceptAction,
  PostCarrierLossPursuitAction,
} from './types';

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
