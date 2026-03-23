import { SHIP_STATS } from '../../shared/constants';
import {
  getAllowedOrdnanceTypes,
  getOrderableShipsForPlayer,
  isOrderableShip,
  validateOrdnanceLaunch,
} from '../../shared/engine/util';
import { hexVecLength } from '../../shared/hex';
import type {
  AstrogationOrder,
  GameState,
  Ordnance,
  Ship,
} from '../../shared/types/domain';
import { count } from '../../shared/util';
import type { PlanningState } from './planning';

export interface GameOverStats {
  turns: number;
  myShipsAlive: number;
  myShipsTotal: number;
  enemyShipsAlive: number;
  enemyShipsTotal: number;
}

export interface HudViewModel {
  turn: number;
  phase: GameState['phase'];
  isMyTurn: boolean;
  myShips: Ship[];
  selectedId: string | null;
  fuel: number;
  maxFuel: number;
  hasBurns: boolean;
  cargoFree: number;
  cargoMax: number;
  objective: string;
  canOverload: boolean;
  canEmplaceBase: boolean;
  fleetStatus: string;
  selectedShipLanded: boolean;
  selectedShipDisabled: boolean;
  selectedShipHasBurn: boolean;
  allShipsHaveBurns: boolean;
  multipleShipsAlive: boolean;
  speed: number;
  fuelToStop: number;
  launchMineState: OrdnanceActionState;
  launchTorpedoState: OrdnanceActionState;
  launchNukeState: OrdnanceActionState;
}

export interface OrdnanceActionState {
  visible: boolean;
  disabled: boolean;
  title: string;
}

type PlanningSnapshot = Pick<
  PlanningState,
  'selectedShipId' | 'burns' | 'overloads' | 'weakGravityChoices'
>;

export const getSelectedShip = (
  state: GameState,
  playerId: number,
  selectedId: string | null,
) => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);

  if (selectedId !== null) {
    const match = myShips.find((ship) => ship.id === selectedId);

    if (match) return match;
  }

  const alive = myShips.filter((ship) => ship.lifecycle !== 'destroyed');

  return alive.length === 1 ? alive[0] : null;
};

const getObjective = (state: GameState, playerId: number): string => {
  const player = state.players[playerId];

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

  const facingFugitives = state.scenarioRules.hiddenIdentityInspection;

  if (player.escapeWins) {
    return hasFugitiveShip ? '⬡ Escape the ★ ship' : '⬡ Escape the map';
  }

  if (facingFugitives) {
    return '⬡ Inspect, capture, or destroy fugitives';
  }

  if (player.targetBody) {
    return `⬡ Land on ${player.targetBody}`;
  }

  return '⬡ Destroy all enemies';
};

const getFleetStatus = (state: GameState, playerId: number): string => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);

  const enemyShips = state.ships.filter((ship) => ship.owner !== playerId);

  const myAlive = count(myShips, (ship) => ship.lifecycle !== 'destroyed');

  const enemyAlive = count(
    enemyShips,
    (ship) => ship.lifecycle !== 'destroyed',
  );

  const statusParts: string[] = [];

  if (myShips.length > 1 || enemyShips.length > 1) {
    statusParts.push(`⚔ ${myAlive}v${enemyAlive}`);
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

export const buildAstrogationOrders = (
  state: GameState,
  playerId: number,
  planning: PlanningSnapshot,
): AstrogationOrder[] => {
  return getOrderableShipsForPlayer(state, playerId).map((ship) => {
    const burn = planning.burns.get(ship.id) ?? null;

    const overload = planning.overloads.get(ship.id) ?? null;

    const weakGravityChoices = planning.weakGravityChoices.get(ship.id);

    const order: AstrogationOrder = {
      shipId: ship.id,
      burn,
    };

    if (overload !== null) {
      order.overload = overload;
    }

    if (weakGravityChoices && Object.keys(weakGravityChoices).length > 0) {
      order.weakGravityChoices = weakGravityChoices;
    }

    return order;
  });
};

export const deriveHudViewModel = (
  state: GameState,
  playerId: number,
  planning: PlanningSnapshot,
): HudViewModel => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);

  const selectedShip = getSelectedShip(
    state,
    playerId,
    planning.selectedShipId,
  );

  const stats = selectedShip ? SHIP_STATS[selectedShip.type] : null;
  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);

  const getOrdnanceActionState = (
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
        error === 'Only warships and orbital bases can launch torpedoes'
          ? 'Warships only'
          : (error ?? ''),
    };
  };

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
    allShipsHaveBurns: myShips
      .filter(isOrderableShip)
      .every((s) => (planning.burns.get(s.id) ?? null) !== null),
    multipleShipsAlive: myShips.filter(isOrderableShip).length > 1,
    speed: selectedShip ? hexVecLength(selectedShip.velocity) : 0,
    fuelToStop: selectedShip ? hexVecLength(selectedShip.velocity) : 0,
    launchMineState: getOrdnanceActionState('mine'),
    launchTorpedoState: getOrdnanceActionState('torpedo'),
    launchNukeState: getOrdnanceActionState('nuke'),
  };
};

export const getGameOverStats = (
  state: GameState,
  playerId: number,
): GameOverStats => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);

  const enemyShips = state.ships.filter((ship) => ship.owner !== playerId);

  return {
    turns: state.turnNumber,
    myShipsAlive: count(myShips, (ship) => ship.lifecycle !== 'destroyed'),
    myShipsTotal: myShips.length,
    enemyShipsAlive: count(
      enemyShips,
      (ship) => ship.lifecycle !== 'destroyed',
    ),
    enemyShipsTotal: enemyShips.length,
  };
};

export const getScenarioBriefingLines = (
  state: GameState,
  playerId: number,
): string[] => {
  const player = state.players[playerId];

  const myShips = state.ships.filter((ship) => ship.owner === playerId);

  const shipNames = myShips
    .map((ship) => SHIP_STATS[ship.type]?.name ?? ship.type)
    .join(', ');

  const lines = [`Your fleet: ${shipNames}`];

  if (state.scenarioRules.checkpointBodies) {
    lines.push(
      `Objective: Visit all ${state.scenarioRules.checkpointBodies.length} major bodies, then land on ${player.homeBody}`,
    );
    lines.push('No combat — race only');

    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 760;
    lines.push(isMobile ? 'Tap ? for controls' : 'Press ? for controls help');

    return lines;
  }

  const hasFugitiveShip = myShips.some((ship) => ship.identity?.hasFugitives);

  const facingFugitives = state.scenarioRules.hiddenIdentityInspection;

  if (hasFugitiveShip) {
    lines.push('Objective: Get the ★ ship off the map!');
  } else if (facingFugitives) {
    lines.push(
      'Objective: Inspect transports, then capture or destroy the fugitives.',
    );
  } else if (player.escapeWins) {
    lines.push('Objective: Escape the solar system!');
  } else if (player.targetBody) {
    lines.push(`Objective: Land on ${player.targetBody}`);
  } else {
    lines.push('Objective: Destroy all enemy ships!');
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 760;
  lines.push(isMobile ? 'Tap ? for controls' : 'Press ? for controls help');

  return lines;
};
