import { getEscapeEdge, isOrderableShip } from '../../shared/engine/util';
import { getFugitiveShip } from '../../shared/engine/victory';
import { type HexCoord, hexDistance, hexToPixel } from '../../shared/hex';
import type {
  GameState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';

const getOwnedShips = (state: GameState, playerId: number): Ship[] => {
  return state.ships.filter(
    (ship) => ship.owner === playerId && isOrderableShip(ship),
  );
};

export const getNextSelectedShip = (
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
  direction: number,
): Ship | null => {
  const ships = getOwnedShips(state, playerId);

  if (ships.length <= 1) {
    return null;
  }

  const currentIndex = ships.findIndex((ship) => ship.id === selectedShipId);
  const nextIndex = (currentIndex + direction + ships.length) % ships.length;

  return ships[nextIndex];
};

export const getNearestEnemyPosition = (
  state: GameState,
  playerId: number,
  cameraX: number,
  cameraY: number,
  hexSize: number,
): HexCoord | null => {
  const enemies = state.ships.filter(
    (ship) =>
      ship.owner !== playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.detected,
  );

  if (enemies.length === 0) {
    return null;
  }

  const distanceTo = (ship: Ship): number => {
    const pixel = hexToPixel(ship.position, hexSize);
    const dx = pixel.x - cameraX;
    const dy = pixel.y - cameraY;

    return dx * dx + dy * dy;
  };

  const nearest = enemies.reduce((best, enemy) =>
    distanceTo(enemy) < distanceTo(best) ? enemy : best,
  );

  return nearest.position;
};

export const getOwnFleetFocusPosition = (
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
): HexCoord | null => {
  const ships = getOwnedShips(state, playerId);

  if (ships.length === 0) {
    return null;
  }

  return (
    ships.find((ship) => ship.id === selectedShipId)?.position ??
    ships[0].position
  );
};

const escapeHintHex = (
  from: HexCoord,
  bounds: SolarSystemMap['bounds'],
  edge: ReturnType<typeof getEscapeEdge>,
): HexCoord => {
  const margin = 5;

  if (edge === 'north') {
    return { q: from.q, r: bounds.minR - margin };
  }

  const candidates: HexCoord[] = [
    { q: bounds.minQ - margin, r: from.r },
    { q: bounds.maxQ + margin, r: from.r },
    { q: from.q, r: bounds.minR - margin },
    { q: from.q, r: bounds.maxR + margin },
  ];

  return candidates.reduce((best, c) =>
    hexDistance(from, c) < hexDistance(from, best) ? c : best,
  );
};

/** Hex to aim the minimap objective arrow toward (mirrors HUD objective modes). */
export const getObjectiveBearingTargetHex = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  fromShip: Pick<Ship, 'position'> | null,
): HexCoord | null => {
  if (!fromShip) {
    return null;
  }

  const player = state.players[playerId];

  const checkpoints = state.scenarioRules.checkpointBodies;

  if (checkpoints && checkpoints.length > 0) {
    const visited = new Set(player.visitedBodies ?? []);
    const nextName = checkpoints.find((b) => !visited.has(b));

    if (nextName) {
      const body = map.bodies.find((b) => b.name === nextName);

      return body?.center ?? null;
    }

    const home = map.bodies.find((b) => b.name === player.homeBody);

    return home?.center ?? null;
  }

  if (player.escapeWins) {
    return escapeHintHex(fromShip.position, map.bounds, getEscapeEdge(state));
  }

  if (state.scenarioRules.hiddenIdentityInspection) {
    const fugitive = getFugitiveShip(state);

    if (!fugitive || fugitive.lifecycle === 'destroyed') {
      return null;
    }

    if (fugitive.owner === playerId || fugitive.detected) {
      return fugitive.position;
    }

    return null;
  }

  if (player.targetBody) {
    const body = map.bodies.find((b) => b.name === player.targetBody);

    return body?.center ?? null;
  }

  const enemies = state.ships.filter(
    (ship) =>
      ship.owner !== playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.detected,
  );

  if (enemies.length === 0) {
    return null;
  }

  return enemies.reduce((best, ship) =>
    hexDistance(fromShip.position, ship.position) <
    hexDistance(fromShip.position, best.position)
      ? ship
      : best,
  ).position;
};
