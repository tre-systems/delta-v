import { describe, expect, it } from 'vitest';

import { Camera } from './camera';

describe('renderer-camera', () => {
  it('converts between screen and world coordinates', () => {
    const camera = new Camera();
    camera.update(0, 1000, 600);
    camera.x = 120;
    camera.y = -40;
    camera.zoom = 2;

    expect(camera.screenToWorld(500, 300)).toEqual({ x: 120, y: -40 });
    expect(camera.worldToScreen(120, -40)).toEqual({ x: 500, y: 300 });
    expect(camera.worldToScreen(170, 10)).toEqual({ x: 600, y: 400 });
  });

  it('frames bounds using the current canvas size and padding', () => {
    const camera = new Camera();
    camera.update(0, 1000, 500);

    camera.frameBounds(-100, 300, -50, 150, 50);

    expect(camera.targetX).toBe(100);
    expect(camera.targetY).toBe(50);
    expect(camera.targetZoom).toBeCloseTo(5 / 3);
  });

  it('zooms around the cursor and keeps the target point stable', () => {
    const camera = new Camera();
    camera.update(0, 1000, 500);

    camera.zoomAt(600, 300, 2);

    expect(camera.targetZoom).toBe(2);
    expect(camera.targetX).toBe(50);
    expect(camera.targetY).toBe(25);
  });

  it('pans in screen space and clamps visibility checks to the current view', () => {
    const camera = new Camera();
    camera.update(0, 800, 400);
    camera.zoom = 2;
    camera.targetX = 40;
    camera.targetY = -10;

    camera.pan(20, -10);

    expect(camera.targetX).toBe(30);
    expect(camera.targetY).toBe(-5);

    camera.snapToTarget();

    expect(camera.isVisible(30, -5, 0)).toBe(true);
    expect(camera.isVisible(400, 300, 0)).toBe(false);
  });
});
