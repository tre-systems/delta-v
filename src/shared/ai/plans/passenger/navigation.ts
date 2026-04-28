import { canAttack } from '../../../combat';
import { hexAdd, hexDistance } from '../../../hex';
import type { GameState, PlayerId, Ship } from '../../../types';
import { minBy } from '../../../util';
import type { PassengerDoctrineContext } from '../../doctrine';
import { chooseBestPlan, type PlanDecision, planEvaluation } from '..';
import type {
  PassengerCarrierEscortTargetAction,
  PassengerPostCarrierLossTargetAction,
} from './types';

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

  const carrierCompromised =
    carrier.damage.disabledTurns > 0 ||
    carrier.control !== 'own' ||
    carrier.lifecycle !== 'active';
  const rendezvousHex = carrierCompromised
    ? hexAdd(carrier.position, carrier.velocity)
    : null;

  return chooseBestPlan([
    {
      id: `passenger-carrier-escort-target:${ship.id}:${carrier.id}`,
      intent: 'escortCarrier',
      action: {
        type: 'navigationTargetOverride',
        shipId: ship.id,
        carrierShipId: carrier.id,
        threatShipId: nearestThreat.id,
        targetHex: rendezvousHex,
        targetBody: '',
      },
      evaluation: planEvaluation({
        feasible: true,
        objective: 45,
        survival: carrierCompromised ? 55 : 35,
        fuel: ship.fuel,
        combat: 20,
        formation: Math.max(
          0,
          10 - hexDistance(ship.position, rendezvousHex ?? carrier.position),
        ),
        tempo: Math.max(
          0,
          5 - hexDistance(carrier.position, nearestThreat.position),
        ),
        risk: hexDistance(carrier.position, nearestThreat.position),
      }),
      diagnostics: [
        {
          reason: carrierCompromised
            ? 'escort regroups with compromised passenger carrier'
            : 'escort drops objective navigation to protect carrier',
          detail:
            rendezvousHex == null
              ? `${ship.id} screens ${carrier.id} from ${nearestThreat.id}`
              : `${ship.id} targets ${rendezvousHex.q},${rendezvousHex.r} for ${carrier.id}`,
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
