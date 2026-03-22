import {
  type HexCoord,
  hexEqual,
  type PixelCoord,
  pixelToHex,
} from '../shared/hex';
import type { SolarSystemMap } from '../shared/types/domain';
import {
  createMinimapLayout,
  isPointInMinimap,
  projectMinimapToWorld,
  type ScreenPoint,
} from './game/minimap';

export interface InputCameraLike {
  pan: (dx: number, dy: number) => void;
  screenToWorld: (sx: number, sy: number) => PixelCoord;
}

export interface PointerInteractionManager {
  beginPointer: (x: number, y: number, touch?: boolean) => void;
  handlePointerMove: (
    camera: InputCameraLike,
    x: number,
    y: number,
  ) => HexCoord | null;
  endPointer: (x?: number, y?: number) => ScreenPoint | null;
  beginPinch: (distance: number) => void;
  updatePinch: (distance: number) => number | null;
  clearPinch: () => void;
}

interface ResolveMinimapCameraTargetInput {
  map: SolarSystemMap | null;
  screenWidth: number;
  screenHeight: number;
  screenX: number;
  screenY: number;
  hexSize: number;
  hudTopOffset: number;
}

const TOUCH_DRAG_THRESHOLD = 8;
const MOUSE_DRAG_THRESHOLD = 3;

export const createPointerInteractionManager = (
  hexSize: number,
): PointerInteractionManager => {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragMoved = false;
  let isTouch = false;
  let lastPinchDist = 0;
  let lastHoverHex: HexCoord | null = null;

  const beginPointer = (x: number, y: number, touch = false): void => {
    isDragging = true;
    isTouch = touch;
    dragStartX = x;
    dragStartY = y;
    dragMoved = false;
  };

  const handlePointerMove = (
    camera: InputCameraLike,
    x: number,
    y: number,
  ): HexCoord | null => {
    if (isDragging) {
      const dx = x - dragStartX;
      const dy = y - dragStartY;
      const threshold = isTouch ? TOUCH_DRAG_THRESHOLD : MOUSE_DRAG_THRESHOLD;

      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        dragMoved = true;
      }

      if (dragMoved) {
        camera.pan(dx, dy);
        dragStartX = x;
        dragStartY = y;
      }
    }

    const worldPos = camera.screenToWorld(x, y);
    const hex = pixelToHex(worldPos, hexSize);

    if (!lastHoverHex || !hexEqual(hex, lastHoverHex)) {
      lastHoverHex = hex;
      return hex;
    }

    return null;
  };

  const endPointer = (x = dragStartX, y = dragStartY): ScreenPoint | null => {
    isDragging = false;

    return dragMoved ? null : { x, y };
  };

  const beginPinch = (distance: number): void => {
    isDragging = false;
    lastPinchDist = distance;
  };

  const updatePinch = (distance: number): number | null => {
    if (lastPinchDist <= 0) {
      lastPinchDist = distance;
      return null;
    }

    const factor = distance / lastPinchDist;
    lastPinchDist = distance;

    return factor;
  };

  const clearPinch = (): void => {
    lastPinchDist = 0;
  };

  return {
    beginPointer,
    handlePointerMove,
    endPointer,
    beginPinch,
    updatePinch,
    clearPinch,
  };
};

export const getPinchDistance = (
  first: ScreenPoint,
  second: ScreenPoint,
): number => {
  const dx = first.x - second.x;
  const dy = first.y - second.y;

  return Math.sqrt(dx * dx + dy * dy);
};

export const getWheelZoomFactor = (
  deltaY: number,
  ctrlKey: boolean,
): number => {
  return 1 - deltaY * (ctrlKey ? 0.01 : 0.001);
};

export const resolveMinimapCameraTarget = ({
  map,
  screenWidth,
  screenHeight,
  screenX,
  screenY,
  hexSize,
  hudTopOffset,
}: ResolveMinimapCameraTargetInput): ScreenPoint | null => {
  if (!map) {
    return null;
  }

  const layout = createMinimapLayout(
    map.bounds,
    screenWidth,
    screenHeight,
    hexSize,
    hudTopOffset,
  );

  if (!isPointInMinimap(layout, { x: screenX, y: screenY })) {
    return null;
  }

  return projectMinimapToWorld(layout, {
    x: screenX,
    y: screenY,
  });
};
