import { type HexCoord, hexToPixel } from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  clipViewportToMinimap,
  type MinimapLayout,
  projectWorldToMinimap,
  type ScreenPoint,
  type ScreenRect,
} from '../game/minimap';
import { getObjectiveBearingTargetHex } from '../game/navigation';

export interface MinimapCameraView {
  x: number;
  y: number;
  zoom: number;
}

export interface MinimapDotView {
  position: ScreenPoint;
  radius: number;
  color: string;
  alpha: number;
}

export interface MinimapTrailView {
  points: ScreenPoint[];
  color: string;
}

export interface MinimapObjectiveBearingView {
  from: ScreenPoint;
  to: ScreenPoint;
}

export interface MinimapSceneView {
  bodies: MinimapDotView[];
  shipTrails: MinimapTrailView[];
  ships: MinimapDotView[];
  ordnance: MinimapDotView[];
  viewport: ScreenRect | null;
  objectiveBearing: MinimapObjectiveBearingView | null;
}

const projectHex = (
  layout: MinimapLayout,
  coord: HexCoord,
  hexSize: number,
): ScreenPoint => {
  const point = hexToPixel(coord, hexSize);

  return projectWorldToMinimap(layout, point);
};

const buildBodyDots = (
  map: SolarSystemMap,
  layout: MinimapLayout,
  hexSize: number,
): MinimapDotView[] => {
  return map.bodies.map((body) => ({
    position: projectHex(layout, body.center, hexSize),
    radius: Math.max(2, body.renderRadius * hexSize * layout.scale * 0.5),
    color: body.color,
    alpha: 0.7,
  }));
};

const buildShipTrailViews = (
  state: GameState,
  playerId: PlayerId,
  shipTrails: Map<string, HexCoord[]>,
  layout: MinimapLayout,
  hexSize: number,
): MinimapTrailView[] => {
  const trails: MinimapTrailView[] = [];

  for (const [shipId, trail] of shipTrails) {
    if (trail.length < 2) continue;

    const ship = state.ships.find((candidate) => candidate.id === shipId);

    if (!ship) continue;

    if (ship.owner !== playerId && !ship.detected) {
      continue;
    }

    trails.push({
      points: trail.map((hex) => projectHex(layout, hex, hexSize)),
      color:
        ship.owner === playerId
          ? 'rgba(79, 195, 247, 0.14)'
          : 'rgba(255, 138, 101, 0.14)',
    });
  }

  return trails;
};

const buildShipDots = (
  state: GameState,
  playerId: PlayerId,
  layout: MinimapLayout,
  hexSize: number,
): MinimapDotView[] => {
  return state.ships
    .filter(
      (ship) =>
        ship.lifecycle !== 'destroyed' &&
        (ship.owner === playerId || ship.detected),
    )
    .map((ship) => ({
      position: projectHex(layout, ship.position, hexSize),
      radius: 2.5,
      color: ship.owner === playerId ? '#4fc3f7' : '#ff8a65',
      alpha: 1,
    }));
};

const buildOrdnanceDots = (
  state: GameState,
  layout: MinimapLayout,
  hexSize: number,
): MinimapDotView[] => {
  return state.ordnance
    .filter((ordnance) => ordnance.lifecycle !== 'destroyed')
    .map((ordnance) => ({
      position: projectHex(layout, ordnance.position, hexSize),
      radius: 1.5,
      color: ordnance.type === 'nuke' ? '#ff4444' : '#ffb74d',
      alpha: 0.6,
    }));
};

const buildViewportView = (
  layout: MinimapLayout,
  camera: MinimapCameraView,
  screenWidth: number,
  screenHeight: number,
): ScreenRect | null => {
  const vpHalfW = screenWidth / 2 / camera.zoom;
  const vpHalfH = screenHeight / 2 / camera.zoom;

  const topLeft = projectWorldToMinimap(layout, {
    x: camera.x - vpHalfW,
    y: camera.y - vpHalfH,
  });

  const bottomRight = projectWorldToMinimap(layout, {
    x: camera.x + vpHalfW,
    y: camera.y + vpHalfH,
  });

  const viewport = clipViewportToMinimap(layout, {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  });

  return viewport.width > 2 && viewport.height > 2 ? viewport : null;
};

export const buildMinimapSceneView = (
  map: SolarSystemMap,
  state: GameState,
  playerId: PlayerId,
  shipTrails: Map<string, HexCoord[]>,
  layout: MinimapLayout,
  camera: MinimapCameraView,
  screenWidth: number,
  screenHeight: number,
  hexSize: number,
  selectedShipId: string | null,
): MinimapSceneView => {
  const selectedShip =
    selectedShipId === null
      ? undefined
      : state.ships.find(
          (ship) =>
            ship.id === selectedShipId && ship.lifecycle !== 'destroyed',
        );

  const targetHex =
    selectedShip &&
    getObjectiveBearingTargetHex(state, playerId, map, selectedShip);

  const objectiveBearing =
    selectedShip && targetHex
      ? {
          from: projectHex(layout, selectedShip.position, hexSize),
          to: projectHex(layout, targetHex, hexSize),
        }
      : null;

  return {
    bodies: buildBodyDots(map, layout, hexSize),
    shipTrails: buildShipTrailViews(
      state,
      playerId,
      shipTrails,
      layout,
      hexSize,
    ),
    ships: buildShipDots(state, playerId, layout, hexSize),
    ordnance: buildOrdnanceDots(state, layout, hexSize),
    viewport: buildViewportView(layout, camera, screenWidth, screenHeight),
    objectiveBearing,
  };
};
