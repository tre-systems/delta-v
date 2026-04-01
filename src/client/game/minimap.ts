import { hexToPixel } from '../../shared/hex';
import type { SolarSystemMap } from '../../shared/types/domain';

export interface MinimapFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
}

export interface MinimapLayout extends MinimapFrame {
  scale: number;
  worldMinX: number;
  worldMinY: number;
  worldWidth: number;
  worldHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

export const getMinimapFrame = (
  screenWidth: number,
  screenHeight: number,
  hudTopOffset = 0,
): MinimapFrame => {
  const isMobile = screenWidth < 600;
  const width = isMobile ? 100 : 140;
  const height = isMobile ? 100 : 140;

  return {
    x: 12,
    y: isMobile ? Math.max(90, hudTopOffset + 8) : screenHeight - height - 12,
    width,
    height,
    padding: 8,
  };
};

export const createMinimapLayout = (
  bounds: SolarSystemMap['bounds'],
  screenWidth: number,
  screenHeight: number,
  hexSize: number,
  hudTopOffset = 0,
): MinimapLayout => {
  const frame = getMinimapFrame(screenWidth, screenHeight, hudTopOffset);

  // x depends only on q, so min/max q give exact left/right edges
  const worldMinX = hexToPixel({ q: bounds.minQ, r: 0 }, hexSize).x;
  const worldMaxX = hexToPixel({ q: bounds.maxQ, r: 0 }, hexSize).x;

  // y depends on both q and r; use central column for a rectangular region
  const midQ = Math.round((bounds.minQ + bounds.maxQ) / 2);
  const worldMinY = hexToPixel({ q: midQ, r: bounds.minR }, hexSize).y;
  const worldMaxY = hexToPixel({ q: midQ, r: bounds.maxR }, hexSize).y;

  const worldWidth = worldMaxX - worldMinX || 1;
  const worldHeight = worldMaxY - worldMinY || 1;

  const innerWidth = frame.width - frame.padding * 2;
  const innerHeight = frame.height - frame.padding * 2;

  const scale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight);

  return {
    ...frame,
    scale,
    worldMinX,
    worldMinY,
    worldWidth,
    worldHeight,
    offsetX: frame.x + frame.padding + (innerWidth - worldWidth * scale) / 2,
    offsetY: frame.y + frame.padding + (innerHeight - worldHeight * scale) / 2,
  };
};

export const isPointInMinimap = (
  frame: MinimapFrame,
  point: ScreenPoint,
): boolean => {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
};

export const projectWorldToMinimap = (
  layout: MinimapLayout,
  point: ScreenPoint,
): ScreenPoint => {
  return {
    x: layout.offsetX + (point.x - layout.worldMinX) * layout.scale,
    y: layout.offsetY + (point.y - layout.worldMinY) * layout.scale,
  };
};

export const projectMinimapToWorld = (
  layout: MinimapLayout,
  point: ScreenPoint,
): ScreenPoint => {
  return {
    x: (point.x - layout.offsetX) / layout.scale + layout.worldMinX,
    y: (point.y - layout.offsetY) / layout.scale + layout.worldMinY,
  };
};

export const clipViewportToMinimap = (
  layout: MinimapLayout,
  viewport: ScreenRect,
): ScreenRect => {
  const x = Math.max(layout.x + 1, viewport.x);
  const y = Math.max(layout.y + 1, viewport.y);

  const right = Math.min(
    layout.x + layout.width - 1,
    viewport.x + viewport.width,
  );

  const bottom = Math.min(
    layout.y + layout.height - 1,
    viewport.y + viewport.height,
  );

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};
