import { canAttack, hasLineOfSight } from '../../../combat';
import type {
  GameState,
  Ordnance,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../../types';
import { estimateTurnsToTargetLanding } from '../../common';
import type { PassengerDoctrineContext } from '../../doctrine';
import {
  chooseBestPlan,
  type PlanCandidate,
  type PlanDecision,
  planEvaluation,
} from '..';

import type { PassengerCombatPlanAction } from './types';

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
