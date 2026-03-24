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

export const createInputHandler = (
  canvas: HTMLCanvasElement,
  camera: Camera,
  onInput: (event: InputEvent) => void,
) => {
  const scope = createDisposalScope();
  const interactions = createPointerInteractionManager(HEX_SIZE);

  let map: SolarSystemMap | null = null;

  const onPointerDown = (x: number, y: number, touch = false) => {
    interactions.beginPointer(x, y, touch);
  };

  const onPointerMove = (x: number, y: number) => {
    const hex = interactions.handlePointerMove(camera, x, y);

    if (hex) {
      onInput({ type: 'hoverHex', hex });
    }
  };

  const handleMinimapClick = (screenX: number, screenY: number): boolean => {
    const hudTopOffset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--hud-top-offset',
      ) || '0',
    );

    const target = resolveMinimapCameraTarget({
      map,
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

    camera.targetX = target.x;
    camera.targetY = target.y;

    return true;
  };

  const handleClick = (screenX: number, screenY: number) => {
    if (handleMinimapClick(screenX, screenY)) return;

    const worldPos = camera.screenToWorld(screenX, screenY);
    const hex = pixelToHex(worldPos, HEX_SIZE);

    onInput({ type: 'clickHex', hex });
  };

  const onPointerUp = (x: number, y: number) => {
    const clickPoint = interactions.endPointer(x, y);

    if (clickPoint) {
      handleClick(clickPoint.x, clickPoint.y);
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();

    if (e.touches.length === 1) {
      onPointerDown(e.touches[0].clientX, e.touches[0].clientY, true);
    } else if (e.touches.length === 2) {
      interactions.beginPinch(
        getPinchDistance(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        ),
      );
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();

    if (e.touches.length === 1) {
      onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const factor = interactions.updatePinch(
        getPinchDistance(
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        ),
      );

      if (factor !== null) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        camera.zoomAt(cx, cy, factor);
      }
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      const clickPoint = interactions.endPointer();

      if (clickPoint) {
        handleClick(clickPoint.x, clickPoint.y);
      }
      interactions.clearPinch();
    }
  };

  const onTouchCancel = () => {
    interactions.endPointer();
    interactions.clearPinch();
  };

  const handleDoubleClick = (screenX: number, screenY: number) => {
    const worldPos = camera.screenToWorld(screenX, screenY);

    camera.targetX = worldPos.x;
    camera.targetY = worldPos.y;
  };

  withScope(scope, () => {
    listen(canvas, 'mousedown', (event) => {
      const e = event as MouseEvent;
      onPointerDown(e.clientX, e.clientY);
    });

    listen(canvas, 'mousemove', (event) => {
      const e = event as MouseEvent;
      onPointerMove(e.clientX, e.clientY);
    });

    listen(window, 'mouseup', (event) => {
      const e = event as MouseEvent;
      onPointerUp(e.clientX, e.clientY);
    });

    listen(canvas, 'dblclick', (event) => {
      const e = event as MouseEvent;
      handleDoubleClick(e.clientX, e.clientY);
    });

    listen(
      canvas,
      'wheel',
      (event) => {
        const e = event as WheelEvent;
        e.preventDefault();
        const factor = getWheelZoomFactor(e.deltaY, e.ctrlKey);
        camera.zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false },
    );

    listen(
      canvas,
      'touchstart',
      (event) => {
        onTouchStart(event as TouchEvent);
      },
      { passive: false },
    );

    listen(
      canvas,
      'touchmove',
      (event) => {
        onTouchMove(event as TouchEvent);
      },
      { passive: false },
    );

    listen(canvas, 'touchend', (event) => {
      onTouchEnd(event as TouchEvent);
    });

    listen(canvas, 'touchcancel', onTouchCancel);
  });

  return {
    setMap: (nextMap: SolarSystemMap) => {
      map = nextMap;
    },
    dispose: () => {
      scope.dispose();
    },
  };
};

export type InputHandler = ReturnType<typeof createInputHandler>;
