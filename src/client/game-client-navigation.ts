import type { HexCoord } from '../shared/hex';
import { hexToPixel } from '../shared/hex';
import type { GameState, Ship } from '../shared/types';

function getOwnedShips(state: GameState, playerId: number): Ship[] {
  return state.ships.filter((ship) => ship.owner === playerId && !ship.destroyed);
}

export function getNextSelectedShip(
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
  direction: number,
): Ship | null {
  const ships = getOwnedShips(state, playerId);
  if (ships.length <= 1) {
    return null;
  }
  const currentIndex = ships.findIndex((ship) => ship.id === selectedShipId);
  const nextIndex = (currentIndex + direction + ships.length) % ships.length;
  return ships[nextIndex];
}

export function getNearestEnemyPosition(
  state: GameState,
  playerId: number,
  cameraX: number,
  cameraY: number,
  hexSize: number,
): HexCoord | null {
  const enemies = state.ships.filter((ship) => ship.owner !== playerId && !ship.destroyed && ship.detected);
  if (enemies.length === 0) {
    return null;
  }

  let nearest = enemies[0];
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    const pixel = hexToPixel(enemy.position, hexSize);
    const dx = pixel.x - cameraX;
    const dy = pixel.y - cameraY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = enemy;
    }
  }
  return nearest.position;
}

export function getOwnFleetFocusPosition(
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
): HexCoord | null {
  const ships = getOwnedShips(state, playerId);
  if (ships.length === 0) {
    return null;
  }
  return ships.find((ship) => ship.id === selectedShipId)?.position ?? ships[0].position;
}
