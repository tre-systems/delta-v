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
  playerId: PlayerId | -1,
  selectedId: string | null,
) => {
  if (playerId < 0) return null;
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
  playerId: PlayerId | -1,
): GameOverStats => {
  if (playerId < 0) {
    // Basic stats for spectator
    return {
      playerId,
      scenario: state.scenario,
      turns: state.turnNumber,
      myShipsAlive: 0,
      myShipsTotal: 0,
      enemyShipsAlive: 0,
      enemyShipsTotal: 0,
      myShipsDestroyed: 0,
      enemyShipsDestroyed: 0,
      myFuelSpent: 0,
      enemyFuelSpent: 0,
      basesDestroyed: state.destroyedBases.length,
      ordnanceInFlight: count(state.ordnance, (o) => o.lifecycle === 'active'),
      shipFates: [],
    };
  }
  const pid = playerId as PlayerId;
  const myShips = state.ships.filter((ship) => ship.owner === pid);
  const enemyShips = state.ships.filter((ship) => ship.owner !== pid);
  const enemyId = (pid === 0 ? 1 : 0) as PlayerId;

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
    myFuelSpent: state.players[pid]?.totalFuelSpent ?? 0,
    enemyFuelSpent: state.players[enemyId]?.totalFuelSpent ?? 0,
    basesDestroyed: state.destroyedBases.length,
    ordnanceInFlight: count(state.ordnance, (o) => o.lifecycle === 'active'),
    shipFates,
  };
};

export const getScenarioBriefingLines = (
  state: GameState,
  playerId: PlayerId | -1,
): string[] => {
  if (playerId < 0) {
    return ['Spectating - watch the battle unfold!'];
  }
  const pid = playerId as PlayerId;
  const player = state.players[pid];
  const myShips = state.ships.filter((ship) => ship.owner === pid);

  const shipNames = myShips
    .map((ship) => SHIP_STATS[ship.type]?.name ?? ship.type)
    .join(', ');

  const lines = [`Your fleet: ${shipNames}`];

  if (state.scenarioRules.checkpointBodies) {
    lines.push('No combat — race only');
    return lines;
  }

  const hasFugitiveShip = myShips.some((ship) => ship.identity?.hasFugitives);
  const facingFugitives = state.scenarioRules.hiddenIdentityInspection;

  if (hasFugitiveShip) {
    lines.push('Your ★ ship carries the fugitives');
  } else if (facingFugitives) {
    lines.push('Inspect transports to find the fugitives');
  } else if (player?.escapeWins) {
    lines.push('Escape the solar system to win');
  }

  return lines;
};
