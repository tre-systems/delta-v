import { SHIP_STATS } from '../../shared/constants';
import type { AstrogationOrder, GameState, Ship } from '../../shared/types';
import type { PlanningState } from '../renderer/renderer';

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
}

type PlanningSnapshot = Pick<PlanningState, 'selectedShipId' | 'burns' | 'overloads' | 'weakGravityChoices'>;

const getSelectedShip = (state: GameState, playerId: number, selectedId: string | null) => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);
  return myShips.find((ship) => ship.id === selectedId) ?? myShips.find((ship) => !ship.destroyed) ?? null;
};

const getObjective = (state: GameState, playerId: number): string => {
  const player = state.players[playerId];
  if (state.scenarioRules.checkpointBodies) {
    const visited = player.visitedBodies?.length ?? 0;
    const total = state.scenarioRules.checkpointBodies.length;
    if (visited >= total) return `⬡ Return to ${player.homeBody}`;
    return `⬡ Tour: ${visited}/${total} bodies visited`;
  }
  const hasFugitiveShip = state.ships.some((ship) => ship.owner === playerId && ship.hasFugitives);
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
  const myAlive = myShips.filter((ship) => !ship.destroyed).length;
  const enemyAlive = enemyShips.filter((ship) => !ship.destroyed).length;
  const statusParts: string[] = [];
  if (myShips.length > 1 || enemyShips.length > 1) {
    statusParts.push(`⚔ ${myAlive}v${enemyAlive}`);
  }

  const activeOrdnance = state.ordnance.filter((ordnance) => !ordnance.destroyed);
  if (activeOrdnance.length === 0) {
    return statusParts.join(' ');
  }

  const ordnanceParts: string[] = [];
  const mines = activeOrdnance.filter((ordnance) => ordnance.type === 'mine').length;
  const torpedoes = activeOrdnance.filter((ordnance) => ordnance.type === 'torpedo').length;
  const nukes = activeOrdnance.filter((ordnance) => ordnance.type === 'nuke').length;
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
  return state.ships
    .filter((ship) => ship.owner === playerId)
    .map((ship) => {
      const burn = planning.burns.get(ship.id) ?? null;
      const overload = planning.overloads.get(ship.id) ?? null;
      const weakGravityChoices = planning.weakGravityChoices.get(ship.id);
      const order: AstrogationOrder = { shipId: ship.id, burn };
      if (overload !== null) order.overload = overload;
      if (weakGravityChoices && Object.keys(weakGravityChoices).length > 0) {
        order.weakGravityChoices = weakGravityChoices;
      }
      return order;
    });
};

export const deriveHudViewModel = (state: GameState, playerId: number, planning: PlanningSnapshot): HudViewModel => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);
  const selectedShip = getSelectedShip(state, playerId, planning.selectedShipId);
  const stats = selectedShip ? SHIP_STATS[selectedShip.type] : null;
  return {
    turn: state.turnNumber,
    phase: state.phase,
    isMyTurn: state.activePlayer === playerId,
    myShips,
    selectedId: planning.selectedShipId,
    fuel: selectedShip?.fuel ?? 0,
    maxFuel: stats?.fuel ?? 0,
    hasBurns: Array.from(planning.burns.values()).some((burn) => burn !== null),
    cargoFree: selectedShip && stats ? stats.cargo - selectedShip.cargoUsed : 0,
    cargoMax: stats?.cargo ?? 0,
    objective: getObjective(state, playerId),
    canOverload: stats?.canOverload ?? false,
    canEmplaceBase:
      selectedShip?.carryingOrbitalBase === true && !selectedShip.destroyed && !selectedShip.resuppliedThisTurn,
    fleetStatus: getFleetStatus(state, playerId),
  };
};

export const getGameOverStats = (state: GameState, playerId: number): GameOverStats => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);
  const enemyShips = state.ships.filter((ship) => ship.owner !== playerId);
  return {
    turns: state.turnNumber,
    myShipsAlive: myShips.filter((ship) => !ship.destroyed).length,
    myShipsTotal: myShips.length,
    enemyShipsAlive: enemyShips.filter((ship) => !ship.destroyed).length,
    enemyShipsTotal: enemyShips.length,
  };
};

export const getScenarioBriefingLines = (state: GameState, playerId: number): string[] => {
  const player = state.players[playerId];
  const myShips = state.ships.filter((ship) => ship.owner === playerId);
  const shipNames = myShips.map((ship) => SHIP_STATS[ship.type]?.name ?? ship.type).join(', ');
  const lines = [`Your fleet: ${shipNames}`];
  if (state.scenarioRules.checkpointBodies) {
    lines.push(
      `Objective: Visit all ${state.scenarioRules.checkpointBodies.length} major bodies, then land on ${player.homeBody}`,
    );
    lines.push('No combat — race only');
    lines.push('Press ? for controls help');
    return lines;
  }
  const hasFugitiveShip = myShips.some((ship) => ship.hasFugitives);
  const facingFugitives = state.scenarioRules.hiddenIdentityInspection;
  if (hasFugitiveShip) {
    lines.push('Objective: Get the ★ ship off the map!');
  } else if (facingFugitives) {
    lines.push('Objective: Inspect transports, then capture or destroy the fugitives.');
  } else if (player.escapeWins) {
    lines.push('Objective: Escape the solar system!');
  } else if (player.targetBody) {
    lines.push(`Objective: Land on ${player.targetBody}`);
  } else {
    lines.push('Objective: Destroy all enemy ships!');
  }
  lines.push('Press ? for controls help');
  return lines;
};
