import { type HexCoord, pixelToHex } from '../shared/hex';
import type { GameState, SolarSystemMap } from '../shared/types';
import {
  createClearedCombatPlan,
  createCombatTargetPlan,
  getCombatAttackerIdAtHex,
  getCombatTargetAtHex,
  toggleCombatAttackerSelection,
} from './game/combat';
import { resolveAstrogationClick, resolveOrdnanceClick } from './game/input';
import { createMinimapLayout, isPointInMinimap, projectMinimapToWorld } from './game/minimap';
import type { PlanningState } from './game/planning';
import type { Camera } from './renderer/camera';
import { HEX_SIZE } from './renderer/renderer';

export class InputHandler {
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
  private isTouch = false;

  // Pinch zoom
  private lastPinchDist = 0;

  // Callbacks
  onConfirm: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, planningState: PlanningState) {
    this.camera = camera;
    this.planningState = planningState;

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

    // Always track hover hex if we have game state
    if (this.gameState && this.map) {
      const worldPos = this.camera.screenToWorld(x, y);
      this.planningState.hoverHex = pixelToHex(worldPos, HEX_SIZE);
    } else {
      this.planningState.hoverHex = null;
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
    // Check minimap click first
    if (this.handleMinimapClick(screenX, screenY)) return;

    if (!this.gameState || !this.map) return;
    if (this.gameState.activePlayer !== this.playerId) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const clickHex = pixelToHex(worldPos, HEX_SIZE);

    if (this.gameState.phase === 'combat') {
      this.handleCombatClick(clickHex);
      return;
    }

    if (this.gameState.phase === 'ordnance') {
      this.handleOrdnanceClick(clickHex);
      return;
    }

    if (this.gameState.phase !== 'astrogation') return;
    const interaction = resolveAstrogationClick(this.gameState, this.map, this.playerId, this.planningState, clickHex);
    switch (interaction.type) {
      case 'weakGravityToggle':
        this.planningState.weakGravityChoices.set(interaction.shipId, interaction.choices);
        return;
      case 'overloadToggle':
        this.planningState.overloads.set(interaction.shipId, interaction.direction);
        return;
      case 'burnToggle':
        this.planningState.burns.set(interaction.shipId, interaction.direction);
        if (interaction.clearOverload) {
          this.planningState.overloads.delete(interaction.shipId);
        }
        return;
      case 'selectShip':
        this.planningState.selectedShipId = interaction.shipId;
        return;
      case 'clearSelection':
        this.planningState.selectedShipId = null;
        return;
    }
  }

  private handleOrdnanceClick(clickHex: HexCoord) {
    if (!this.gameState) return;
    const interaction = resolveOrdnanceClick(this.gameState, this.playerId, this.planningState, clickHex);
    switch (interaction.type) {
      case 'torpedoAccel':
        this.planningState.torpedoAccel = interaction.torpedoAccel;
        this.planningState.torpedoAccelSteps = interaction.torpedoAccelSteps;
        return;
      case 'selectShip':
        this.planningState.selectedShipId = interaction.shipId;
        this.planningState.torpedoAccel = null;
        this.planningState.torpedoAccelSteps = null;
        return;
      case 'none':
        return;
    }
  }

  private handleCombatClick(clickHex: HexCoord) {
    if (!this.gameState) return;

    const attackerId = getCombatAttackerIdAtHex(this.gameState, this.playerId, clickHex);
    if (attackerId) {
      const toggle = toggleCombatAttackerSelection(
        this.gameState,
        this.playerId,
        this.planningState,
        this.map,
        attackerId,
      );
      if (toggle?.consumed) {
        this.planningState.combatAttackerIds = toggle.combatAttackerIds;
        this.planningState.combatAttackStrength = toggle.combatAttackStrength;
        this.planningState.selectedShipId = attackerId;
        return;
      }
    }

    const target = getCombatTargetAtHex(this.gameState, this.playerId, clickHex, this.planningState.queuedAttacks);
    if (target) {
      const isSame =
        this.planningState.combatTargetId === target.targetId &&
        this.planningState.combatTargetType === target.targetType;
      if (isSame) {
        Object.assign(this.planningState, createClearedCombatPlan());
      } else {
        Object.assign(
          this.planningState,
          createCombatTargetPlan(
            this.gameState,
            this.playerId,
            this.planningState,
            target.targetId,
            target.targetType,
            this.map,
          ),
        );
      }
      return;
    }

    // Clicked empty space — deselect target
    Object.assign(this.planningState, createClearedCombatPlan());
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
