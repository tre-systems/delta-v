import { SHIP_STATS } from '../../shared/constants';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  hexAdd,
  hexEqual,
  hexKey,
} from '../../shared/hex';
import { computeCourse, predictDestination } from '../../shared/movement';
import type {
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import type {
  AstrogationPlanningSnapshot,
  OrdnancePlanningSnapshot,
} from './planning';

export type AstrogationInteraction =
  | {
      type: 'weakGravityToggle';
      shipId: string;
      choices: Record<string, boolean>;
    }
  | {
      type: 'overloadToggle';
      shipId: string;
      direction: number | null;
    }
  | {
      type: 'burnToggle';
      shipId: string;
      direction: number | null;
      clearOverload: boolean;
    }
  | { type: 'selectShip'; shipId: string }
  | { type: 'clearSelection' };

export type OrdnanceInteraction =
  | {
      type: 'torpedoAccel';
      torpedoAccel: number | null;
      torpedoAccelSteps: 1 | 2 | null;
    }
  | {
      type: 'selectShip';
      shipId: string;
      clearTorpedoAccel: true;
    }
  | { type: 'none' };

const getShipById = (state: GameState, shipId: string | null): Ship | null => {
  return shipId
    ? (state.ships.find((ship) => ship.id === shipId) ?? null)
    : null;
};

const getOwnShipAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
  options: {
    requireOperational?: boolean;
    selectedShipId?: string | null;
    lastSelectedHex?: string | null;
  } = {},
) => {
  const matches = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      (!options.requireOperational ||
        (ship.lifecycle === 'active' && ship.damage.disabledTurns === 0)) &&
      hexEqual(clickHex, ship.position),
  );

  if (matches.length === 0) return null;

  if (matches.length === 1) return matches[0];

  // Cycle through stacked ships:
  // if clicking same hex as last selection, pick next ship
  const key = hexKey(clickHex);

  if (options.lastSelectedHex === key && options.selectedShipId) {
    const currentIdx = matches.findIndex(
      (s) => s.id === options.selectedShipId,
    );

    if (currentIdx >= 0) {
      return matches[(currentIdx + 1) % matches.length];
    }
  }

  return matches[0];
};

const resolveWeakGravityToggle = (
  state: GameState,
  map: SolarSystemMap,
  ship: Ship,
  clickHex: HexCoord,
  planning: AstrogationPlanningSnapshot,
) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;
  const overload = planning.overloads.get(ship.id) ?? null;

  const weakGravityChoices = planning.weakGravityChoices.get(ship.id) ?? {};

  const course = computeCourse(ship, currentBurn, map, {
    overload,
    weakGravityChoices,
    destroyedBases: state.destroyedBases,
  });

  for (const gravityEffect of course.enteredGravityEffects) {
    if (
      gravityEffect.strength !== 'weak' ||
      !hexEqual(clickHex, gravityEffect.hex)
    ) {
      continue;
    }

    const key = hexKey(gravityEffect.hex);

    return {
      type: 'weakGravityToggle' as const,
      shipId: ship.id,
      choices: {
        ...weakGravityChoices,
        [key]: !weakGravityChoices[key],
      },
    };
  }

  return null;
};

const resolveOverloadToggle = (
  ship: Ship,
  clickHex: HexCoord,
  planning: AstrogationPlanningSnapshot,
) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;

  if (currentBurn === null) return null;

  const stats = SHIP_STATS[ship.type];

  if (!stats?.canOverload || ship.fuel < 2 || ship.overloadUsed) {
    return null;
  }

  const predictedDestination =
    ship.lifecycle === 'landed' ? null : predictDestination(ship);

  const launchHex = predictedDestination ?? ship.position;

  const burnDestination = hexAdd(launchHex, HEX_DIRECTIONS[currentBurn]);

  const currentOverload = planning.overloads.get(ship.id) ?? null;

  const direction = HEX_DIRECTIONS.findIndex((dir) =>
    hexEqual(clickHex, hexAdd(burnDestination, dir)),
  );

  if (direction === -1) return null;

  return {
    type: 'overloadToggle' as const,
    shipId: ship.id,
    direction: currentOverload === direction ? null : direction,
  };
};

