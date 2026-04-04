import { describe, expect, it } from 'vitest';

import { hexToPixel } from '../../shared/hex';
import {
  clipViewportToMinimap,
  createMinimapLayout,
  getMinimapFrame,
  isPointInMinimap,
  projectMinimapToWorld,
  projectWorldToMinimap,
} from './minimap';

const bounds = {
  minQ: -2,
  maxQ: 4,
  minR: -1,
  maxR: 3,
};

describe('game client minimap helpers', () => {
  it('derives desktop and mobile minimap frames from screen size', () => {
    expect(getMinimapFrame(1024, 768)).toEqual({
      x: 12,
      y: 636,
      width: 120,
      height: 120,
      padding: 6,
    });

    expect(getMinimapFrame(480, 900, 130, 1, 166)).toEqual({
      x: 12,
      y: 622,
      width: 90,
      height: 90,
      padding: 6,
    });
  });

  it('projects world coordinates into minimap space and back again', () => {
    const layout = createMinimapLayout(bounds, 1024, 768, 28);
    const worldPoint = hexToPixel({ q: 1, r: 2 }, 28);
    const minimapPoint = projectWorldToMinimap(layout, worldPoint);
    const restoredPoint = projectMinimapToWorld(layout, minimapPoint);

    expect(isPointInMinimap(layout, minimapPoint)).toBe(true);
    expect(restoredPoint.x).toBeCloseTo(worldPoint.x, 6);
    expect(restoredPoint.y).toBeCloseTo(worldPoint.y, 6);
  });

  it('clips viewport rectangles to the minimap border', () => {
    const layout = createMinimapLayout(bounds, 1024, 768, 28);

    expect(
      clipViewportToMinimap(layout, {
        x: layout.x - 10,
        y: layout.y - 20,
        width: 60,
        height: 80,
      }),
    ).toEqual({
      x: layout.x + 1,
      y: layout.y + 1,
      width: 49,
      height: 59,
    });
  });
});
