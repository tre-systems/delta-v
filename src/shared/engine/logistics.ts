import { must } from '../assert';
import { SHIP_STATS } from '../constants';
import { hexEqual } from '../hex';
import {
  type EngineError,
  ErrorCode,
  type GameState,
  type PlayerId,
  type Ship,
  type SolarSystemMap,
  type TransferOrder,
} from '../types';
import { shouldEnterCombatPhase } from './combat';
import type { EngineEvent } from './engine-events';
import { engineFailure, validatePhaseAction } from './util';
import { advanceTurn, checkGameEnd } from './victory';
export interface TransferPair {
  source: Ship;
  target: Ship;
  canTransferFuel: boolean;
  canTransferCargo: boolean;
  canTransferPassengers: boolean;
  maxFuel: number;
  maxCargo: number;
  maxPassengers: number;
}

const freeCargoCapacity = (ship: Ship, stats: ShipStatsLike): number => {
  if (stats.cargo === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  return stats.cargo - ship.cargoUsed - (ship.passengersAboard ?? 0);
};

type ShipStatsLike = { cargo: number };

const velocityMatch = (a: Ship, b: Ship): boolean =>
  a.velocity.dq === b.velocity.dq && a.velocity.dr === b.velocity.dr;
const isTransferEligibleSource = (ship: Ship, playerId: PlayerId): boolean => {
  if (ship.lifecycle !== 'active') return false;
  // Friendly ship: must be operational
  if (ship.owner === playerId) {
    return ship.control === 'own';
  }

  // Enemy ship: must be disabled or surrendered
  // (looting)
  return ship.damage.disabledTurns > 0 || ship.control === 'surrendered';
};

const isTransferEligibleTarget = (ship: Ship, playerId: PlayerId): boolean => {
  if (ship.lifecycle === 'destroyed') return false;
  return ship.owner === playerId && ship.control === 'own';
};
// Get all valid transfer pairs for a player.
// A pair requires same hex + same velocity.
// Friendly-to-friendly is unrestricted; enemy looting
// requires the source to be disabled or surrendered.
export const getTransferEligiblePairs = (
  state: GameState,
  playerId: PlayerId,
): TransferPair[] => {
  const pairs: TransferPair[] = [];
  const targets = state.ships.filter((s) =>
    isTransferEligibleTarget(s, playerId),
  );
  for (const source of state.ships) {
    if (!isTransferEligibleSource(source, playerId)) {
      continue;
    }

    if (source.baseStatus === 'emplaced') continue;
    const sourceStats = SHIP_STATS[source.type];

    if (!sourceStats) continue;
    for (const target of targets) {
      if (source.id === target.id) continue;

      if (!hexEqual(source.position, target.position)) {
        continue;
      }

      if (!velocityMatch(source, target)) continue;
      const targetStats = SHIP_STATS[target.type];

      if (!targetStats) continue;
      // Sealed fuel (torch ships) cannot be transferred (rulebook p.8)
      const canTransferFuel =
        !sourceStats.fuelSealed &&
        source.fuel > 0 &&
        target.fuel < targetStats.fuel;
      const maxFuel = canTransferFuel
        ? Math.min(source.fuel, targetStats.fuel - target.fuel)
        : 0;
      const sourceCargoLoaded = source.cargoUsed;
      const targetFree = freeCargoCapacity(target, targetStats);
      const canTransferCargo = sourceCargoLoaded > 0 && targetFree > 0;
      const maxCargo = canTransferCargo
        ? Math.min(sourceCargoLoaded, targetFree)
        : 0;
      const sourcePassengers = source.passengersAboard ?? 0;
      const passengerRescue = !!state.scenarioRules.passengerRescueEnabled;
      const canTransferPassengers =
        passengerRescue && sourcePassengers > 0 && targetFree > 0;
      const maxPassengers = canTransferPassengers
        ? Math.min(sourcePassengers, targetFree)
        : 0;

      if (canTransferFuel || canTransferCargo || canTransferPassengers) {
        pairs.push({
          source,
          target,
          canTransferFuel,
          canTransferCargo,
          canTransferPassengers,
          maxFuel,
          maxCargo,
          maxPassengers,
        });
      }
    }
  }

  return pairs;
};
// Check if the logistics phase should be entered
// after movement.
export const shouldEnterLogisticsPhase = (state: GameState): boolean => {
  if (!state.scenarioRules.logisticsEnabled) {
    return false;
  }
  return getTransferEligiblePairs(state, state.activePlayer).length > 0;
};

const validateTransfer = (
  state: GameState,
  playerId: PlayerId,
  transfer: TransferOrder,
): EngineError | null => {
  const source = state.ships.find((s) => s.id === transfer.sourceShipId);
  const target = state.ships.find((s) => s.id === transfer.targetShipId);

  if (!source || !target) {
    return engineFailure(ErrorCode.INVALID_SHIP, 'Ship not found').error;
  }

  if (!isTransferEligibleSource(source, playerId)) {
    return engineFailure(
      ErrorCode.NOT_ALLOWED,
      'Source ship not eligible for transfer',
    ).error;
  }

  if (!isTransferEligibleTarget(target, playerId)) {
    return engineFailure(
      ErrorCode.NOT_ALLOWED,
      'Target ship not eligible for transfer',
    ).error;
  }

  if (!hexEqual(source.position, target.position)) {
    return engineFailure(
      ErrorCode.INVALID_INPUT,
      'Ships must be in the same hex',
    ).error;
  }

  if (!velocityMatch(source, target)) {
    return engineFailure(
      ErrorCode.INVALID_INPUT,
      'Ships must have matching velocity',
    ).error;
  }

  if (transfer.amount <= 0) {
    return engineFailure(
      ErrorCode.INVALID_INPUT,
      'Transfer amount must be positive',
    ).error;
  }

  if (!Number.isInteger(transfer.amount)) {
    return engineFailure(
      ErrorCode.INVALID_INPUT,
      'Transfer amount must be an integer',
    ).error;
  }
  const sourceStats = SHIP_STATS[source.type];
  const targetStats = SHIP_STATS[target.type];

  if (!sourceStats || !targetStats) {
    return engineFailure(ErrorCode.INVALID_INPUT, 'Invalid ship type').error;
  }

  if (transfer.transferType === 'fuel') {
    if (sourceStats.fuelSealed) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Torch ships cannot transfer fuel',
      ).error;
    }

    if (transfer.amount > source.fuel) {
      return engineFailure(ErrorCode.RESOURCE_LIMIT, 'Insufficient fuel').error;
    }

    if (target.fuel + transfer.amount > targetStats.fuel) {
      return engineFailure(
        ErrorCode.RESOURCE_LIMIT,
        'Target fuel capacity exceeded',
      ).error;
    }
  } else if (transfer.transferType === 'cargo') {
    if (transfer.amount > source.cargoUsed) {
      return engineFailure(ErrorCode.RESOURCE_LIMIT, 'Insufficient cargo')
        .error;
    }
    const space = freeCargoCapacity(target, targetStats);

    if (transfer.amount > space) {
      return engineFailure(
        ErrorCode.RESOURCE_LIMIT,
        'Target cargo capacity exceeded',
      ).error;
    }
  } else if (transfer.transferType === 'passengers') {
    if (!state.scenarioRules.passengerRescueEnabled) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Passenger transfers are not enabled for this scenario',
      ).error;
    }
    const srcPax = source.passengersAboard ?? 0;

    if (transfer.amount > srcPax) {
      return engineFailure(
        ErrorCode.RESOURCE_LIMIT,
        'Insufficient passengers to transfer',
      ).error;
    }
    const space = freeCargoCapacity(target, targetStats);

    if (transfer.amount > space) {
      return engineFailure(
        ErrorCode.RESOURCE_LIMIT,
        'Target has insufficient capacity for passengers',
      ).error;
    }
  } else {
    return engineFailure(ErrorCode.INVALID_INPUT, 'Invalid transfer type')
      .error;
  }
  return null;
};
// Process logistics transfers for the active player.
export const processLogistics = (
  inputState: GameState,
  playerId: PlayerId,
  transfers: TransferOrder[],
  map: SolarSystemMap,
):
  | {
      state: GameState;
      engineEvents: EngineEvent[];
    }
  | {
      error: EngineError;
    } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'logistics');

  if (phaseError) return { error: phaseError };

  for (const transfer of transfers) {
    const error = validateTransfer(state, playerId, transfer);

    if (error) return { error };
  }

  engineEvents.push({
    type: 'logisticsTransfersCommitted',
    playerId,
    transfers: structuredClone(transfers),
  });

  // Apply transfers
  for (const transfer of transfers) {
    const source = must(
      state.ships.find((s) => s.id === transfer.sourceShipId),
    );
    const target = must(
      state.ships.find((s) => s.id === transfer.targetShipId),
    );

    if (transfer.transferType === 'fuel') {
      source.fuel -= transfer.amount;
      target.fuel += transfer.amount;
      engineEvents.push({
        type: 'fuelTransferred',
        fromShipId: source.id,
        toShipId: target.id,
        amount: transfer.amount,
      });
    } else if (transfer.transferType === 'cargo') {
      source.cargoUsed -= transfer.amount;
      target.cargoUsed += transfer.amount;
      engineEvents.push({
        type: 'cargoTransferred',
        fromShipId: source.id,
        toShipId: target.id,
        amount: transfer.amount,
      });
    } else {
      const fromP = source.passengersAboard ?? 0;
      const nextFrom = fromP - transfer.amount;
      if (nextFrom <= 0) {
        source.passengersAboard = undefined;
      } else {
        source.passengersAboard = nextFrom;
      }
      target.passengersAboard =
        (target.passengersAboard ?? 0) + transfer.amount;
      engineEvents.push({
        type: 'passengersTransferred',
        fromShipId: source.id,
        toShipId: target.id,
        amount: transfer.amount,
      });
    }
  }

  // Continue to combat or advance turn
  if (shouldEnterCombatPhase(state, map)) {
    state.phase = 'combat';
    engineEvents.push({
      type: 'phaseChanged',
      phase: 'combat',
      turn: state.turnNumber,
      activePlayer: state.activePlayer,
    });
  } else {
    checkGameEnd(state, map, engineEvents);

    if (state.outcome === null) {
      advanceTurn(state, engineEvents);
    }
  }

  return { state, engineEvents };
};
// Skip logistics phase without making transfers.
export const skipLogistics = (
  inputState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
):
  | {
      state: GameState;
      engineEvents: EngineEvent[];
    }
  | {
      error: EngineError;
    } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'logistics');

  if (phaseError) return { error: phaseError };

  if (shouldEnterCombatPhase(state, map)) {
    state.phase = 'combat';
    engineEvents.push({
      type: 'phaseChanged',
      phase: 'combat',
      turn: state.turnNumber,
      activePlayer: state.activePlayer,
    });
  } else {
    checkGameEnd(state, map, engineEvents);

    if (state.outcome === null) {
      advanceTurn(state, engineEvents);
    }
  }

  return { state, engineEvents };
};
// Process surrender declarations during
// astrogation phase.
export const processSurrender = (
  inputState: GameState,
  playerId: PlayerId,
  shipIds: string[],
):
  | {
      state: GameState;
      engineEvents: EngineEvent[];
    }
  | {
      error: EngineError;
    } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'astrogation');

  if (phaseError) return { error: phaseError };

  if (!state.scenarioRules.logisticsEnabled) {
    return engineFailure(
      ErrorCode.NOT_ALLOWED,
      'Logistics not enabled for this scenario',
    );
  }

  for (const shipId of shipIds) {
    const ship = state.ships.find((s) => s.id === shipId);

    if (!ship) {
      return engineFailure(ErrorCode.INVALID_SHIP, `Ship ${shipId} not found`);
    }

    if (ship.owner !== playerId) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        `Ship ${shipId} not owned by player`,
      );
    }

    if (ship.lifecycle === 'destroyed') {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        `Ship ${shipId} is destroyed`,
      );
    }

    if (ship.control === 'surrendered') {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        `Ship ${shipId} already surrendered`,
      );
    }

    if (ship.control === 'captured') {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        `Ship ${shipId} is captured`,
      );
    }
  }

  for (const shipId of shipIds) {
    const ship = must(state.ships.find((s) => s.id === shipId));
    ship.control = 'surrendered';
    if (engineEvents.length === 0) {
      engineEvents.push({
        type: 'surrenderDeclared',
        playerId,
        shipIds: structuredClone(shipIds),
      });
    }
    engineEvents.push({
      type: 'shipSurrendered',
      shipId,
    });
  }

  return { state, engineEvents };
};
