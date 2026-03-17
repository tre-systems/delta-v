import { type HexCoord, hexEqual, pixelToHex } from '../shared/hex';
import type { SolarSystemMap } from '../shared/types';
import type { InputEvent } from './game/input-events';
import { createMinimapLayout, isPointInMinimap, projectMinimapToWorld } from './game/minimap';
import type { Camera } from './renderer/camera';
import { HEX_SIZE } from './renderer/renderer';

export class InputHandler {
  private camera: Camera;
  private map: SolarSystemMap | null = null;
  private onInput: (event: InputEvent) => void;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private isTouch = false;

  // Pinch zoom
  private lastPinchDist = 0;

  // Hover dedup
  private lastHoverHex: HexCoord | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, onInput: (event: InputEvent) => void) {
    this.camera = camera;
    this.onInput = onInput;

    // Mouse events
    canvas.addEventListener('mousedown', (e) => this.onPointerDown(e.clientX, e.clientY));
    canvas.addEventListener('mousemove', (e) => this.onPointerMove(e.clientX, e.clientY));
    canvas.addEventListener('mouseup', (e) => this.onPointerUp(e.clientX, e.clientY));
    canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e.clientX, e.clientY));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          // Trackpad pinch-to-zoom (macOS/browsers send ctrl+wheel for pinch gestures)
          const factor = 1 - e.deltaY * 0.01;
          this.camera.zoomAt(e.clientX, e.clientY, factor);
        } else {
          // Standard scroll wheel — zoom
          const factor = 1 - e.deltaY * 0.001;
          this.camera.zoomAt(e.clientX, e.clientY, factor);
        }
      },
      { passive: false },
    );

    // Touch events
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
  }

  setMap(map: SolarSystemMap) {
    this.map = map;
  }

  // --- Pointer handling ---

  private onPointerDown(x: number, y: number, touch = false) {
    this.isDragging = true;
    this.isTouch = touch;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragMoved = false;
  }

  private onPointerMove(x: number, y: number) {
    if (this.isDragging) {
      const dx = x - this.dragStartX;
      const dy = y - this.dragStartY;
      const threshold = this.isTouch ? 8 : 3;

      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        this.dragMoved = true;
      }

      if (this.dragMoved) {
        this.camera.pan(dx, dy);
        this.dragStartX = x;
        this.dragStartY = y;
      }
    }

    // Track hover hex
    const worldPos = this.camera.screenToWorld(x, y);
    const hex = pixelToHex(worldPos, HEX_SIZE);
    if (!this.lastHoverHex || !hexEqual(hex, this.lastHoverHex)) {
      this.lastHoverHex = hex;
      this.onInput({ type: 'hoverHex', hex });
    }
  }

  private onPointerUp(x: number, y: number) {
    this.isDragging = false;
    if (!this.dragMoved) {
      this.handleClick(x, y);
    }
  }

  // --- Touch handling ---

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.onPointerDown(e.touches[0].clientX, e.touches[0].clientY, true);
    } else if (e.touches.length === 2) {
      this.isDragging = false;
      this.lastPinchDist = this.getPinchDist(e);
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const dist = this.getPinchDist(e);
      if (this.lastPinchDist > 0) {
        const factor = dist / this.lastPinchDist;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.camera.zoomAt(cx, cy, factor);
      }
      this.lastPinchDist = dist;
    }
  }

  private onTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) {
      this.onPointerUp(this.dragStartX, this.dragStartY);
      this.lastPinchDist = 0;
    }
  }

  private getPinchDist(e: TouchEvent): number {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- Click logic ---

  private handleClick(screenX: number, screenY: number) {
    if (this.handleMinimapClick(screenX, screenY)) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const hex = pixelToHex(worldPos, HEX_SIZE);
    this.onInput({ type: 'clickHex', hex });
  }

  /**
   * Check if a screen click falls within the minimap area.
   * If so, pan the camera to the corresponding world position.
   * Returns true if the click was consumed by the minimap.
   */
  private handleMinimapClick(screenX: number, screenY: number): boolean {
    if (!this.map) return false;

    const layout = createMinimapLayout(this.map.bounds, window.innerWidth, window.innerHeight, HEX_SIZE);
    if (!isPointInMinimap(layout, { x: screenX, y: screenY })) {
      return false;
    }

    const worldClick = projectMinimapToWorld(layout, { x: screenX, y: screenY });
    this.camera.targetX = worldClick.x;
    this.camera.targetY = worldClick.y;
    return true;
  }

  private handleDoubleClick(screenX: number, screenY: number) {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    this.camera.targetX = worldPos.x;
    this.camera.targetY = worldPos.y;
  }
}
