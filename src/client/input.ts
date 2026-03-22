import { pixelToHex } from '../shared/hex';
import type { SolarSystemMap } from '../shared/types/domain';
import type { InputEvent } from './game/input-events';
import {
  createPointerInteractionManager,
  getPinchDistance,
  getWheelZoomFactor,
  resolveMinimapCameraTarget,
} from './input-interaction';
import type { Camera } from './renderer/camera';
import { HEX_SIZE } from './renderer/renderer';

export class InputHandler {
  private camera: Camera;
  private map: SolarSystemMap | null = null;
  private onInput: (event: InputEvent) => void;
  private readonly interactions = createPointerInteractionManager(HEX_SIZE);

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    onInput: (event: InputEvent) => void,
  ) {
    this.camera = camera;
    this.onInput = onInput;

    // Mouse events
    canvas.addEventListener('mousedown', (e) =>
      this.onPointerDown(e.clientX, e.clientY),
    );
    canvas.addEventListener('mousemove', (e) =>
      this.onPointerMove(e.clientX, e.clientY),
    );
    canvas.addEventListener('mouseup', (e) =>
      this.onPointerUp(e.clientX, e.clientY),
    );
    canvas.addEventListener('dblclick', (e) =>
      this.handleDoubleClick(e.clientX, e.clientY),
    );

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = getWheelZoomFactor(e.deltaY, e.ctrlKey);
        this.camera.zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false },
    );

    // Touch events
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), {
      passive: false,
    });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), {
      passive: false,
    });
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
  }

  setMap(map: SolarSystemMap) {
    this.map = map;
  }

  // --- Pointer handling ---

  private onPointerDown(x: number, y: number, touch = false) {
    this.interactions.beginPointer(x, y, touch);
  }

  private onPointerMove(x: number, y: number) {
    const hex = this.interactions.handlePointerMove(this.camera, x, y);
    if (hex) {
      this.onInput({ type: 'hoverHex', hex });
    }
  }

  private onPointerUp(x: number, y: number) {
    const clickPoint = this.interactions.endPointer(x, y);
    if (clickPoint) {
      this.handleClick(clickPoint.x, clickPoint.y);
    }
  }

  // --- Touch handling ---

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();

    if (e.touches.length === 1) {
      this.onPointerDown(e.touches[0].clientX, e.touches[0].clientY, true);
    } else if (e.touches.length === 2) {
      this.interactions.beginPinch(
        getPinchDistance(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        ),
      );
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();

    if (e.touches.length === 1) {
      this.onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const factor = this.interactions.updatePinch(
        getPinchDistance(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        ),
      );

      if (factor !== null) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.camera.zoomAt(cx, cy, factor);
      }
    }
  }

  private onTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) {
      const clickPoint = this.interactions.endPointer();
      if (clickPoint) {
        this.handleClick(clickPoint.x, clickPoint.y);
      }
      this.interactions.clearPinch();
    }
  }

  // --- Click logic ---

  private handleClick(screenX: number, screenY: number) {
    if (this.handleMinimapClick(screenX, screenY)) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const hex = pixelToHex(worldPos, HEX_SIZE);

    this.onInput({ type: 'clickHex', hex });
  }

  /**
   * Check if a screen click falls within the minimap.
   * If so, pan the camera to the corresponding world
   * position. Returns true if the click was consumed.
   */
  private handleMinimapClick(screenX: number, screenY: number): boolean {
    const hudTopOffset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--hud-top-offset',
      ) || '0',
    );

    const target = resolveMinimapCameraTarget({
      map: this.map,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      screenX,
      screenY,
      hexSize: HEX_SIZE,
      hudTopOffset,
    });

    if (!target) {
      return false;
    }

    this.camera.targetX = target.x;
    this.camera.targetY = target.y;

    return true;
  }

  private handleDoubleClick(screenX: number, screenY: number) {
    const worldPos = this.camera.screenToWorld(screenX, screenY);

    this.camera.targetX = worldPos.x;
    this.camera.targetY = worldPos.y;
  }
}
