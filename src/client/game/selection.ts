import { SHIP_STATS } from '../../shared/constants';
import {
  type GameState,
  isDestroyed,
  type PlayerId,
} from '../../shared/types/domain';
import { count } from '../../shared/util';
import type { GameOverStats, ShipFate } from './types';

export const getSelectedShip = (
  state: GameState,
  playerId: PlayerId,
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

export const getGameOverStats = (
  state: GameState,
  playerId: PlayerId,
): GameOverStats => {
  const myShips = state.ships.filter((ship) => ship.owner === playerId);
  const enemyShips = state.ships.filter((ship) => ship.owner !== playerId);
  const enemyId: PlayerId = playerId === 0 ? 1 : 0;

  const myDestroyed = count(myShips, (s) => s.lifecycle === 'destroyed');
  const enemyDestroyed = count(enemyShips, (s) => s.lifecycle === 'destroyed');

  // Build numbered names for duplicate ship types per owner
  const nameCounters = new Map<string, number>();

  const getNumberedName = (ship: (typeof state.ships)[0]): string => {
    const base = SHIP_STATS[ship.type]?.name ?? ship.type;
    const key = `${ship.owner}:${ship.type}`;
    const sameType = state.ships.filter(
      (s) => s.owner === ship.owner && s.type === ship.type,
    );

    if (sameType.length <= 1) return base;

    const idx = (nameCounters.get(key) ?? 0) + 1;
    nameCounters.set(key, idx);
    return `${base} ${idx}`;
  };

  // Build a lookup for resolving killedBy ship IDs to names
  const shipNameById = new Map<string, string>();

  const shipFates: ShipFate[] = state.ships.map((s) => {
    const name = getNumberedName(s);
    shipNameById.set(s.id, name);
    return {
      id: s.id,
      name,
      type: s.type,
      status:
        s.lifecycle === 'destroyed'
          ? 'destroyed'
          : s.control === 'captured'
            ? 'captured'
            : 'survived',
      owner: s.owner,
      deathCause: isDestroyed(s) ? s.deathCause : undefined,
      killedBy: isDestroyed(s) ? (s.killedBy ?? undefined) : undefined,
    };
  });

  // Resolve killedBy IDs to names
  for (const fate of shipFates) {
    if (fate.killedBy && shipNameById.has(fate.killedBy)) {
      fate.killedBy = shipNameById.get(fate.killedBy) ?? fate.killedBy;
    }
  }

  return {
    playerId,
    scenario: state.scenario,
    turns: state.turnNumber,
    myShipsAlive: myShips.length - myDestroyed,
    myShipsTotal: myShips.length,
    enemyShipsAlive: enemyShips.length - enemyDestroyed,
    enemyShipsTotal: enemyShips.length,
    myShipsDestroyed: myDestroyed,
    enemyShipsDestroyed: enemyDestroyed,
    myFuelSpent: state.players[playerId]?.totalFuelSpent ?? 0,
    enemyFuelSpent: state.players[enemyId]?.totalFuelSpent ?? 0,
    basesDestroyed: state.destroyedBases.length,
    ordnanceInFlight: count(state.ordnance, (o) => o.lifecycle === 'active'),
    shipFates,
  };
};

export const getScenarioBriefingLines = (
  state: GameState,
  playerId: PlayerId,
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
