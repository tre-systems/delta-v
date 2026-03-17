import { BASE_DETECTION_RANGE, SHIP_DETECTION_RANGE } from '../../shared/constants';
import { type HexCoord, hexToPixel, hexVecLength, type PixelCoord } from '../../shared/hex';
import { predictDestination } from '../../shared/movement';
import type { GameState, ShipMovement, SolarSystemMap } from '../../shared/types';

export interface CircleOverlayView {
  center: PixelCoord;
  radius: number;
  color: string;
  lineWidth: number;
  lineDash: number[];
}

export interface TrailView {
  points: PixelCoord[];
  lineColor: string;
  lineWidth: number;
  lineDash: number[];
  waypointColor: string | null;
  waypointRadius: number;
}

export interface VelocityVectorView {
  from: PixelCoord;
  to: PixelCoord;
  color: string;
  lineWidth: number;
  lineDash: number[];
  speedLabel: { text: string; position: PixelCoord; color: string } | null;
}

export interface MovementPathView {
  points: PixelCoord[];
  color: string;
  lineWidth: number;
  lineDash: number[];
  passedWaypoints: PixelCoord[];
  waypointRadius: number;
}

export const buildDetectionRangeViews = (
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
  map: SolarSystemMap,
  hexSize: number,
): CircleOverlayView[] => {
  const views: CircleOverlayView[] = [];
  const selectedShip = state.ships.find(
    (ship) => ship.id === selectedShipId && ship.owner === playerId && !ship.destroyed,
  );
  if (selectedShip) {
    views.push({
      center: hexToPixel(selectedShip.position, hexSize),
      radius: SHIP_DETECTION_RANGE * hexSize * 1.73,
      color: 'rgba(79, 195, 247, 0.08)',
      lineWidth: 1,
      lineDash: [4, 6],
    });
  }

  const player = playerId >= 0 ? state.players[playerId] : null;
  const destroyed = new Set(state.destroyedBases);
  for (const key of player?.bases ?? []) {
    if (destroyed.has(key)) continue;
    const hex = map.hexes.get(key);
    if (!hex?.base) continue;
    const [q, r] = key.split(',').map(Number);
    views.push({
      center: hexToPixel({ q, r }, hexSize),
      radius: BASE_DETECTION_RANGE * hexSize * 1.73,
      color: 'rgba(79, 195, 247, 0.05)',
      lineWidth: 1,
      lineDash: [3, 8],
    });
  }

  return views;
};

export const buildVelocityVectorViews = (state: GameState, playerId: number, hexSize: number): VelocityVectorView[] => {
  return state.ships
    .filter((ship) => !ship.landed && !ship.destroyed && (ship.owner === playerId || ship.detected))
    .map((ship) => {
      const from = hexToPixel(ship.position, hexSize);
      const predicted = predictDestination(ship);
      const to = hexToPixel(predicted, hexSize);
      if (predicted.q === ship.position.q && predicted.r === ship.position.r) return null;
      const isOwn = ship.owner === playerId;
      const speed = hexVecLength(ship.velocity);
      const speedLabel =
        !isOwn && speed >= 1
          ? {
              text: `v${Math.round(speed)}`,
              position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 5 },
              color: 'rgba(255, 152, 0, 0.5)',
            }
          : null;
      return {
        from,
        to,
        color: isOwn ? 'rgba(79, 195, 247, 0.45)' : 'rgba(255, 152, 0, 0.45)',
        lineWidth: 1.5,
        lineDash: [4, 4],
        speedLabel,
      };
    })
    .filter((view): view is VelocityVectorView => view !== null);
};

export const buildShipTrailViews = (
  state: GameState,
  playerId: number,
  shipTrails: Map<string, HexCoord[]>,
  hexSize: number,
): TrailView[] => {
  const views: TrailView[] = [];
  for (const [shipId, trail] of shipTrails) {
    if (trail.length < 2) continue;
    const ship = state.ships.find((candidate) => candidate.id === shipId);
    if (!ship) continue;
    if (ship.owner !== playerId && !ship.detected) continue;
    const isOwn = ship.owner === playerId;
    views.push({
      points: trail.map((hex) => hexToPixel(hex, hexSize)),
      lineColor: isOwn ? 'rgba(79, 195, 247, 0.28)' : 'rgba(255, 152, 0, 0.28)',
      lineWidth: 1.5,
      lineDash: [],
      waypointColor: isOwn ? 'rgba(79, 195, 247, 0.35)' : 'rgba(255, 152, 0, 0.35)',
      waypointRadius: 1.5,
    });
  }
  return views;
};

export const buildOrdnanceTrailViews = (
  state: GameState,
  playerId: number,
  ordnanceTrails: Map<string, HexCoord[]>,
  hexSize: number,
): TrailView[] => {
  const views: TrailView[] = [];
  for (const [ordnanceId, trail] of ordnanceTrails) {
    if (trail.length < 2) continue;
    const ordnance = state.ordnance.find((candidate) => candidate.id === ordnanceId);
    const isOwn = ordnance ? ordnance.owner === playerId : false;
    views.push({
      points: trail.map((hex) => hexToPixel(hex, hexSize)),
      lineColor: isOwn ? 'rgba(79, 195, 247, 0.1)' : 'rgba(255, 152, 0, 0.1)',
      lineWidth: 1,
      lineDash: [2, 4],
      waypointColor: null,
      waypointRadius: 0,
    });
  }
  return views;
};

export const buildMovementPathViews = (
  state: GameState,
  playerId: number,
  movements: ShipMovement[],
  progress: number,
  hexSize: number,
): MovementPathView[] => {
  const views: MovementPathView[] = [];
  for (const movement of movements) {
    const ship = state.ships.find((candidate) => candidate.id === movement.shipId);
    if (!ship) continue;
    if (ship.owner !== playerId && !ship.detected) continue;
    if (movement.path.length < 2) continue;
    const totalSegments = movement.path.length - 1;
    const passedSegments = Math.floor(progress * totalSegments);
    const color = ship.owner === playerId ? 'rgba(79, 195, 247, 0.4)' : 'rgba(255, 152, 0, 0.4)';
    views.push({
      points: movement.path.map((hex) => hexToPixel(hex, hexSize)),
      color,
      lineWidth: 1.5,
      lineDash: [3, 5],
      passedWaypoints: movement.path
        .slice(1, Math.min(passedSegments + 1, movement.path.length))
        .map((hex) => hexToPixel(hex, hexSize)),
      waypointRadius: 2,
    });
  }
  return views;
};
