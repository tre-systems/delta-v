import {
  type HexCoord,
  pixelToHex,
  hexToPixel,
  hexAdd,
  hexEqual,
  HEX_DIRECTIONS,
} from '../shared/hex';
import type { GameState, Ship, SolarSystemMap } from '../shared/types';
import { predictDestination, computeCourse } from '../shared/movement';
import { type Camera, type PlanningState, HEX_SIZE } from './renderer';

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private planningState: PlanningState;
  private gameState: GameState | null = null;
  private map: SolarSystemMap | null = null;
  private playerId = -1;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;

  // Pinch zoom
  private lastPinchDist = 0;

  // Callbacks
  onConfirm: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, planningState: PlanningState) {
    this.canvas = canvas;
    this.camera = camera;
    this.planningState = planningState;

    // Mouse events
    canvas.addEventListener('mousedown', (e) => this.onPointerDown(e.clientX, e.clientY));
    canvas.addEventListener('mousemove', (e) => this.onPointerMove(e.clientX, e.clientY));
    canvas.addEventListener('mouseup', (e) => this.onPointerUp(e.clientX, e.clientY));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = 1 - e.deltaY * 0.001;
      this.camera.zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    // Touch events
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
  }

  setGameState(state: GameState) {
    this.gameState = state;
  }

  setMap(map: SolarSystemMap) {
    this.map = map;
  }

  setPlayerId(id: number) {
    this.playerId = id;
  }

  // --- Pointer handling ---

  private onPointerDown(x: number, y: number) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragMoved = false;
  }

  private onPointerMove(x: number, y: number) {
    if (!this.isDragging) return;
    const dx = x - this.dragStartX;
    const dy = y - this.dragStartY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.dragMoved = true;
    }

    if (this.dragMoved) {
      this.camera.pan(dx, dy);
      this.dragStartX = x;
      this.dragStartY = y;
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
      this.onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
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
    if (!this.gameState || !this.map) return;
    if (this.gameState.activePlayer !== this.playerId) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const clickHex = pixelToHex(worldPos, HEX_SIZE);

    if (this.gameState.phase === 'combat') {
      this.handleCombatClick(clickHex);
      return;
    }

    if (this.gameState.phase !== 'astrogation') return;

    // Check if clicking a burn direction arrow
    if (this.planningState.selectedShipId) {
      const ship = this.gameState.ships.find(s => s.id === this.planningState.selectedShipId);
      if (ship && ship.fuel > 0) {
        const currentBurn = this.planningState.burns.get(ship.id) ?? null;
        const predDest = ship.landed
          ? computeCourse(ship, null, this.map).path[0] // launch hex
          : predictDestination(ship);

        for (let d = 0; d < 6; d++) {
          const burnTarget = hexAdd(predDest, HEX_DIRECTIONS[d]);
          if (hexEqual(clickHex, burnTarget)) {
            // Toggle burn: click same direction = cancel
            this.planningState.burns.set(
              ship.id,
              currentBurn === d ? null : d,
            );
            return;
          }
        }
      }
    }

    // Check if clicking on own ship to select it
    for (const ship of this.gameState.ships) {
      if (ship.owner !== this.playerId) continue;
      if (hexEqual(clickHex, ship.position)) {
        this.planningState.selectedShipId = ship.id;
        return;
      }
    }

    // Clicked empty space — deselect
    this.planningState.selectedShipId = null;
  }

  private handleCombatClick(clickHex: HexCoord) {
    if (!this.gameState) return;

    // Click an enemy ship to target it
    for (const ship of this.gameState.ships) {
      if (ship.owner === this.playerId || ship.destroyed) continue;
      if (hexEqual(clickHex, ship.position)) {
        // Toggle: click same target = deselect
        this.planningState.combatTargetId =
          this.planningState.combatTargetId === ship.id ? null : ship.id;
        return;
      }
    }

    // Clicked empty space — deselect target
    this.planningState.combatTargetId = null;
  }
}
