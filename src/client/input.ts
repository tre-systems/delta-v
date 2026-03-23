import { pixelToHex } from '../shared/hex';
import type { SolarSystemMap } from '../shared/types/domain';
import { listen } from './dom';
import type { InputEvent } from './game/input-events';
import {
  createPointerInteractionManager,
  getPinchDistance,
  getWheelZoomFactor,
  resolveMinimapCameraTarget,
} from './input-interaction';
import { createDisposalScope, withScope } from './reactive';
import type { Camera } from './renderer/camera';
import { HEX_SIZE } from './renderer/renderer';

export class InputHandler {
  private readonly scope = createDisposalScope();
  private readonly camera: Camera;
  private map: SolarSystemMap | null = null;
  private readonly onInput: (event: InputEvent) => void;
  private readonly interactions = createPointerInteractionManager(HEX_SIZE);

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    onInput: (event: InputEvent) => void,
  ) {
    this.camera = camera;
    this.onInput = onInput;

    withScope(this.scope, () => {
      // Mouse events
      listen(canvas, 'mousedown', (event) => {
        const e = event as MouseEvent;
        this.onPointerDown(e.clientX, e.clientY);
      });

      listen(canvas, 'mousemove', (event) => {
        const e = event as MouseEvent;
        this.onPointerMove(e.clientX, e.clientY);
      });

      listen(window, 'mouseup', (event) => {
        const e = event as MouseEvent;
        this.onPointerUp(e.clientX, e.clientY);
      });

      listen(canvas, 'dblclick', (event) => {
        const e = event as MouseEvent;
        this.handleDoubleClick(e.clientX, e.clientY);
      });

      listen(
        canvas,
        'wheel',
        (event) => {
          const e = event as WheelEvent;
          e.preventDefault();
          const factor = getWheelZoomFactor(e.deltaY, e.ctrlKey);
          this.camera.zoomAt(e.clientX, e.clientY, factor);
        },
        { passive: false },
      );

      // Touch events
      listen(
        canvas,
        'touchstart',
        (event) => {
          const e = event as TouchEvent;
          this.onTouchStart(e);
        },
        { passive: false },
      );

      listen(
        canvas,
        'touchmove',
        (event) => {
          const e = event as TouchEvent;
          this.onTouchMove(e);
        },
        { passive: false },
      );

      listen(canvas, 'touchend', (event) => {
        const e = event as TouchEvent;
        this.onTouchEnd(e);
      });

      listen(canvas, 'touchcancel', () => {
        this.onTouchCancel();
      });
    });
  }

  setMap(map: SolarSystemMap) {
    this.map = map;
  }

  dispose(): void {
    this.scope.dispose();
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

  private onTouchCancel() {
    this.interactions.endPointer();
    this.interactions.clearPinch();
  }

  // --- Click logic ---

  private handleClick(screenX: number, screenY: number) {
    if (this.handleMinimapClick(screenX, screenY)) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const hex = pixelToHex(worldPos, HEX_SIZE);

    this.onInput({ type: 'clickHex', hex });
  }

  // Check if a screen click falls within the minimap.
  // If so, pan the camera to the corresponding world
  // position. Returns true if the click was consumed.
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
