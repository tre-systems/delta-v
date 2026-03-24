import { CAMERA_LERP_SPEED } from '../../shared/constants';
import type { PixelCoord } from '../../shared/hex';
import { clamp } from '../../shared/util';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4.0;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  update(dt: number, canvasW: number, canvasH: number): void;
  applyTransform(ctx: CanvasRenderingContext2D): void;
  shake(intensity: number, decay?: number): void;
  screenToWorld(sx: number, sy: number): PixelCoord;
  worldToScreen(wx: number, wy: number): PixelCoord;
  frameBounds(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    padding?: number,
  ): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  pan(dx: number, dy: number): void;
  snapToTarget(): void;
  isVisible(wx: number, wy: number, margin?: number): boolean;
}

type CameraPrivate = {
  canvasW: number;
  canvasH: number;
  shakeIntensity: number;
  shakeDecay: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
};

const lerpTowardTargets = (
  c: Pick<Camera, 'x' | 'y' | 'zoom' | 'targetX' | 'targetY' | 'targetZoom'>,
  dt: number,
): void => {
  const speed = Math.min(CAMERA_LERP_SPEED * dt, 1);
  c.x += (c.targetX - c.x) * speed;
  c.y += (c.targetY - c.y) * speed;
  c.zoom += (c.targetZoom - c.zoom) * speed;
};

const stepShake = (p: CameraPrivate, dt: number): void => {
  if (p.shakeIntensity > 0.5) {
    p.shakeIntensity *= 1 - p.shakeDecay * dt;
    const angle = Math.random() * Math.PI * 2;
    p.shakeOffsetX = Math.cos(angle) * p.shakeIntensity;
    p.shakeOffsetY = Math.sin(angle) * p.shakeIntensity;
    return;
  }
  p.shakeIntensity = 0;
  p.shakeOffsetX = 0;
  p.shakeOffsetY = 0;
};

const applyCameraTransform = (
  ctx: CanvasRenderingContext2D,
  p: CameraPrivate,
  c: Pick<Camera, 'x' | 'y' | 'zoom'>,
): void => {
  ctx.translate(p.canvasW / 2 + p.shakeOffsetX, p.canvasH / 2 + p.shakeOffsetY);
  ctx.scale(c.zoom, c.zoom);
  ctx.translate(-c.x, -c.y);
};

export const createCamera = (): Camera => {
  const p: CameraPrivate = {
    canvasW: 0,
    canvasH: 0,
    shakeIntensity: 0,
    shakeDecay: 0,
    shakeOffsetX: 0,
    shakeOffsetY: 0,
  };

  const c: Camera = {
    x: 0,
    y: 0,
    zoom: 1.0,
    targetX: 0,
    targetY: 0,
    targetZoom: 1.0,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,

    update: (dt: number, canvasW: number, canvasH: number): void => {
      p.canvasW = canvasW;
      p.canvasH = canvasH;
      lerpTowardTargets(c, dt);
      stepShake(p, dt);
    },

    applyTransform: (ctx: CanvasRenderingContext2D): void => {
      applyCameraTransform(ctx, p, c);
    },

    shake: (intensity: number, decay = 4): void => {
      p.shakeIntensity = intensity;
      p.shakeDecay = decay;
    },

    screenToWorld: (sx: number, sy: number): PixelCoord => ({
      x: (sx - p.canvasW / 2) / c.zoom + c.x,
      y: (sy - p.canvasH / 2) / c.zoom + c.y,
    }),

    worldToScreen: (wx: number, wy: number): PixelCoord => ({
      x: (wx - c.x) * c.zoom + p.canvasW / 2,
      y: (wy - c.y) * c.zoom + p.canvasH / 2,
    }),

    frameBounds: (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      padding = 80,
    ): void => {
      c.targetX = (minX + maxX) / 2;
      c.targetY = (minY + maxY) / 2;
      const w = maxX - minX + padding * 2;
      const h = maxY - minY + padding * 2;
      const zx = p.canvasW / w;
      const zy = p.canvasH / h;
      c.targetZoom = Math.min(zx, zy, c.maxZoom);
    },

    zoomAt: (sx: number, sy: number, factor: number): void => {
      const newZoom = clamp(c.targetZoom * factor, c.minZoom, c.maxZoom);
      const worldX = (sx - p.canvasW / 2) / c.targetZoom + c.targetX;
      const worldY = (sy - p.canvasH / 2) / c.targetZoom + c.targetY;
      c.targetZoom = newZoom;
      c.targetX = worldX - (sx - p.canvasW / 2) / newZoom;
      c.targetY = worldY - (sy - p.canvasH / 2) / newZoom;
    },

    pan: (dx: number, dy: number): void => {
      c.targetX -= dx / c.zoom;
      c.targetY -= dy / c.zoom;
    },

    snapToTarget: (): void => {
      c.x = c.targetX;
      c.y = c.targetY;
      c.zoom = c.targetZoom;
    },

    isVisible: (wx: number, wy: number, margin = 50): boolean => {
      const halfW = p.canvasW / 2 / c.zoom + margin;
      const halfH = p.canvasH / 2 / c.zoom + margin;
      return Math.abs(wx - c.x) < halfW && Math.abs(wy - c.y) < halfH;
    },
  };

  return c;
};
