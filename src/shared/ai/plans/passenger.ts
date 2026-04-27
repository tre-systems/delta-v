import { canAttack, hasLineOfSight } from '../../combat';
import { hexAdd, hexDistance, hexVecLength } from '../../hex';
import { computeCourse } from '../../movement';
import type { GameState, PlayerId, Ship, SolarSystemMap } from '../../types';
import { minBy } from '../../util';
import {
  estimateTurnsToTargetLanding,
  findDirectionToward,
  planShortHorizonMovementToHex,
} from '../common';
import { chooseBestPlan, type PlanDecision } from '.';

export interface PassengerCombatPlanAction {
  type: 'skipCombat';
  carrierShipId: string;
  landingTurns: number;
}

export interface PostCarrierLossPursuitAction {
  type: 'astrogationOrder';
  shipId: string;
  targetShipId: string;
  interceptHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export const choosePassengerCombatPlan = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  enemyShips: readonly Ship[],
): PlanDecision<PassengerCombatPlanAction> | null => {
  const player = state.players[playerId];

  if (!state.scenarioRules.targetWinRequiresPassengers || !player.targetBody) {
    return null;
  }

  const candidates = state.ships
    .filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle === 'active' &&
        (ship.passengersAboard ?? 0) > 0,
    )
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
          },
          evaluation: {
            feasible: true,
            objective: 100 - landingTurns,
            survival: 20,
            landing: 50 - landingTurns,
            fuel: ship.fuel,
            combat: 0,
            formation: 0,
            tempo: 2 - landingTurns,
            risk: carrierUnderImmediateThreat ? 1 : 0,
            effort: landingTurns,
          },
          diagnostics: [
            {
              reason: 'passenger carrier has a near-term landing line',
              detail: `${ship.id} can land in ${landingTurns} turn(s)`,
            },
          ],
        },
      ];
    });

  return chooseBestPlan(candidates);
};

const hasLivePassengerCarrier = (state: GameState): boolean =>
  state.ships.some(
    (ship) => ship.lifecycle === 'active' && (ship.passengersAboard ?? 0) > 0,
  );

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
      evaluation: {
        feasible: true,
        objective: 0,
        survival: 0,
        landing: 0,
        fuel: ship.fuel - selected.course.fuelSpent,
        combat: Math.max(0, 12 - nextDistance),
        formation: 0,
        tempo: currentDistance - nextDistance,
        risk: selected.course.outcome === 'landing' ? 1 : 0,
        effort: selected.course.fuelSpent,
      },
      diagnostics: [
        {
          reason: 'passenger objective is gone; pursue remaining ships',
          detail: `${ship.id} closes on ${nearestEnemy.id}`,
        },
      ],
    },
  ]);
};
