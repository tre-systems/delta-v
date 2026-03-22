// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputHandler } from './input';
import type { Camera } from './renderer/camera';

const createCamera = (): Camera => {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
    minZoom: 0.15,
    maxZoom: 4,
    update: vi.fn(),
    applyTransform: vi.fn(),
    screenToWorld: vi.fn((sx: number, sy: number) => ({ x: sx, y: sy })),
    worldToScreen: vi.fn(),
    frameBounds: vi.fn(),
    zoomAt: vi.fn(),
    pan: vi.fn(),
    snapToTarget: vi.fn(),
    isVisible: vi.fn(),
  } as unknown as Camera;
};

describe('InputHandler', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="gameCanvas"></canvas>';
    canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  });

  it('emits hover and click input, including mouseup outside the canvas', () => {
    const camera = createCamera();
    const onInput = vi.fn();

    new InputHandler(canvas, camera, onInput);

    canvas.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );

    expect(onInput).toHaveBeenNthCalledWith(1, {
      type: 'hoverHex',
      hex: { q: 0, r: 0 },
    });
    expect(onInput).toHaveBeenNthCalledWith(2, {
      type: 'clickHex',
      hex: { q: 0, r: 0 },
    });
  });

  it('ignores global mouseup events when no pointer is active', () => {
    const camera = createCamera();
    const onInput = vi.fn();

    new InputHandler(canvas, camera, onInput);

    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );

    expect(onInput).not.toHaveBeenCalled();
  });

  it('disposes listeners and stops forwarding input or zoom updates', () => {
    const camera = createCamera();
    const onInput = vi.fn();
    const handler = new InputHandler(canvas, camera, onInput);

    handler.dispose();

    canvas.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 16,
        clientY: 24,
        deltaY: 120,
      }),
    );

    expect(onInput).not.toHaveBeenCalled();
    expect(camera.zoomAt).not.toHaveBeenCalled();
  });
});
