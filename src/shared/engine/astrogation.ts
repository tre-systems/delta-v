import { ORDNANCE_LIFETIME, ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { HEX_DIRECTIONS } from '../hex';
import {
  type AstrogationOrder,
  type EngineError,
  ErrorCode,
  type GameState,
  type OrdnanceLaunch,
  type SolarSystemMap,
} from '../types';
import type { EngineEvent } from './engine-events';
import type { MovementResult, StateUpdateResult } from './game-engine';
import { shouldEnterOrdnancePhase } from './ordnance';
import { resolveMovementPhase } from './resolve-movement';
import {
  engineFailure,
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
): EngineError | null => {
  const seenShips = new Set<string>();
  for (const order of orders) {
    if (seenShips.has(order.shipId)) {
      return {
        code: ErrorCode.INVALID_INPUT,
        message: 'Each ship may receive at most one' + ' astrogation order',
      };
    }
    seenShips.add(order.shipId);
    const ship = state.ships.find((s) => s.id === order.shipId);

    if (!ship || ship.owner !== playerId) {
      return {
        code: ErrorCode.INVALID_SHIP,
        message: 'Invalid ship for astrogation order',
      };
    }

    if (!isOrderableShip(ship)) {
      if (
        ship.control === 'captured' &&
        order.burn === null &&
        !order.overload
      ) {
        continue;
      }
      return {
        code: ErrorCode.NOT_ALLOWED,
        message: 'Ship cannot receive astrogation orders',
      };
    }
    const isDisabled = ship.damage.disabledTurns > 0;
    const burn = isDisabled ? null : order.burn;
    const overload = isDisabled ? null : (order.overload ?? null);

    if (burn !== null && (burn < 0 || burn > 5)) {
      return {
        code: ErrorCode.INVALID_INPUT,
        message: 'Invalid burn direction',
      };
    }

    if (burn !== null && ship.fuel <= 0) {
      return {
        code: ErrorCode.RESOURCE_LIMIT,
        message: 'No fuel remaining',
      };
    }

    if (overload !== null && (overload < 0 || overload > 5)) {
      return {
        code: ErrorCode.INVALID_INPUT,
        message: 'Invalid overload direction',
      };
    }

    if (overload !== null) {
      if (burn === null) {
        return {
          code: ErrorCode.INVALID_INPUT,
          message: 'Overload requires a primary burn',
        };
      }
      const stats = SHIP_STATS[ship.type];

      if (!stats?.canOverload) {
        return {
          code: ErrorCode.NOT_ALLOWED,
          message: 'This ship cannot overload',
        };
      }

      if (ship.fuel < 2) {
        return {
          code: ErrorCode.RESOURCE_LIMIT,
          message: 'Insufficient fuel for overload',
        };
      }

      if (ship.overloadUsed) {
        return {
          code: ErrorCode.STATE_CONFLICT,
          message: 'Overload already used since last' + ' maintenance',
        };
      }
    }
  }

  return null;
};

// Process astrogation orders for the active player.
export const processAstrogation = (
  inputState: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'astrogation');

  if (phaseError) return { error: phaseError };

  const validationError = validateAstrogationOrders(state, playerId, orders);

  if (validationError) {
    return { error: validationError };
  }

  engineEvents.push({
    type: 'astrogationOrdersCommitted',
    playerId,
    orders: structuredClone(orders),
  });

  state.pendingAstrogationOrders = orders.map((order) => ({
    shipId: order.shipId,
    burn: order.burn,
    overload: order.overload ?? null,
    weakGravityChoices: order.weakGravityChoices
      ? { ...order.weakGravityChoices }
      : undefined,
  }));

  checkGameEnd(state, map, engineEvents);

  if (state.winner !== null) {
    state.pendingAstrogationOrders = null;
    return { state, engineEvents };
  }

  if (shouldEnterOrdnancePhase(state)) {
    state.phase = 'ordnance';
    engineEvents.push({
      type: 'phaseChanged',
      phase: 'ordnance',
      turn: state.turnNumber,
      activePlayer: state.activePlayer,
    });
    return { state, engineEvents };
  }

  const result = resolveMovementPhase(state, playerId, map, rng);

  return {
    ...result,
    engineEvents: [...engineEvents, ...result.engineEvents],
  };
};

