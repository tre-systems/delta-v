import { SHIP_STATS } from '../constants';
import type { FleetPurchase, GameState, Ship, SolarSystemMap } from '../types';
import type { StateUpdateResult } from './game-engine';
import { getOwnedPlanetaryBases } from './util';

/**
 * Process fleet purchases for a player during
 * the fleet-building phase.
 */
export const processFleetReady = (
  inputState: GameState,
  playerId: number,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  availableShipTypes?: string[],
):
  | StateUpdateResult
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  if (state.phase !== 'fleetBuilding') {
    return { error: 'Not in fleet building phase' };
  }
  if (playerId !== 0 && playerId !== 1) {
    return { error: 'Invalid player' };
  }
  const player = state.players[playerId];
  const credits = player.credits ?? 0;
  const totalCostOrError = purchases.reduce<
    { cost: number } | { error: string }
  >(
    (acc, purchase) => {
      if ('error' in acc) return acc;
      const stats = SHIP_STATS[purchase.shipType];
      if (!stats) {
        return {
          error: `Unknown ship type: ${purchase.shipType}`,
        };
      }
      if (purchase.shipType === 'orbitalBase') {
        return {
          error:
            'Cannot purchase orbital bases directly' +
            ' — buy a transport and base cargo',
        };
      }
      if (
        availableShipTypes &&
        !availableShipTypes.includes(purchase.shipType)
      ) {
        return {
          error: `Ship type not available: ${purchase.shipType}`,
        };
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
    return {
      error: `Not enough credits: need ${totalCost}, have ${credits}`,
    };
  }
  const bases = getOwnedPlanetaryBases(state, playerId, map);
  if (bases.length === 0) {
    return {
      error: 'Player has no bases to spawn ships at',
    };
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
  const otherPlayer = state.players[1 - playerId];
  if (otherPlayer.ready) {
    state.phase = 'astrogation';
  }
  return { state };
};
