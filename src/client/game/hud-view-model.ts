import { SHIP_STATS } from '../../shared/constants';
import {
  getAllowedOrdnanceTypes,
  hasLaunchableOrdnanceCapacity,
  isOrderableShip,
  validateOrdnanceLaunch,
} from '../../shared/engine/util';
import { HEX_DIRECTIONS, hexAdd, hexVecLength } from '../../shared/hex';
import { detectOrbit, predictDestination } from '../../shared/movement';
import type {
  GameState,
  Ordnance,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { count } from '../../shared/util';
import { getSelectedShip } from './selection';
import type {
  HudViewModel,
  HudViewPlanningSnapshot,
  OrdnanceActionState,
} from './types';

const getObjective = (state: GameState, playerId: PlayerId | -1): string => {
  if (playerId < 0) {
    return '⬡ Spectating';
  }
  const player = state.players[playerId as PlayerId];
  if (!player) {
    return '⬡ Spectating';
  }

  if (state.scenarioRules.checkpointBodies) {
    const visited = player.visitedBodies?.length ?? 0;
    const total = state.scenarioRules.checkpointBodies.length;

    if (visited >= total) {
      return `⬡ Return to ${player.homeBody}`;
    }

    return `⬡ Tour: ${visited}/${total} bodies visited`;
  }

  const hasFugitiveShip = state.ships.some(
    (ship) => ship.owner === playerId && ship.identity?.hasFugitives,
  );

  if (player.escapeWins) {
    const dir = state.scenarioRules.escapeEdge === 'north' ? ' north' : '';
    return hasFugitiveShip
      ? `⬡ Fly ★ ship off the${dir} map edge`
      : `⬡ Escape${dir} off the map`;
  }

  if (state.scenarioRules.hiddenIdentityInspection) {
    return '⬡ Inspect, capture, or destroy fugitives';
  }

  if (player.targetBody) {
    return `⬡ Land on ${player.targetBody}`;
  }

  return '⬡ Destroy all enemies';
};

const getFleetStatus = (state: GameState, playerId: PlayerId | -1): string => {
  const statusParts: string[] = [];

  if (playerId < 0) {
    const fleetOne = state.ships.filter((ship) => ship.owner === 0);
    const fleetTwo = state.ships.filter((ship) => ship.owner === 1);
    const fleetOneAlive = count(
      fleetOne,
      (ship) => ship.lifecycle !== 'destroyed',
    );
    const fleetTwoAlive = count(
      fleetTwo,
      (ship) => ship.lifecycle !== 'destroyed',
    );

    if (fleetOne.length > 0 || fleetTwo.length > 0) {
      statusParts.push(`👁 Spectating · ${fleetOneAlive} vs ${fleetTwoAlive}`);
    }
  } else {
    const myShips = state.ships.filter((ship) => ship.owner === playerId);
    const enemyShips = state.ships.filter((ship) => ship.owner !== playerId);
    const myAlive = count(myShips, (ship) => ship.lifecycle !== 'destroyed');
    const enemyAlive = count(
      enemyShips,
      (ship) => ship.lifecycle !== 'destroyed',
    );

    if (myShips.length > 1 || enemyShips.length > 1) {
      statusParts.push(`⚔ ${myAlive} vs ${enemyAlive}`);
    }
  }

  const activeOrdnance = state.ordnance.filter(
    (ordnance) => ordnance.lifecycle !== 'destroyed',
  );

  if (activeOrdnance.length === 0) {
    return statusParts.join(' ');
  }

  const ordnanceParts: string[] = [];
  const mines = count(activeOrdnance, (ordnance) => ordnance.type === 'mine');
  const torpedoes = count(
    activeOrdnance,
    (ordnance) => ordnance.type === 'torpedo',
  );
  const nukes = count(activeOrdnance, (ordnance) => ordnance.type === 'nuke');

  if (mines > 0) ordnanceParts.push(`${mines}M`);
  if (torpedoes > 0) ordnanceParts.push(`${torpedoes}T`);
  if (nukes > 0) ordnanceParts.push(`${nukes}N`);

  statusParts.push(ordnanceParts.join('/'));

  return statusParts.join(' ');
};

const getOrdnanceActionState = (
  state: GameState,
  selectedShip: ReturnType<typeof getSelectedShip>,
  allowedOrdnanceTypes: Set<Ordnance['type']>,
  ordnanceType: Ordnance['type'],
): OrdnanceActionState => {
  if (!allowedOrdnanceTypes.has(ordnanceType)) {
    return {
      visible: false,
      disabled: true,
      title: '',
    };
  }

  if (!selectedShip) {
    return {
      visible: true,
      disabled: true,
      title: '',
    };
  }

  const error = validateOrdnanceLaunch(state, selectedShip, ordnanceType);

  return {
    visible: true,
    disabled: error !== null,
    title:
      error?.message === 'Only warships and orbital bases can launch torpedoes'
        ? 'Warships only'
        : (error?.message ?? ''),
  };
};

export const deriveHudViewModel = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: HudViewPlanningSnapshot,
  map?: SolarSystemMap | null,
): HudViewModel => {
  const myShips =
    playerId < 0
      ? state.ships
      : state.ships.filter((ship) => ship.owner === playerId);
  const selectedShip = getSelectedShip(
    state,
    playerId,
    planning.selectedShipId,
  );
  const stats = selectedShip ? SHIP_STATS[selectedShip.type] : null;
  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);

  return {
    turn: state.turnNumber,
    phase: state.phase,
    isMyTurn: state.activePlayer === playerId,
    myShips,
    selectedId: selectedShip?.id ?? null,
    fuel: selectedShip?.fuel ?? 0,
    maxFuel: stats?.fuel ?? 0,
    hasBurns: Array.from(planning.burns.values()).some((burn) => burn !== null),
    cargoFree: selectedShip && stats ? stats.cargo - selectedShip.cargoUsed : 0,
    cargoMax: stats?.cargo ?? 0,
    objective: getObjective(state, playerId),
    canOverload: stats?.canOverload ?? false,
    canEmplaceBase:
      selectedShip?.baseStatus === 'carryingBase' &&
      selectedShip.lifecycle !== 'destroyed' &&
      !selectedShip.resuppliedThisTurn,
    fleetStatus: getFleetStatus(state, playerId),
    selectedShipLanded: selectedShip?.lifecycle === 'landed',
    selectedShipDisabled: (selectedShip?.damage.disabledTurns ?? 0) > 0,
    selectedShipHasBurn: selectedShip
      ? (planning.burns.get(selectedShip.id) ?? null) !== null
      : false,
    selectedShipInOrbit: (() => {
      if (!selectedShip || !map) return false;
      if (detectOrbit(selectedShip, map)) return true;
      const burn = planning.burns.get(selectedShip.id) ?? null;
      if (burn === null || selectedShip.fuel <= 0) return false;
      const dest = hexAdd(
        predictDestination(selectedShip),
        HEX_DIRECTIONS[burn],
      );
      const dir = HEX_DIRECTIONS[burn];
      const postBurnShip = {
        ...selectedShip,
        position: dest,
        velocity: {
          dq: selectedShip.velocity.dq + dir.dq,
          dr: selectedShip.velocity.dr + dir.dr,
        },
        pendingGravityEffects: [],
      };
      return detectOrbit(postBurnShip, map) !== null;
    })(),
    selectedShipLandingSet: selectedShip
      ? planning.landingShips.has(selectedShip.id)
      : false,
    allShipsAcknowledged: myShips
      .filter(isOrderableShip)
      .every(
        (ship) =>
          ship.damage.disabledTurns > 0 ||
          planning.acknowledgedShips.has(ship.id),
      ),
    allOrdnanceShipsAcknowledged: myShips
      .filter(isOrderableShip)
      .filter(
        (ship) =>
          ship.damage.disabledTurns === 0 &&
          hasLaunchableOrdnanceCapacity(ship, allowedOrdnanceTypes),
      )
      .every((ship) => planning.acknowledgedOrdnanceShips.has(ship.id)),
    queuedOrdnanceType: selectedShip
      ? (planning.queuedOrdnanceLaunches.find(
          (launch) => launch.shipId === selectedShip.id,
        )?.ordnanceType ?? null)
      : null,
    queuedLaunchCount: planning.queuedOrdnanceLaunches.length,
    multipleShipsAlive: myShips.filter(isOrderableShip).length > 1,
    speed: selectedShip ? hexVecLength(selectedShip.velocity) : 0,
    fuelToStop: selectedShip ? hexVecLength(selectedShip.velocity) : 0,
    launchMineState: getOrdnanceActionState(
      state,
      selectedShip,
      allowedOrdnanceTypes,
      'mine',
    ),
    launchTorpedoState: getOrdnanceActionState(
      state,
      selectedShip,
      allowedOrdnanceTypes,
      'torpedo',
    ),
    launchNukeState: getOrdnanceActionState(
      state,
      selectedShip,
      allowedOrdnanceTypes,
      'nuke',
    ),
  };
};
