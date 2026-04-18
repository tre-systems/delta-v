import { SHIP_STATS } from '../../shared/constants';
import { validateBaseEmplacement } from '../../shared/engine/ordnance';
import {
  getAllowedOrdnanceTypes,
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
import { getOrdnanceActionableShipIds } from './ordnance';
import type { HudPlanningSnapshot } from './planning';
import { getSelectedShip } from './selection';
import type { HudViewModel, OrdnanceActionState } from './types';

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

const getFleetStatus = (
  state: GameState,
  playerId: PlayerId | -1,
): { text: string; ariaLabel: string } => {
  const statusParts: string[] = [];
  const ariaParts: string[] = [];

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
      ariaParts.push(
        `Spectating: player one has ${fleetOneAlive} active ship${fleetOneAlive === 1 ? '' : 's'}, player two has ${fleetTwoAlive} active ship${fleetTwoAlive === 1 ? '' : 's'}.`,
      );
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
      ariaParts.push(
        `${myAlive} of your ships alive versus ${enemyAlive} enemy ship${enemyAlive === 1 ? '' : 's'} alive.`,
      );
    }
  }

  const activeOrdnance = state.ordnance.filter(
    (ordnance) => ordnance.lifecycle !== 'destroyed',
  );

  const mines = count(activeOrdnance, (ordnance) => ordnance.type === 'mine');
  const torpedoes = count(
    activeOrdnance,
    (ordnance) => ordnance.type === 'torpedo',
  );
  const nukes = count(activeOrdnance, (ordnance) => ordnance.type === 'nuke');

  if (activeOrdnance.length === 0) {
    const text = statusParts.join(' ');
    const ariaLabel = ariaParts.join(' ').trim();
    return { text, ariaLabel: ariaLabel || text };
  }

  const ordnanceParts: string[] = [];
  if (mines > 0) ordnanceParts.push(`${mines}M`);
  if (torpedoes > 0) ordnanceParts.push(`${torpedoes}T`);
  if (nukes > 0) ordnanceParts.push(`${nukes}N`);

  statusParts.push(ordnanceParts.join('/'));

  const ordnanceAriaBits: string[] = [];
  if (mines > 0) {
    ordnanceAriaBits.push(`${mines} mine${mines === 1 ? '' : 's'} in flight`);
  }
  if (torpedoes > 0) {
    ordnanceAriaBits.push(
      `${torpedoes} torpedo${torpedoes === 1 ? '' : 'es'} in flight`,
    );
  }
  if (nukes > 0) {
    ordnanceAriaBits.push(
      `${nukes} nuclear weapon${nukes === 1 ? '' : 's'} in flight`,
    );
  }
  ariaParts.push(`Ordnance: ${ordnanceAriaBits.join(', ')}.`);

  const text = statusParts.join(' ');
  const ariaLabel = ariaParts.join(' ').trim();
  return { text, ariaLabel: ariaLabel || text };
};

const getOrdnanceActionState = (
  state: GameState,
  selectedShip: ReturnType<typeof getSelectedShip>,
  allowedOrdnanceTypes: Set<Ordnance['type']>,
  ordnanceType: Ordnance['type'],
  map?: SolarSystemMap | null,
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

  const error = validateOrdnanceLaunch(state, selectedShip, ordnanceType, map);
  const condensedTitle =
    error?.message === 'Only warships and orbital bases can launch torpedoes'
      ? 'Warships or bases only'
      : error?.message === 'Ship must change course when launching a mine'
        ? 'Needs a course change'
        : error?.message === 'Committed mine launch course must leave this hex'
          ? 'Mine needs leaving hex'
          : error?.message?.startsWith('Not enough cargo')
            ? 'Not enough cargo'
            : error?.message === 'Cannot launch ordnance while landed'
              ? 'Cannot launch while landed'
              : error?.message ===
                  'Ships cannot launch ordnance during a turn in which they resupply'
                ? 'Resupplied this turn'
                : error?.message === 'Ship is disabled'
                  ? 'Ship disabled'
                  : (error?.message ?? '');

  return {
    visible: true,
    disabled: error !== null,
    title: condensedTitle,
  };
};

const getBaseEmplacementActionState = (
  state: GameState,
  selectedShip: ReturnType<typeof getSelectedShip>,
  map?: SolarSystemMap | null,
): OrdnanceActionState => {
  if (!selectedShip || selectedShip.baseStatus !== 'carryingBase') {
    return {
      visible: false,
      disabled: true,
      title: '',
    };
  }

  if (!map) {
    return {
      visible: true,
      disabled: false,
      title: '',
    };
  }

  const error = validateBaseEmplacement(state, selectedShip, map);
  const condensedTitle =
    error?.message ===
    'Must be in orbit or on an open world hex side to emplace an orbital base'
      ? 'Need orbit or open world side'
      : error?.message === 'Cannot emplace during a resupply turn'
        ? 'Resupplied this turn'
        : error?.message === 'Disabled ships cannot emplace orbital bases'
          ? 'Ship disabled'
          : error?.message === 'Captured ships cannot emplace orbital bases'
            ? 'Captured ship'
            : (error?.message ?? '');

  return {
    visible: true,
    disabled: error !== null,
    title: condensedTitle,
  };
};

export const deriveHudViewModel = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: HudPlanningSnapshot,
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
  const emplaceBaseState = getBaseEmplacementActionState(
    state,
    selectedShip,
    map,
  );
  const actionableOrdnanceShipIds: string[] = [];
  if (playerId >= 0) {
    actionableOrdnanceShipIds.push(
      ...getOrdnanceActionableShipIds(state, playerId as PlayerId, map),
    );
  }

  const fleetStatusLine = getFleetStatus(state, playerId);

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
    emplaceBaseState,
    fleetStatus: fleetStatusLine.text,
    fleetStatusAriaLabel: fleetStatusLine.ariaLabel,
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
    torpedoAimingActive: planning.torpedoAimingActive,
    torpedoAccelSteps: planning.torpedoAccelSteps,
    allShipsAcknowledged: myShips
      .filter(isOrderableShip)
      .every(
        (ship) =>
          ship.damage.disabledTurns > 0 ||
          planning.acknowledgedShips.has(ship.id),
      ),
    allOrdnanceShipsAcknowledged: actionableOrdnanceShipIds.every((shipId) =>
      planning.acknowledgedOrdnanceShips.has(shipId),
    ),
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
      map,
    ),
    launchTorpedoState: getOrdnanceActionState(
      state,
      selectedShip,
      allowedOrdnanceTypes,
      'torpedo',
      map,
    ),
    launchNukeState: getOrdnanceActionState(
      state,
      selectedShip,
      allowedOrdnanceTypes,
      'nuke',
      map,
    ),
  };
};
