import { CAMERA_LERP_SPEED } from '../../shared/constants';
import type { PixelCoord } from '../../shared/hex';
import { clamp } from '../../shared/util';

export class Camera {
  x = 0;
  y = 0;
  zoom = 1.0;
  targetX = 0;
  targetY = 0;
  targetZoom = 1.0;

  private canvasW = 0;
  private canvasH = 0;

  // Screen shake state
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;

  readonly minZoom = 0.15;
  readonly maxZoom = 4.0;

  update(dt: number, canvasW: number, canvasH: number) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;

    const speed = Math.min(CAMERA_LERP_SPEED * dt, 1);

    this.x += (this.targetX - this.x) * speed;
    this.y += (this.targetY - this.y) * speed;
    this.zoom += (this.targetZoom - this.zoom) * speed;

    // Decay screen shake
    if (this.shakeIntensity > 0.5) {
      this.shakeIntensity *= 1 - this.shakeDecay * dt;
      const angle = Math.random() * Math.PI * 2;
      this.shakeOffsetX = Math.cos(angle) * this.shakeIntensity;
      this.shakeOffsetY = Math.sin(angle) * this.shakeIntensity;
    } else {
      this.shakeIntensity = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  applyTransform(ctx: CanvasRenderingContext2D) {
    ctx.translate(
      this.canvasW / 2 + this.shakeOffsetX,
      this.canvasH / 2 + this.shakeOffsetY,
    );
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  // Trigger screen shake with given pixel intensity
  // and decay rate (0-1 per second, higher = faster
  // decay).
  shake(intensity: number, decay = 4) {
    this.shakeIntensity = intensity;
    this.shakeDecay = decay;
  }

  screenToWorld(sx: number, sy: number): PixelCoord {
    return {
      x: (sx - this.canvasW / 2) / this.zoom + this.x,
      y: (sy - this.canvasH / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx: number, wy: number): PixelCoord {
    return {
      x: (wx - this.x) * this.zoom + this.canvasW / 2,
      y: (wy - this.y) * this.zoom + this.canvasH / 2,
    };
  }

  frameBounds(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    padding = 80,
  ) {
    this.targetX = (minX + maxX) / 2;
    this.targetY = (minY + maxY) / 2;

    const w = maxX - minX + padding * 2;
    const h = maxY - minY + padding * 2;
    const zx = this.canvasW / w;
    const zy = this.canvasH / h;

    this.targetZoom = Math.min(zx, zy, this.maxZoom);
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const newZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);

    const worldX = (sx - this.canvasW / 2) / this.targetZoom + this.targetX;
    const worldY = (sy - this.canvasH / 2) / this.targetZoom + this.targetY;

    this.targetZoom = newZoom;
    this.targetX = worldX - (sx - this.canvasW / 2) / newZoom;
    this.targetY = worldY - (sy - this.canvasH / 2) / newZoom;
  }

  pan(dx: number, dy: number) {
    this.targetX -= dx / this.zoom;
    this.targetY -= dy / this.zoom;
  }

  snapToTarget() {
    this.x = this.targetX;
    this.y = this.targetY;
    this.zoom = this.targetZoom;
  }

  isVisible(wx: number, wy: number, margin = 50): boolean {
    const halfW = this.canvasW / 2 / this.zoom + margin;
    const halfH = this.canvasH / 2 / this.zoom + margin;

    return Math.abs(wx - this.x) < halfW && Math.abs(wy - this.y) < halfH;
  }
}