const resolveBurnToggle = (
  state: GameState,
  map: SolarSystemMap,
  ship: Ship,
  clickHex: HexCoord,
  planning: AstrogationPlanningSnapshot,
) => {
  const currentBurn = planning.burns.get(ship.id) ?? null;

  const predictedDestination =
    ship.lifecycle === 'landed'
      ? computeCourse(ship, null, map, {
          destroyedBases: state.destroyedBases,
        }).path[0]
      : predictDestination(ship);

  const direction = HEX_DIRECTIONS.findIndex((dir) =>
    hexEqual(clickHex, hexAdd(predictedDestination, dir)),
  );

  if (direction === -1) return null;

  return {
    type: 'burnToggle' as const,
    shipId: ship.id,
    direction: currentBurn === direction ? null : direction,
    clearOverload: currentBurn !== direction,
  };
};

export const resolveAstrogationClick = (
  state: GameState,
  map: SolarSystemMap,
  playerId: PlayerId,
  planning: AstrogationPlanningSnapshot,
  clickHex: HexCoord,
): AstrogationInteraction => {
  const selectedShip = getShipById(state, planning.selectedShipId);

  if (
    selectedShip &&
    selectedShip.fuel > 0 &&
    selectedShip.damage.disabledTurns === 0
  ) {
    const weakGravityToggle = resolveWeakGravityToggle(
      state,
      map,
      selectedShip,
      clickHex,
      planning,
    );

    if (weakGravityToggle) return weakGravityToggle;

    const overloadToggle = resolveOverloadToggle(
      selectedShip,
      clickHex,
      planning,
    );

    if (overloadToggle) return overloadToggle;

    const burnToggle = resolveBurnToggle(
      state,
      map,
      selectedShip,
      clickHex,
      planning,
    );

    if (burnToggle) return burnToggle;
  }

  const ownShip = getOwnShipAtHex(state, playerId, clickHex, {
    selectedShipId: planning.selectedShipId,
    lastSelectedHex: planning.lastSelectedHex,
  });

  return ownShip
    ? { type: 'selectShip', shipId: ownShip.id }
    : { type: 'clearSelection' };
};

const getClickedTorpedoDirection = (
  ship: Ship,
  clickHex: HexCoord,
): number | null => {
  const direction = HEX_DIRECTIONS.findIndex((dir) =>
    hexEqual(clickHex, hexAdd(ship.position, dir)),
  );

  return direction >= 0 ? direction : null;
};

const cycleTorpedoAcceleration = (
  currentDirection: number | null,
  currentSteps: 1 | 2 | null,
  clickedDirection: number,
) => {
  if (currentDirection !== clickedDirection) {
    return {
      torpedoAccel: clickedDirection,
      torpedoAccelSteps: 1 as const,
    };
  }

  if (currentSteps === 1) {
    return {
      torpedoAccel: clickedDirection,
      torpedoAccelSteps: 2 as const,
    };
  }

  return {
    torpedoAccel: null,
    torpedoAccelSteps: null,
  };
};

export const resolveOrdnanceClick = (
  state: GameState,
  playerId: PlayerId,
  planning: OrdnancePlanningSnapshot,
  clickHex: HexCoord,
): OrdnanceInteraction => {
  const selectedShip = getShipById(state, planning.selectedShipId);

  // Torpedo boost halos are live whenever a torpedo-capable ship is
  // selected — no modal "aiming mode". The renderer mirrors this gate;
  // see `renderTorpedoGuidance` in `client/renderer/overlay.ts`.
  const canAimTorpedo =
    selectedShip &&
    SHIP_STATS[selectedShip.type]?.canLaunchTorpedoes &&
    state.phase === 'ordnance' &&
    state.activePlayer === playerId;

  if (canAimTorpedo && selectedShip) {
    const clickedDirection = getClickedTorpedoDirection(selectedShip, clickHex);

    if (clickedDirection !== null) {
      return {
        type: 'torpedoAccel',
        ...cycleTorpedoAcceleration(
          planning.torpedoAccel,
          planning.torpedoAccelSteps,
          clickedDirection,
        ),
      };
    }
  }

  const ownShip = getOwnShipAtHex(state, playerId, clickHex, {
    requireOperational: true,
    selectedShipId: planning.selectedShipId,
    lastSelectedHex: planning.lastSelectedHex,
  });

  return ownShip
    ? {
        type: 'selectShip',
        shipId: ownShip.id,
        clearTorpedoAccel: true,
      }
    : { type: 'none' };
};
