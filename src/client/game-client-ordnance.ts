import { ORDNANCE_MASS, SHIP_STATS } from '../shared/constants';
import type {
  GameState,
  OrdnanceLaunch,
  OrbitalBaseEmplacement,
  Ship,
} from '../shared/types';
import type { PlanningState } from './renderer';

type OrdnanceState = Pick<GameState, 'ships'>;
type OrdnancePlanning = Pick<PlanningState, 'selectedShipId' | 'torpedoAccel' | 'torpedoAccelSteps'>;

export type ClientActionError = {
  ok: false;
  message: string | null;
  level: 'info' | 'error';
};

export type OrdnanceLaunchPlan =
  | {
    ok: true;
    launch: OrdnanceLaunch;
    shipName: string;
  }
  | ClientActionError;

export type BaseEmplacementPlan =
  | {
    ok: true;
    emplacements: OrbitalBaseEmplacement[];
  }
  | ClientActionError;

function getShipName(ship: Ship): string {
  return SHIP_STATS[ship.type]?.name ?? ship.type;
}

function getSelectedShip(
  state: OrdnanceState,
  selectedShipId: string | null,
): Ship | null {
  if (!selectedShipId) {
    return null;
  }
  return state.ships.find(ship => ship.id === selectedShipId) ?? null;
}

export function canShipLaunchAnyOrdnance(ship: Pick<Ship, 'type' | 'cargoUsed'>): boolean {
  const stats = SHIP_STATS[ship.type];
  if (!stats) {
    return false;
  }
  return (stats.cargo - ship.cargoUsed) >= ORDNANCE_MASS.mine;
}

export function getFirstLaunchableShipId(
  state: OrdnanceState,
  playerId: number,
): string | null {
  return state.ships.find(ship =>
    ship.owner === playerId
    && !ship.destroyed
    && !ship.landed
    && ship.damage.disabledTurns === 0
    && canShipLaunchAnyOrdnance(ship),
  )?.id ?? null;
}

export function resolveOrdnanceLaunchPlan(
  state: OrdnanceState,
  planning: OrdnancePlanning,
  ordnanceType: 'mine' | 'torpedo' | 'nuke',
): OrdnanceLaunchPlan {
  const ship = getSelectedShip(state, planning.selectedShipId);
  if (!planning.selectedShipId) {
    return { ok: false, message: 'Select a ship first', level: 'info' };
  }
  if (!ship) {
    return { ok: false, message: null, level: 'error' };
  }

  const stats = SHIP_STATS[ship.type];
  if (!stats) {
    return { ok: false, message: null, level: 'error' };
  }

  const cargoFree = stats.cargo - ship.cargoUsed;
  if (ship.destroyed) {
    return { ok: false, message: 'Ship is destroyed', level: 'error' };
  }
  if (ship.landed) {
    return { ok: false, message: 'Cannot launch ordnance while landed', level: 'error' };
  }
  if (ship.damage.disabledTurns > 0) {
    return { ok: false, message: 'Ship is disabled', level: 'error' };
  }
  if (ordnanceType === 'torpedo' && !stats.canOverload) {
    return { ok: false, message: 'Only warships can launch torpedoes', level: 'error' };
  }
  if (ordnanceType === 'nuke' && !stats.canOverload && (ship.nukesLaunchedSinceResupply ?? 0) >= 1) {
    return {
      ok: false,
      message: 'Non-warships may carry only one nuke between resupplies',
      level: 'error',
    };
  }

  const neededCargo = ORDNANCE_MASS[ordnanceType] ?? 0;
  if (cargoFree < neededCargo) {
    return {
      ok: false,
      message: `Not enough cargo (need ${neededCargo}, have ${cargoFree})`,
      level: 'error',
    };
  }

  return {
    ok: true,
    shipName: getShipName(ship),
    launch: {
      shipId: ship.id,
      ordnanceType,
      torpedoAccel: ordnanceType === 'torpedo' ? planning.torpedoAccel ?? null : undefined,
      torpedoAccelSteps: ordnanceType === 'torpedo' ? planning.torpedoAccelSteps ?? null : undefined,
    },
  };
}

export function resolveBaseEmplacementPlan(
  state: OrdnanceState,
  selectedShipId: string | null,
): BaseEmplacementPlan {
  if (!selectedShipId) {
    return { ok: false, message: 'Select a ship first', level: 'info' };
  }

  const ship = getSelectedShip(state, selectedShipId);
  if (!ship) {
    return { ok: false, message: null, level: 'error' };
  }
  if (!ship.carryingOrbitalBase) {
    return { ok: false, message: 'Ship is not carrying an orbital base', level: 'error' };
  }

  return {
    ok: true,
    emplacements: [{ shipId: selectedShipId }],
  };
}
