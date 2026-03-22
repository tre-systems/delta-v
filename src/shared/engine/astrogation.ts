import { ORDNANCE_LIFETIME, ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { HEX_DIRECTIONS } from '../hex';
import type {
  AstrogationOrder,
  GameState,
  OrdnanceLaunch,
  SolarSystemMap,
} from '../types';
import type { MovementResult, StateUpdateResult } from './game-engine';
import { shouldEnterOrdnancePhase } from './ordnance';
import { resolveMovementPhase } from './resolve-movement';
import {
  getNextOrdnanceId,
  isOrderableShip,
  validateOrdnanceLaunch,
  validatePhaseAction,
} from './util';
import { checkGameEnd } from './victory';

const validateAstrogationOrders = (
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
): string | null => {
  const seenShips = new Set<string>();
  for (const order of orders) {
    if (seenShips.has(order.shipId)) {
      return 'Each ship may receive at most one' + ' astrogation order';
    }
    seenShips.add(order.shipId);
    const ship = state.ships.find((s) => s.id === order.shipId);
    if (!ship || ship.owner !== playerId) {
      return 'Invalid ship for astrogation order';
    }
    if (!isOrderableShip(ship)) {
      if (
        ship.control === 'captured' &&
        order.burn === null &&
        !order.overload
      ) {
        continue;
      }
      return 'Ship cannot receive astrogation orders';
    }
    const isDisabled = ship.damage.disabledTurns > 0;
    const burn = isDisabled ? null : order.burn;
    const overload = isDisabled ? null : (order.overload ?? null);
    if (burn !== null && (burn < 0 || burn > 5)) {
      return 'Invalid burn direction';
    }
    if (burn !== null && ship.fuel <= 0) {
      return 'No fuel remaining';
    }
    if (overload !== null && (overload < 0 || overload > 5)) {
      return 'Invalid overload direction';
    }
    if (overload !== null) {
      if (burn === null) {
        return 'Overload requires a primary burn';
      }
      const stats = SHIP_STATS[ship.type];
      if (!stats?.canOverload) {
        return 'This ship cannot overload';
      }
      if (ship.fuel < 2) {
        return 'Insufficient fuel for overload';
      }
      if (ship.overloadUsed) {
        return 'Overload already used since last' + ' maintenance';
      }
    }
  }
  return null;
};

/**
 * Process astrogation orders for the active player.
 */
export const processAstrogation = (
  inputState: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: string } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'astrogation');
  if (phaseError) return { error: phaseError };
  const validationError = validateAstrogationOrders(state, playerId, orders);
  if (validationError) {
    return { error: validationError };
  }
  state.pendingAstrogationOrders = orders.map((order) => ({
    shipId: order.shipId,
    burn: order.burn,
    overload: order.overload ?? null,
    weakGravityChoices: order.weakGravityChoices
      ? { ...order.weakGravityChoices }
      : undefined,
  }));
  checkGameEnd(state, map);
  if (state.winner !== null) {
    state.pendingAstrogationOrders = null;
    return { state };
  }
  if (shouldEnterOrdnancePhase(state)) {
    state.phase = 'ordnance';
    return { state };
  }
  return resolveMovementPhase(state, playerId, map, rng);
};

/**
 * Process ordnance launches for the active player.
 */
export const processOrdnance = (
  inputState: GameState,
  playerId: number,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | { error: string } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'ordnance');
  if (phaseError) return { error: phaseError };
  let nextOrdId = getNextOrdnanceId(state);
  const launchedShips = new Set<string>();
  for (const launch of launches) {
    if (launchedShips.has(launch.shipId)) {
      return {
        error: 'Each ship may launch only one' + ' ordnance per turn',
      };
    }
    const ship = state.ships.find((s) => s.id === launch.shipId);
    if (!ship || ship.owner !== playerId) {
      return {
        error: 'Invalid ship for ordnance launch',
      };
    }
    const shipError = validateOrdnanceLaunch(state, ship, launch.ordnanceType);
    if (shipError) return { error: shipError };
    const mass = ORDNANCE_MASS[launch.ordnanceType];
    if (launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null) {
      if (launch.torpedoAccel < 0 || launch.torpedoAccel > 5) {
        return {
          error: 'Invalid torpedo acceleration direction',
        };
      }
      if (
        launch.torpedoAccelSteps != null &&
        launch.torpedoAccelSteps !== 1 &&
        launch.torpedoAccelSteps !== 2
      ) {
        return {
          error: 'Invalid torpedo acceleration distance',
        };
      }
    } else if (
      launch.torpedoAccel != null ||
      launch.torpedoAccelSteps != null
    ) {
      return {
        error: 'Only torpedoes use launch acceleration',
      };
    }
    if (launch.ordnanceType === 'mine') {
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (o) => o.shipId === ship.id,
      );
      const hasBurn =
        pendingOrder?.burn != null || pendingOrder?.overload != null;
      if (!hasBurn) {
        return {
          error: 'Ship must change course when' + ' launching a mine',
        };
      }
    }
    const baseVelocity = { ...ship.velocity };
    const velocity =
      launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null
        ? (() => {
            const accelDir = HEX_DIRECTIONS[launch.torpedoAccel];
            const accelSteps = launch.torpedoAccelSteps ?? 1;
            return {
              dq: baseVelocity.dq + accelDir.dq * accelSteps,
              dr: baseVelocity.dr + accelDir.dr * accelSteps,
            };
          })()
        : baseVelocity;
    state.ordnance.push({
      id: `ord${nextOrdId++}`,
      type: launch.ordnanceType,
      owner: playerId,
      sourceShipId: ship.id,
      position: { ...ship.position },
      velocity,
      turnsRemaining: ORDNANCE_LIFETIME,
      lifecycle: 'active',
      pendingGravityEffects: [],
    });
    ship.cargoUsed += mass;
    if (launch.ordnanceType === 'nuke') {
      ship.nukesLaunchedSinceResupply += 1;
    }
    launchedShips.add(launch.shipId);
  }
  return resolveMovementPhase(state, playerId, map, rng);
};

/**
 * Skip ordnance phase and resolve the queued
 * movement phase.
 */
export const skipOrdnance = (
  inputState: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: string } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'ordnance');
  if (phaseError) return { error: phaseError };
  return resolveMovementPhase(state, playerId, map, rng);
};
