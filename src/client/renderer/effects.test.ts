import { describe, expect, it, vi } from 'vitest';
import type { CombatEffect } from './effects';
import { drawCombatEffects } from './effects';

const createCtx = (): CanvasRenderingContext2D => {
  return {
    canvas: { width: 800, height: 600 },
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
};

describe('drawCombatEffects', () => {
  it('draws nuke screen flashes across the canvas', () => {
    const ctx = createCtx();
    const effect: CombatEffect = {
      type: 'screenFlash',
      style: 'nuke',
      from: { x: 10, y: 20 },
      to: { x: 10, y: 20 },
      startTime: 100,
      duration: 500,
      color: '#fff2bf',
    };

    const live = drawCombatEffects(ctx, [effect], 200);

    expect(live).toEqual([effect]);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.fillStyle).toBe('#fff2bf');
  });
});
