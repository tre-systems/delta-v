import { must } from '../assert';
import { SHIP_STATS } from '../constants';
import { hexEqual } from '../hex';
import type { GameState, Ship, SolarSystemMap, TransferOrder } from '../types';
import { shouldEnterCombatPhase } from './combat';
import { validatePhaseAction } from './util';
import { advanceTurn, checkGameEnd } from './victory';
export interface TransferPair {
  source: Ship;
  target: Ship;
  canTransferFuel: boolean;
  canTransferCargo: boolean;
  maxFuel: number;
  maxCargo: number;
}
const velocityMatch = (a: Ship, b: Ship): boolean =>
  a.velocity.dq === b.velocity.dq && a.velocity.dr === b.velocity.dr;
const isTransferEligibleSource = (ship: Ship, playerId: number): boolean => {
  if (ship.destroyed || ship.landed) return false;
  // Friendly ship: must be operational
  if (ship.owner === playerId) {
    return !ship.controlStatus;
  }
  // Enemy ship: must be disabled or surrendered
  // (looting)
  return ship.damage.disabledTurns > 0 || ship.controlStatus === 'surrendered';
};
const isTransferEligibleTarget = (ship: Ship, playerId: number): boolean => {
  if (ship.destroyed) return false;
  return ship.owner === playerId && !ship.controlStatus;
};
/**
 * Get all valid transfer pairs for a player.
 * A pair requires same hex + same velocity.
 * Friendly-to-friendly is unrestricted; enemy looting
 * requires the source to be disabled or surrendered.
 */
export const getTransferEligiblePairs = (
  state: GameState,
  playerId: number,
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
      // Torch ships cannot transfer fuel (SPEC p.8)
      const canTransferFuel =
        source.type !== 'torch' &&
        source.fuel > 0 &&
        target.fuel < targetStats.fuel;
      const maxFuel = canTransferFuel
        ? Math.min(source.fuel, targetStats.fuel - target.fuel)
        : 0;
      const sourceCargoLoaded = source.cargoUsed;
      const targetCargoSpace = targetStats.cargo - target.cargoUsed;
      const canTransferCargo = sourceCargoLoaded > 0 && targetCargoSpace > 0;
      const maxCargo = canTransferCargo
        ? Math.min(sourceCargoLoaded, targetCargoSpace)
        : 0;
      if (canTransferFuel || canTransferCargo) {
        pairs.push({
          source,
          target,
          canTransferFuel,
          canTransferCargo,
          maxFuel,
          maxCargo,
        });
      }
    }
  }
  return pairs;
};
/**
 * Check if the logistics phase should be entered
 * after movement.
 */
export const shouldEnterLogisticsPhase = (state: GameState): boolean => {
  if (!state.scenarioRules.logisticsEnabled) {
    return false;
  }
  return getTransferEligiblePairs(state, state.activePlayer).length > 0;
};
const validateTransfer = (
  state: GameState,
  playerId: number,
  transfer: TransferOrder,
): string | null => {
  const source = state.ships.find((s) => s.id === transfer.sourceShipId);
  const target = state.ships.find((s) => s.id === transfer.targetShipId);
  if (!source || !target) return 'Ship not found';
  if (!isTransferEligibleSource(source, playerId)) {
    return 'Source ship not eligible for transfer';
  }
  if (!isTransferEligibleTarget(target, playerId)) {
    return 'Target ship not eligible for transfer';
  }
  if (!hexEqual(source.position, target.position)) {
    return 'Ships must be in the same hex';
  }
  if (!velocityMatch(source, target)) {
    return 'Ships must have matching velocity';
  }
  if (transfer.amount <= 0) {
    return 'Transfer amount must be positive';
  }
  if (!Number.isInteger(transfer.amount)) {
    return 'Transfer amount must be an integer';
  }
  const sourceStats = SHIP_STATS[source.type];
  const targetStats = SHIP_STATS[target.type];
  if (!sourceStats || !targetStats) {
    return 'Invalid ship type';
  }
  if (transfer.transferType === 'fuel') {
    if (source.type === 'torch') {
      return 'Torch ships cannot transfer fuel';
    }
    if (transfer.amount > source.fuel) {
      return 'Insufficient fuel';
    }
    if (target.fuel + transfer.amount > targetStats.fuel) {
      return 'Target fuel capacity exceeded';
    }
  } else if (transfer.transferType === 'cargo') {
    if (transfer.amount > source.cargoUsed) {
      return 'Insufficient cargo';
    }
    const space = targetStats.cargo - target.cargoUsed;
    if (transfer.amount > space) {
      return 'Target cargo capacity exceeded';
    }
  } else {
    return 'Invalid transfer type';
  }
  return null;
};
/**
 * Process logistics transfers for the active player.
 */
export const processLogistics = (
  inputState: GameState,
  playerId: number,
  transfers: TransferOrder[],
  map: SolarSystemMap,
):
  | {
      state: GameState;
    }
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'logistics');
  if (phaseError) return { error: phaseError };
  for (const transfer of transfers) {
    const error = validateTransfer(state, playerId, transfer);
    if (error) return { error };
  }
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
    } else {
      source.cargoUsed -= transfer.amount;
      target.cargoUsed += transfer.amount;
    }
  }
  // Continue to combat or advance turn
  if (shouldEnterCombatPhase(state, map)) {
    state.phase = 'combat';
  } else {
    checkGameEnd(state, map);
    if (state.winner === null) {
      advanceTurn(state);
    }
  }
  return { state };
};
/**
 * Skip logistics phase without making transfers.
 */
export const skipLogistics = (
  inputState: GameState,
  playerId: number,
  map: SolarSystemMap,
):
  | {
      state: GameState;
    }
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'logistics');
  if (phaseError) return { error: phaseError };
  if (shouldEnterCombatPhase(state, map)) {
    state.phase = 'combat';
  } else {
    checkGameEnd(state, map);
    if (state.winner === null) {
      advanceTurn(state);
    }
  }
  return { state };
};
/**
 * Process surrender declarations during
 * astrogation phase.
 */
export const processSurrender = (
  inputState: GameState,
  playerId: number,
  shipIds: string[],
):
  | {
      state: GameState;
    }
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'astrogation');
  if (phaseError) return { error: phaseError };
  if (!state.scenarioRules.logisticsEnabled) {
    return {
      error: 'Logistics not enabled for this scenario',
    };
  }
  for (const shipId of shipIds) {
    const ship = state.ships.find((s) => s.id === shipId);
    if (!ship) {
      return { error: `Ship ${shipId} not found` };
    }
    if (ship.owner !== playerId) {
      return {
        error: `Ship ${shipId} not owned by player`,
      };
    }
    if (ship.destroyed) {
      return {
        error: `Ship ${shipId} is destroyed`,
      };
    }
    if (ship.controlStatus === 'surrendered') {
      return {
        error: `Ship ${shipId} already surrendered`,
      };
    }
    if (ship.controlStatus === 'captured') {
      return {
        error: `Ship ${shipId} is captured`,
      };
    }
  }
  for (const shipId of shipIds) {
    const ship = must(state.ships.find((s) => s.id === shipId));
    ship.controlStatus = 'surrendered';
  }
  return { state };
};
