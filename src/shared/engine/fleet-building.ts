import { isBaseCarrierType, ORBITAL_BASE_MASS, SHIP_STATS } from '../constants';
import {
  type EngineError,
  ErrorCode,
  type FleetPurchase,
  type GameState,
  getFleetPurchaseOption,
  isOrbitalBaseCargoPurchase,
  isShipFleetPurchase,
  type PlayerId,
  type Ship,
  type SolarSystemMap,
} from '../types';
import type { EngineEvent } from './engine-events';
import type { StateUpdateResult } from './game-engine';
import { engineFailure, getOwnedPlanetaryBases } from './util';

// Process fleet purchases for a player during
// the fleet-building phase.
export const processFleetReady = (
  inputState: GameState,
  playerId: PlayerId,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
):
  | StateUpdateResult
  | {
      error: EngineError;
    } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  if (state.phase !== 'fleetBuilding') {
    return engineFailure(
      ErrorCode.INVALID_PHASE,
      'Not in fleet building phase',
    );
  }

  const player = state.players[playerId];
  const credits = player.credits ?? 0;
  const availableFleetPurchases = state.scenarioRules.availableFleetPurchases
    ? new Set(state.scenarioRules.availableFleetPurchases)
    : null;
  const totalCostOrError = purchases.reduce<
    { cost: number } | { error: EngineError }
  >(
    (acc, purchase) => {
      if ('error' in acc) return acc;
      if (
        availableFleetPurchases &&
        !availableFleetPurchases.has(getFleetPurchaseOption(purchase))
      ) {
        return engineFailure(
          ErrorCode.NOT_ALLOWED,
          isShipFleetPurchase(purchase)
            ? `Ship type not available: ${purchase.shipType}`
            : 'Orbital base cargo is not available',
        );
      }

      if (isOrbitalBaseCargoPurchase(purchase)) {
        return { cost: acc.cost + SHIP_STATS.orbitalBase.cost };
      }

      const stats = SHIP_STATS[purchase.shipType];

      if (!stats) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          `Unknown ship type: ${purchase.shipType}`,
        );
      }

      return { cost: acc.cost + stats.cost };
    },
    { cost: 0 },
  );

  if ('error' in totalCostOrError) {
    return totalCostOrError;
  }
  const totalCost = totalCostOrError.cost;

  if (totalCost > credits) {
    return engineFailure(
      ErrorCode.RESOURCE_LIMIT,
      `Not enough credits: need ${totalCost}, have ${credits}`,
    );
  }
  const bases = getOwnedPlanetaryBases(state, playerId, map);

  if (bases.length === 0) {
    return engineFailure(
      ErrorCode.STATE_CONFLICT,
      'Player has no bases to spawn ships at',
    );
  }
  const baseCargoPurchases = purchases.filter(
    isOrbitalBaseCargoPurchase,
  ).length;
  const existingCount = state.ships.filter((s) => s.owner === playerId).length;
  const createdShips: Ship[] = [];
  let spawnedCount = 0;

  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i];

    if (isOrbitalBaseCargoPurchase(purchase)) {
      continue;
    }

    const stats = SHIP_STATS[purchase.shipType];
    const base = bases[spawnedCount % bases.length];
    const ship: Ship = {
      id: `p${playerId}s${existingCount + spawnedCount}`,
      type: purchase.shipType,
      owner: playerId,
      originalOwner: playerId,
      position: { ...base.coord },
      lastMovementPath: [{ ...base.coord }],
      velocity: { dq: 0, dr: 0 },
      fuel: stats.fuel,
      cargoUsed: 0,
      nukesLaunchedSinceResupply: 0,
      resuppliedThisTurn: false,
      lifecycle: 'landed',
      control: 'own',
      heroismAvailable: false,
      overloadUsed: false,
      detected: true,
      pendingGravityEffects: [],
      damage: { disabledTurns: 0 },
    };
    state.ships.push(ship);
    createdShips.push(ship);
    spawnedCount++;
  }

  if (baseCargoPurchases > 0) {
    const eligibleExistingCarriers = state.ships.filter((ship) => {
      if (ship.owner !== playerId || ship.lifecycle === 'destroyed') {
        return false;
      }
      if (!isBaseCarrierType(ship.type) || ship.baseStatus) {
        return false;
      }
      const stats = SHIP_STATS[ship.type];
      return stats.cargo - ship.cargoUsed >= ORBITAL_BASE_MASS;
    });

    // Favor newly purchased carriers first, then fall back to existing ones.
    const createdCarrierIds = new Set(
      createdShips
        .filter((ship) => isBaseCarrierType(ship.type))
        .map((s) => s.id),
    );
    const orderedCarriers = [
      ...eligibleExistingCarriers.filter((ship) =>
        createdCarrierIds.has(ship.id),
      ),
      ...eligibleExistingCarriers.filter(
        (ship) => !createdCarrierIds.has(ship.id),
      ),
    ];

    if (orderedCarriers.length < baseCargoPurchases) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Orbital base cargo requires an available transport or packet',
      );
    }

    for (let i = 0; i < baseCargoPurchases; i++) {
      orderedCarriers[i].baseStatus = 'carryingBase';
      orderedCarriers[i].cargoUsed += ORBITAL_BASE_MASS;
    }
  }

  player.credits = credits - totalCost;
  player.ready = true;

  engineEvents.push({
    type: 'fleetPurchased',
    playerId,
    purchases: structuredClone(purchases),
    shipTypes: purchases.filter(isShipFleetPurchase).map((p) => p.shipType),
  });

  const otherPlayer = state.players[playerId === 0 ? 1 : 0];

  if (otherPlayer.ready) {
    state.phase = 'astrogation';
  }

  engineEvents.push({
    type: 'phaseChanged',
    phase: state.phase,
    turn: state.turnNumber,
    activePlayer: state.activePlayer,
  });

  return { state, engineEvents };
};
