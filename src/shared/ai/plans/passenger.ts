import { canAttack, hasLineOfSight } from '../../combat';
import type { GameState, PlayerId, Ship, SolarSystemMap } from '../../types';
import { estimateTurnsToTargetLanding } from '../common';
import { chooseBestPlan, type PlanDecision } from '.';

export interface PassengerCombatPlanAction {
  type: 'skipCombat';
  carrierShipId: string;
  landingTurns: number;
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
