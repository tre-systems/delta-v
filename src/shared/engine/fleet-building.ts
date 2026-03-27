import { SHIP_STATS } from '../constants';
import {
  type EngineError,
  ErrorCode,
  type FleetPurchase,
  type GameState,
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
  availableShipTypes?: string[],
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
  const totalCostOrError = purchases.reduce<
    { cost: number } | { error: EngineError }
  >(
    (acc, purchase) => {
      if ('error' in acc) return acc;
      const stats = SHIP_STATS[purchase.shipType];

      if (!stats) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          `Unknown ship type: ${purchase.shipType}`,
        );
      }

      if (purchase.shipType === 'orbitalBase') {
        return engineFailure(
          ErrorCode.NOT_ALLOWED,
          'Cannot purchase orbital bases directly' +
            ' — buy a transport and base cargo',
        );
      }

      if (
        availableShipTypes &&
        !availableShipTypes.includes(purchase.shipType)
      ) {
        return engineFailure(
          ErrorCode.NOT_ALLOWED,
          `Ship type not available: ${purchase.shipType}`,
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
  const existingCount = state.ships.filter((s) => s.owner === playerId).length;
  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i];
    const stats = SHIP_STATS[purchase.shipType];
    const base = bases[i % bases.length];
    const ship: Ship = {
      id: `p${playerId}s${existingCount + i}`,
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
  }

  player.credits = credits - totalCost;
  player.ready = true;

  engineEvents.push({
    type: 'fleetPurchased',
    playerId,
    purchases: structuredClone(purchases),
    shipTypes: purchases.map((p) => p.shipType),
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
