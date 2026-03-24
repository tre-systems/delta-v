import { hexToPixel } from '../../shared/hex';
import type {
  GameState,
  OrdnanceMovement,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import { collectAnimatedHexes } from './animation-manager';
import type { Camera } from './camera';

const MIN_FRAME_ZOOM = 0.6;
const MAX_FRAME_ZOOM = 1.8;

export function frameCameraOnAnimatedHexes(
  camera: Camera,
  map: SolarSystemMap | null,
  movements: ShipMovement[],
  ordnanceMovements: OrdnanceMovement[],
  hexSize: number,
  padding: number,
): void {
  const allHexes = collectAnimatedHexes(movements, ordnanceMovements);
  if (!map || allHexes.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const h of allHexes) {
    const p = hexToPixel(h, hexSize);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  camera.frameBounds(minX, maxX, minY, maxY, padding);
}

export function frameCameraOnPlayerShips(
  camera: Camera,
  state: GameState,
  playerId: number,
  hexSize: number,
): void {
  const myShips = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed',
  );
  if (myShips.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of myShips) {
    const p = hexToPixel(s.position, hexSize);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  camera.frameBounds(minX, maxX, minY, maxY, 200);
  camera.targetZoom = Math.max(
    MIN_FRAME_ZOOM,
    Math.min(MAX_FRAME_ZOOM, camera.targetZoom),
  );
}
