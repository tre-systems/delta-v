import { SHIP_STATS } from '../../shared/constants';
import {
  getAllowedOrdnanceTypes,
  hasLaunchableOrdnanceCapacity,
  validateOrdnanceLaunch,
} from '../../shared/engine/util';
import type {
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  Ship,
} from '../../shared/types/domain';
import type { PlanningState } from './planning';

type OrdnanceState = Pick<
  GameState,
  'ships' | 'scenarioRules' | 'pendingAstrogationOrders'
>;

type OrdnancePlanning = Pick<
  PlanningState,
  'selectedShipId' | 'torpedoAccel' | 'torpedoAccelSteps'
>;

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

const getShipName = (ship: Ship): string => {
  return SHIP_STATS[ship.type]?.name ?? ship.type;
};

const getSelectedShip = (
  state: OrdnanceState,
  selectedShipId: string | null,
): Ship | null => {
  if (!selectedShipId) {
    return null;
  }

  return state.ships.find((ship) => ship.id === selectedShipId) ?? null;
};

export const getFirstLaunchableShipId = (
  state: OrdnanceState,
  playerId: number,
): string | null => {
  const allowedTypes = getAllowedOrdnanceTypes(state);

  return (
    state.ships.find(
      (ship) =>
        ship.owner === playerId &&
        !ship.resuppliedThisTurn &&
        hasLaunchableOrdnanceCapacity(ship, allowedTypes),
    )?.id ?? null
  );
};

export const getUnambiguousLaunchableShipId = (
  state: OrdnanceState,
  playerId: number,
): string | null => {
  const allowedTypes = getAllowedOrdnanceTypes(state);
  const launchable = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      !ship.resuppliedThisTurn &&
      hasLaunchableOrdnanceCapacity(ship, allowedTypes),
  );

  return launchable.length === 1 ? launchable[0].id : null;
};

export const resolveOrdnanceLaunchPlan = (
  state: OrdnanceState,
  planning: OrdnancePlanning,
  ordnanceType: 'mine' | 'torpedo' | 'nuke',
): OrdnanceLaunchPlan => {
  if (!planning.selectedShipId) {
    return {
      ok: false,
      message: 'Select a ship first',
      level: 'info',
    };
  }

  const ship = getSelectedShip(state, planning.selectedShipId);

  if (!ship) {
    return { ok: false, message: null, level: 'error' };
  }

  const error = validateOrdnanceLaunch(state, ship, ordnanceType);

  if (error) {
    return { ok: false, message: error.message, level: 'error' };
  }

  return {
    ok: true,
    shipName: getShipName(ship),
    launch: {
      shipId: ship.id,
      ordnanceType,
      torpedoAccel:
        ordnanceType === 'torpedo'
          ? (planning.torpedoAccel ?? null)
          : undefined,
      torpedoAccelSteps:
        ordnanceType === 'torpedo'
          ? (planning.torpedoAccelSteps ?? null)
          : undefined,
    },
  };
};

export const resolveBaseEmplacementPlan = (
  state: OrdnanceState,
  selectedShipId: string | null,
): BaseEmplacementPlan => {
  if (!selectedShipId) {
    return {
      ok: false,
      message: 'Select a ship first',
      level: 'info',
    };
  }

  const ship = getSelectedShip(state, selectedShipId);

  if (!ship) {
    return { ok: false, message: null, level: 'error' };
  }

  if (ship.baseStatus !== 'carryingBase') {
    return {
      ok: false,
      message: 'Ship is not carrying an orbital base',
      level: 'error',
    };
  }

  return {
    ok: true,
    emplacements: [{ shipId: selectedShipId }],
  };
};
