import { SHIP_STATS } from '../../shared/constants';
import { validateBaseEmplacement } from '../../shared/engine/ordnance';
import {
  getOrderableShipsForPlayer,
  hasValidOrdnanceLaunch,
  validateOrdnanceLaunch,
} from '../../shared/engine/util';
import { asShipId } from '../../shared/ids';
import type {
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  OrdnanceType,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { OrdnancePlanningSnapshot } from './planning';

type OrdnanceState = Pick<
  GameState,
  'ships' | 'scenarioRules' | 'pendingAstrogationOrders'
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

const isPotentialBaseEmplacementShip = (ship: Ship): boolean => {
  return (
    ship.baseStatus === 'carryingBase' &&
    ship.lifecycle !== 'destroyed' &&
    ship.control !== 'captured' &&
    ship.damage.disabledTurns === 0 &&
    !ship.resuppliedThisTurn
  );
};

const canEmplaceBaseExactly = (
  state: OrdnanceState,
  ship: Ship,
  map?: SolarSystemMap | null,
): boolean => {
  if (!isPotentialBaseEmplacementShip(ship)) {
    return false;
  }

  return map ? validateBaseEmplacement(state, ship, map) === null : false;
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
  playerId: PlayerId,
): string | null => {
  return (
    getOrderableShipsForPlayer(state, playerId).find((ship) =>
      hasValidOrdnanceLaunch(state, ship),
    )?.id ?? null
  );
};

export const getOrdnanceActionableShipIds = (
  state: OrdnanceState,
  playerId: PlayerId,
  map?: SolarSystemMap | null,
): string[] => {
  const orderableShips = getOrderableShipsForPlayer(state, playerId);
  const launchableShips = orderableShips.filter((ship) =>
    hasValidOrdnanceLaunch(state, ship),
  );
  const launchableIds = new Set(launchableShips.map((ship) => ship.id));
  const emplacementShips = orderableShips.filter(
    (ship) =>
      !launchableIds.has(ship.id) && canEmplaceBaseExactly(state, ship, map),
  );

  return [
    ...launchableShips.map((ship) => ship.id),
    ...emplacementShips.map((ship) => ship.id),
  ];
};

export const getFirstUnacknowledgedOrdnanceActionableShipId = (
  state: OrdnanceState,
  playerId: PlayerId,
  acknowledgedShipIds: ReadonlySet<string>,
  map?: SolarSystemMap | null,
): string | null => {
  return (
    getOrdnanceActionableShipIds(state, playerId, map).find(
      (shipId) => !acknowledgedShipIds.has(shipId),
    ) ?? null
  );
};

export const getFirstOrdnanceActionableShipId = (
  state: OrdnanceState,
  playerId: PlayerId,
  map?: SolarSystemMap | null,
): string | null => {
  return getOrdnanceActionableShipIds(state, playerId, map)[0] ?? null;
};

export const getFirstBaseEmplacementShipId = (
  state: OrdnanceState,
  playerId: PlayerId,
  map?: SolarSystemMap | null,
): string | null => {
  return (
    state.ships.find(
      (ship) =>
        ship.owner === playerId && canEmplaceBaseExactly(state, ship, map),
    )?.id ?? null
  );
};

export const getUnambiguousLaunchableShipId = (
  state: OrdnanceState,
  playerId: PlayerId,
): string | null => {
  const launchable = state.ships.filter(
    (ship) => ship.owner === playerId && hasValidOrdnanceLaunch(state, ship),
  );

  return launchable.length === 1 ? launchable[0].id : null;
};

export const resolveOrdnanceLaunchPlan = (
  state: OrdnanceState,
  planning: Pick<
    OrdnancePlanningSnapshot,
    'selectedShipId' | 'torpedoAccel' | 'torpedoAccelSteps'
  >,
  ordnanceType: OrdnanceType,
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
        ordnanceType === 'torpedo' ? (planning.torpedoAccel ?? null) : null,
      torpedoAccelSteps:
        ordnanceType === 'torpedo'
          ? (planning.torpedoAccelSteps ?? null)
          : null,
    },
  };
};

export const resolveBaseEmplacementPlan = (
  state: OrdnanceState,
  selectedShipId: string | null,
  map?: SolarSystemMap | null,
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

  if (map) {
    const error = validateBaseEmplacement(state, ship, map);

    if (error) {
      return {
        ok: false,
        message: error.message,
        level: 'error',
      };
    }
  }

  return {
    ok: true,
    emplacements: [{ shipId: asShipId(selectedShipId) }],
  };
};
