import type { HexCoord } from '../../shared/hex';
import { hexToPixel } from '../../shared/hex';
import type { GameState, Ship } from '../../shared/types/domain';

const getOwnedShips = (state: GameState, playerId: number): Ship[] => {
  return state.ships.filter(
    (ship) => ship.owner === playerId && !ship.destroyed,
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
    (ship) => ship.owner !== playerId && !ship.destroyed && ship.detected,
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
