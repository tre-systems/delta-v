import {
  BASE_DETECTION_RANGE,
  SHIP_DETECTION_RANGE,
} from '../../shared/constants';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  hexAdd,
  hexKey,
  hexToPixel,
  hexVecLength,
  type PixelCoord,
  parseHexKey,
} from '../../shared/hex';
import { predictDestination } from '../../shared/movement';
import type {
  GameState,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';

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
  arrowHead: {
    left: PixelCoord;
    right: PixelCoord;
  } | null;
  ghostDot: {
    position: PixelCoord;
    color: string;
    radius: number;
  } | null;
  speedLabel: {
    text: string;
    position: PixelCoord;
    color: string;
  } | null;
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
    (ship) =>
      ship.id === selectedShipId &&
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed',
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

    views.push({
      center: hexToPixel(parseHexKey(key), hexSize),
      radius: BASE_DETECTION_RANGE * hexSize * 1.73,
      color: 'rgba(79, 195, 247, 0.05)',
      lineWidth: 1,
      lineDash: [3, 8],
    });
  }

  return views;
};

const buildArrowHead = (
  from: PixelCoord,
  to: PixelCoord,
  headLen: number,
): { left: PixelCoord; right: PixelCoord } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return { left: to, right: to };

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  return {
    left: {
      x: to.x - ux * headLen + px * headLen * 0.4,
      y: to.y - uy * headLen + py * headLen * 0.4,
    },
    right: {
      x: to.x - ux * headLen - px * headLen * 0.4,
      y: to.y - uy * headLen - py * headLen * 0.4,
    },
  };
};

export const buildVelocityVectorViews = (
  state: GameState,
  playerId: number,
  hexSize: number,
): VelocityVectorView[] => {
  const views: VelocityVectorView[] = [];

  // Ship vectors
  for (const ship of state.ships) {
    if (
      ship.lifecycle !== 'active' ||
      (ship.owner !== playerId && !ship.detected)
    ) {
      continue;
    }

    const from = hexToPixel(ship.position, hexSize);
    const predicted = predictDestination(ship);
    const to = hexToPixel(predicted, hexSize);

    if (predicted.q === ship.position.q && predicted.r === ship.position.r) {
      continue;
    }

    const isOwn = ship.owner === playerId;
    const speed = hexVecLength(ship.velocity);
    const color = isOwn
      ? 'rgba(79, 195, 247, 0.45)'
      : 'rgba(255, 152, 0, 0.45)';

    views.push({
      from,
      to,
      color,
      lineWidth: 1.5,
      lineDash: [4, 4],
      arrowHead: buildArrowHead(from, to, 6),
      ghostDot: isOwn
        ? {
            position: to,
            color: 'rgba(79, 195, 247, 0.3)',
            radius: 4,
          }
        : null,
      speedLabel:
        !isOwn && speed >= 1
          ? {
              text: `v${Math.round(speed)}`,
              position: {
                x: (from.x + to.x) / 2,
                y: (from.y + to.y) / 2 - 5,
              },
              color: 'rgba(255, 152, 0, 0.5)',
            }
          : null,
    });
  }

  // Ordnance vectors (torpedoes, nukes)
  for (const ordnance of state.ordnance) {
    if (ordnance.lifecycle !== 'active' || ordnance.type === 'mine') {
      continue;
    }

    const from = hexToPixel(ordnance.position, hexSize);
    const predicted = predictDestination(ordnance);
    const to = hexToPixel(predicted, hexSize);

    if (
      predicted.q === ordnance.position.q &&
      predicted.r === ordnance.position.r
    ) {
      continue;
    }

    const isOwn = ordnance.owner === playerId;
    const color = isOwn ? 'rgba(79, 195, 247, 0.2)' : 'rgba(255, 152, 0, 0.2)';

    views.push({
      from,
      to,
      color,
      lineWidth: 1,
      lineDash: [2, 4],
      arrowHead: buildArrowHead(from, to, 4),
      ghostDot: null,
      speedLabel: null,
    });
  }

  return views;
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

    if (ship.owner !== playerId && !ship.detected) {
      continue;
    }

    const isOwn = ship.owner === playerId;

    views.push({
      points: trail.map((hex) => hexToPixel(hex, hexSize)),
      lineColor: isOwn ? 'rgba(79, 195, 247, 0.12)' : 'rgba(255, 152, 0, 0.12)',
      lineWidth: 1.25,
      lineDash: [],
      waypointColor: isOwn
        ? 'rgba(79, 195, 247, 0.16)'
        : 'rgba(255, 152, 0, 0.16)',
      waypointRadius: 1.25,
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

    const ordnance = state.ordnance.find(
      (candidate) => candidate.id === ordnanceId,
    );
    const isOwn = ordnance ? ordnance.owner === playerId : false;

    views.push({
      points: trail.map((hex) => hexToPixel(hex, hexSize)),
      lineColor: isOwn ? 'rgba(79, 195, 247, 0.07)' : 'rgba(255, 152, 0, 0.07)',
      lineWidth: 1,
      lineDash: [2, 4],
      waypointColor: null,
      waypointRadius: 0,
    });
  }

  return views;
};

export interface BaseThreatView {
  hexCenter: PixelCoord;
  radius: number;
}

export const buildBaseThreatZoneViews = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  hexSize: number,
): BaseThreatView[] => {
  const views: BaseThreatView[] = [];
  const destroyed = new Set(state.destroyedBases);
  const seen = new Set<string>();

  for (let p = 0; p < state.players.length; p++) {
    if (p === playerId) continue;
    for (const key of state.players[p]?.bases ?? []) {
      if (destroyed.has(key)) continue;

      const hex = map.hexes.get(key);

      if (!hex?.base) continue;

      const baseCoord = parseHexKey(key);

      for (const dir of HEX_DIRECTIONS) {
        const adj = hexAdd(baseCoord, dir);
        const adjKey = hexKey(adj);

        if (seen.has(adjKey)) continue;

        const adjHex = map.hexes.get(adjKey);

        if (!adjHex?.gravity) continue;

        if (adjHex.gravity.bodyName !== hex.base.bodyName) {
          continue;
        }

        seen.add(adjKey);
        views.push({
          hexCenter: hexToPixel(adj, hexSize),
          radius: hexSize * 0.85,
        });
      }
    }
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
    const ship = state.ships.find(
      (candidate) => candidate.id === movement.shipId,
    );

    if (!ship) continue;

    if (ship.owner !== playerId && !ship.detected) {
      continue;
    }

    if (movement.path.length < 2) continue;

    const totalSegments = movement.path.length - 1;
    const passedSegments = Math.floor(progress * totalSegments);

    const color =
      ship.owner === playerId
        ? 'rgba(79, 195, 247, 0.22)'
        : 'rgba(255, 152, 0, 0.22)';

    views.push({
      points: movement.path.map((hex) => hexToPixel(hex, hexSize)),
      color,
      lineWidth: 1.25,
      lineDash: [3, 5],
      passedWaypoints: movement.path
        .slice(1, Math.min(passedSegments + 1, movement.path.length))
        .map((hex) => hexToPixel(hex, hexSize)),
      waypointRadius: 1.75,
    });
  }

  return views;
};
