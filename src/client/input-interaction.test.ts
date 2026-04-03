import { describe, expect, it, vi } from 'vitest';

import type { SolarSystemMap } from '../shared/types/domain';
import { createMinimapLayout, projectWorldToMinimap } from './game/minimap';
import {
  createPointerInteractionManager,
  getPinchDistance,
  getWheelZoomFactor,
  resolveMinimapCameraTarget,
} from './input-interaction';

const createCamera = () => {
  return {
    pan: vi.fn<(dx: number, dy: number) => void>(),
    screenToWorld: (x: number, y: number) => ({ x, y }),
  };
};

const simpleMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: {
    minQ: -2,
    maxQ: 4,
    minR: -1,
    maxR: 3,
  },
};

describe('input interaction helpers', () => {
  it('deduplicates hover hexes until the pointer crosses into a new hex', () => {
    const camera = createCamera();
    const interactions = createPointerInteractionManager(28);

    const firstHover = interactions.handlePointerMove(camera, 0, 0);
    const repeatedHover = interactions.handlePointerMove(camera, 1, 1);
    const nextHover = interactions.handlePointerMove(camera, 40, 0);

    expect(firstHover).toEqual({ q: 0, r: 0 });
    expect(repeatedHover).toBeNull();
    expect(nextHover).not.toBeNull();
    expect(camera.pan).not.toHaveBeenCalled();
  });

  it('starts panning after the mouse drag threshold and suppresses click completion', () => {
    const camera = createCamera();
    const interactions = createPointerInteractionManager(28);

    interactions.beginPointer(10, 10);
    interactions.handlePointerMove(camera, 20, 16);

    expect(camera.pan).toHaveBeenCalledWith(10, 6);
    expect(interactions.endPointer(20, 16)).toBeNull();
  });

  it('keeps a short touch move as a tap until the larger touch threshold is crossed', () => {
    const camera = createCamera();
    const interactions = createPointerInteractionManager(28);

    interactions.beginPointer(10, 10, true);
    interactions.handlePointerMove(camera, 15, 15);

    expect(camera.pan).not.toHaveBeenCalled();
    expect(interactions.endPointer(15, 15)).toEqual({ x: 15, y: 15 });
  });

  it('ignores pointer end events when no pointer is active', () => {
    const interactions = createPointerInteractionManager(28);

    expect(interactions.endPointer(10, 10)).toBeNull();
  });

  it('computes pinch and wheel zoom factors', () => {
    const interactions = createPointerInteractionManager(28);

    expect(getPinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(getWheelZoomFactor(120, false)).toBeCloseTo(0.88);
    expect(getWheelZoomFactor(10, true)).toBeCloseTo(0.9);

    interactions.beginPinch(100);
    expect(interactions.updatePinch(125)).toBeCloseTo(1.25);
    interactions.clearPinch();
    expect(interactions.updatePinch(150)).toBeNull();
  });

  it('projects minimap clicks back into world coordinates', () => {
    const screenWidth = 1200;
    const screenHeight = 800;
    const layout = createMinimapLayout(
      simpleMap.bounds,
      screenWidth,
      screenHeight,
      28,
      0,
    );
    const worldTarget = { x: 0, y: 0 };
    const minimapPoint = projectWorldToMinimap(layout, worldTarget);

    const resolvedTarget = resolveMinimapCameraTarget({
      map: simpleMap,
      screenWidth,
      screenHeight,
      screenX: minimapPoint.x,
      screenY: minimapPoint.y,
      hexSize: 28,
      hudTopOffset: 0,
      hudBottomOffset: 0,
    });

    expect(resolvedTarget?.x).toBeCloseTo(worldTarget.x);
    expect(resolvedTarget?.y).toBeCloseTo(worldTarget.y);
    expect(
      resolveMinimapCameraTarget({
        map: simpleMap,
        screenWidth,
        screenHeight,
        screenX: layout.x - 4,
        screenY: layout.y - 4,
        hexSize: 28,
        hudTopOffset: 0,
        hudBottomOffset: 0,
      }),
    ).toBeNull();
  });
});