// Process ordnance launches for the active player.
export const processOrdnance = (
  inputState: GameState,
  playerId: number,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'ordnance');

  if (phaseError) return { error: phaseError };

  const launchedShips = new Set<string>();

  for (const launch of launches) {
    if (launchedShips.has(launch.shipId)) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Each ship may launch only one' + ' ordnance per turn',
      );
    }

    const ship = state.ships.find((s) => s.id === launch.shipId);

    if (!ship || ship.owner !== playerId) {
      return engineFailure(
        ErrorCode.INVALID_SHIP,
        'Invalid ship for ordnance launch',
      );
    }

    const shipError = validateOrdnanceLaunch(state, ship, launch.ordnanceType);

    if (shipError) return { error: shipError };

    if (launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null) {
      if (launch.torpedoAccel < 0 || launch.torpedoAccel > 5) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Invalid torpedo acceleration direction',
        );
      }

      if (
        launch.torpedoAccelSteps != null &&
        launch.torpedoAccelSteps !== 1 &&
        launch.torpedoAccelSteps !== 2
      ) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Invalid torpedo acceleration distance',
        );
      }
    } else if (
      launch.torpedoAccel != null ||
      launch.torpedoAccelSteps != null
    ) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Only torpedoes use launch acceleration',
      );
    }

    if (launch.ordnanceType === 'mine') {
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (o) => o.shipId === ship.id,
      );
      const hasBurn =
        pendingOrder?.burn != null || pendingOrder?.overload != null;

      if (!hasBurn) {
        return engineFailure(
          ErrorCode.NOT_ALLOWED,
          'Ship must change course when' + ' launching a mine',
        );
      }
    }

    launchedShips.add(launch.shipId);
  }

  engineEvents.push({
    type: 'ordnanceLaunchesCommitted',
    playerId,
    launches: structuredClone(launches),
  });

  let nextOrdId = getNextOrdnanceId(state);

  for (const launch of launches) {
    const ship = state.ships.find((s) => s.id === launch.shipId);

    if (!ship || ship.owner !== playerId) {
      return engineFailure(
        ErrorCode.INVALID_SHIP,
        'Invalid ship for ordnance launch',
      );
    }

    const mass = ORDNANCE_MASS[launch.ordnanceType];
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

    const ordId = `ord${nextOrdId++}`;

    state.ordnance.push({
      id: ordId,
      type: launch.ordnanceType,
      owner: playerId,
      sourceShipId: ship.id,
      position: { ...ship.position },
      velocity,
      turnsRemaining: ORDNANCE_LIFETIME,
      lifecycle: 'active',
      pendingGravityEffects: [],
    });

    engineEvents.push({
      type: 'ordnanceLaunched',
      ordnanceId: ordId,
      ordnanceType: launch.ordnanceType,
      owner: playerId,
      sourceShipId: ship.id,
      position: { ...ship.position },
      velocity: { ...velocity },
      turnsRemaining: ORDNANCE_LIFETIME,
      pendingGravityEffects: [],
    });

    ship.cargoUsed += mass;

    if (launch.ordnanceType === 'nuke') {
      ship.nukesLaunchedSinceResupply += 1;
    }
  }

  const movementResult = resolveMovementPhase(state, playerId, map, rng);

  return {
    ...movementResult,
    engineEvents: [...engineEvents, ...movementResult.engineEvents],
  };
};

// Skip ordnance phase and resolve the queued
// movement phase.
export const skipOrdnance = (
  inputState: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: EngineError } => {
  const state = structuredClone(inputState);

  const phaseError = validatePhaseAction(state, playerId, 'ordnance');

  if (phaseError) return { error: phaseError };

  return resolveMovementPhase(state, playerId, map, rng);
};
