import { hexDistance } from '../hex';
import type { GameState, PlayerId, Ship, SolarSystemMap } from '../types';
import { minBy } from '../util';
import { estimateTurnsToTargetLanding } from './common';
import {
  assignTurnShipRoles,
  getPrimaryPassengerCarrier,
  getThreateningEnemies,
  isPassengerEscortMission,
  type PassengerShipRole,
  type ShipRole,
} from './logistics';

export interface PassengerDoctrineContext {
  isPassengerMission: boolean;
  primaryCarrier: Ship | null;
  activeThreat: Ship | null;
  activeThreatDistance: number | null;
  carrierLandingTurns: number | null;
  threateningEnemies: readonly Ship[];
  shipRoles: ReadonlyMap<string, PassengerShipRole>;
}

export interface AIDoctrineContext {
  shipRoles: ReadonlyMap<string, ShipRole>;
  passenger: PassengerDoctrineContext;
}

const PASSENGER_SHIP_ROLES: ReadonlySet<ShipRole> = new Set([
  'carrier',
  'escort',
  'screen',
  'refuel',
]);

const isPassengerShipRole = (role: ShipRole): role is PassengerShipRole =>
  PASSENGER_SHIP_ROLES.has(role);

const buildPassengerShipRoles = (
  isPassengerMission: boolean,
  shipRoles: ReadonlyMap<string, ShipRole>,
): ReadonlyMap<string, PassengerShipRole> => {
  if (!isPassengerMission) return new Map();

  return new Map(
    [...shipRoles.entries()].filter(
      (entry): entry is [string, PassengerShipRole] =>
        isPassengerShipRole(entry[1]),
    ),
  );
};

export const buildPassengerDoctrineContext = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  shipRoles: ReadonlyMap<string, ShipRole>,
  enemyShips: readonly Ship[] = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  ),
): PassengerDoctrineContext => {
  const isPassengerMission = isPassengerEscortMission(state, playerId);
  const primaryCarrier = isPassengerMission
    ? getPrimaryPassengerCarrier(state, playerId, map)
    : null;
  const threateningEnemies = getThreateningEnemies([...enemyShips]);
  const activeThreat =
    primaryCarrier != null
      ? (minBy(threateningEnemies, (enemy) =>
          hexDistance(primaryCarrier.position, enemy.position),
        ) ?? null)
      : null;
  const activeThreatDistance =
    primaryCarrier != null && activeThreat != null
      ? hexDistance(primaryCarrier.position, activeThreat.position)
      : null;
  const targetBody = state.players[playerId]?.targetBody;
  const carrierLandingTurns =
    primaryCarrier != null && targetBody
      ? estimateTurnsToTargetLanding(
          primaryCarrier,
          targetBody,
          map,
          state.destroyedBases,
        )
      : null;

  return {
    isPassengerMission,
    primaryCarrier,
    activeThreat,
    activeThreatDistance,
    carrierLandingTurns,
    threateningEnemies,
    shipRoles: buildPassengerShipRoles(isPassengerMission, shipRoles),
  };
};

export const buildAIDoctrineContext = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  enemyShips?: readonly Ship[],
): AIDoctrineContext => {
  const shipRoles = assignTurnShipRoles(state, playerId, map);

  return {
    shipRoles,
    passenger: buildPassengerDoctrineContext(
      state,
      playerId,
      map,
      shipRoles,
      enemyShips,
    ),
  };
};
