import {
  type HexCoord,
  pixelToHex,
  hexToPixel,
  hexAdd,
  hexEqual,
  hexKey,
  HEX_DIRECTIONS,
} from '../shared/hex';
import type { GameState, Ship, SolarSystemMap } from '../shared/types';
import { predictDestination, computeCourse } from '../shared/movement';
import { SHIP_STATS } from '../shared/constants';
import { canAttack, getCombatStrength, hasLineOfSight, hasLineOfSightToTarget } from '../shared/combat';
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
    canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e.clientX, e.clientY));
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

    // Check if clicking a burn or overload direction arrow
    if (this.planningState.selectedShipId) {
      const ship = this.gameState.ships.find(s => s.id === this.planningState.selectedShipId);
      if (ship && ship.fuel > 0 && ship.damage.disabledTurns === 0) {
        const currentBurn = this.planningState.burns.get(ship.id) ?? null;
        const predDest = ship.landed
          ? computeCourse(ship, null, this.map, { destroyedBases: this.gameState.destroyedBases }).path[0] // launch hex
          : predictDestination(ship);

        // Check weak gravity toggle clicks
        const overload = this.planningState.overloads.get(ship.id) ?? null;
        const wgChoices = this.planningState.weakGravityChoices.get(ship.id) ?? {};
        const course = computeCourse(ship, currentBurn, this.map, {
          overload,
          weakGravityChoices: wgChoices,
          destroyedBases: this.gameState.destroyedBases,
        });
        for (const grav of course.enteredGravityEffects) {
          if (grav.strength !== 'weak') continue;
          if (hexEqual(clickHex, grav.hex)) {
            const key = hexKey(grav.hex);
            const newChoices = { ...wgChoices };
            newChoices[key] = !newChoices[key];
            this.planningState.weakGravityChoices.set(ship.id, newChoices);
            return;
          }
        }

        // Check overload arrows first (they overlap with burn arrow space)
        if (currentBurn !== null) {
          const stats = SHIP_STATS[ship.type];
          if (stats?.canOverload && ship.fuel >= 2) {
            const burnDest = hexAdd(predDest, HEX_DIRECTIONS[currentBurn]);
            const currentOverload = this.planningState.overloads.get(ship.id) ?? null;
            for (let d = 0; d < 6; d++) {
              const olTarget = hexAdd(burnDest, HEX_DIRECTIONS[d]);
              if (hexEqual(clickHex, olTarget)) {
                this.planningState.overloads.set(
                  ship.id,
                  currentOverload === d ? null : d,
                );
                return;
              }
            }
          }
        }

        for (let d = 0; d < 6; d++) {
          const burnTarget = hexAdd(predDest, HEX_DIRECTIONS[d]);
          if (hexEqual(clickHex, burnTarget)) {
            // Toggle burn: click same direction = cancel
            this.planningState.burns.set(
              ship.id,
              currentBurn === d ? null : d,
            );
            // Clear overload when burn changes
            if (currentBurn !== d) {
              this.planningState.overloads.delete(ship.id);
            }
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

  private handleOrdnanceClick(clickHex: HexCoord) {
    if (!this.gameState) return;

    const selectedId = this.planningState.selectedShipId;
    if (selectedId) {
      const ship = this.gameState.ships.find(s => s.id === selectedId);
      if (ship) {
        // Check if clicking a torpedo guidance direction
        for (let d = 0; d < 6; d++) {
          const target = hexAdd(ship.position, HEX_DIRECTIONS[d]);
          if (hexEqual(clickHex, target)) {
            if (this.planningState.torpedoAccel !== d) {
              this.planningState.torpedoAccel = d;
              this.planningState.torpedoAccelSteps = 1;
            } else if (this.planningState.torpedoAccelSteps === 1) {
              this.planningState.torpedoAccelSteps = 2;
            } else {
              this.planningState.torpedoAccel = null;
              this.planningState.torpedoAccelSteps = null;
            }
            return;
          }
        }
      }
    }

    // Check if clicking on own ship to select it (skip disabled/landed ships for ordnance)
    for (const ship of this.gameState.ships) {
      if (ship.owner !== this.playerId || ship.destroyed) continue;
      if (ship.damage.disabledTurns > 0 || ship.landed) continue;
      if (hexEqual(clickHex, ship.position)) {
        this.planningState.selectedShipId = ship.id;
        this.planningState.torpedoAccel = null;
        this.planningState.torpedoAccelSteps = null;
        return;
      }
    }
  }

  private handleCombatClick(clickHex: HexCoord) {
    if (!this.gameState) return;

    for (const ship of this.gameState.ships) {
      if (ship.owner !== this.playerId || ship.destroyed || !canAttack(ship)) continue;
      if (hexEqual(clickHex, ship.position)) {
        if (this.toggleCombatAttacker(ship.id)) {
          this.planningState.selectedShipId = ship.id;
          return;
        }
      }
    }

    for (const ord of this.gameState.ordnance) {
      if (ord.owner === this.playerId || ord.destroyed || ord.type !== 'nuke') continue;
      if (hexEqual(clickHex, ord.position)) {
        const isSame = this.planningState.combatTargetId === ord.id
          && this.planningState.combatTargetType === 'ordnance';
        if (isSame) {
          this.clearCombatTarget();
        } else {
          this.setCombatTarget(ord.id, 'ordnance');
        }
        return;
      }
    }

    // Click an enemy ship to target it
    for (const ship of this.gameState.ships) {
      if (ship.owner === this.playerId || ship.destroyed) continue;
      if (hexEqual(clickHex, ship.position)) {
        // Toggle: click same target = deselect
        const isSame = this.planningState.combatTargetId === ship.id
          && this.planningState.combatTargetType === 'ship';
        if (isSame) {
          this.clearCombatTarget();
        } else {
          this.setCombatTarget(ship.id, 'ship');
        }
        return;
      }
    }

    // Clicked empty space — deselect target
    this.clearCombatTarget();
  }

  private setCombatTarget(targetId: string, targetType: 'ship' | 'ordnance') {
    this.planningState.combatTargetId = targetId;
    this.planningState.combatTargetType = targetType;
    const legalAttackers = this.getLegalCombatAttackers(targetId, targetType);
    this.planningState.combatAttackerIds = legalAttackers.map(ship => ship.id);
    this.planningState.combatAttackStrength = targetType === 'ship'
      ? getCombatStrength(legalAttackers)
      : null;
  }

  private clearCombatTarget() {
    this.planningState.combatTargetId = null;
    this.planningState.combatTargetType = null;
    this.planningState.combatAttackerIds = [];
    this.planningState.combatAttackStrength = null;
  }

  private toggleCombatAttacker(shipId: string): boolean {
    const targetId = this.planningState.combatTargetId;
    const targetType = this.planningState.combatTargetType;
    if (!targetId || !targetType) return false;

    const legalAttackers = this.getLegalCombatAttackers(targetId, targetType);
    const legalIds = new Set(legalAttackers.map(ship => ship.id));
    if (!legalIds.has(shipId)) return false;

    const selected = this.planningState.combatAttackerIds.filter(id => legalIds.has(id));
    const nextSelected = selected.includes(shipId)
      ? selected.filter(id => id !== shipId)
      : legalAttackers.filter(ship => selected.includes(ship.id) || ship.id === shipId).map(ship => ship.id);

    if (nextSelected.length === 0) {
      return true;
    }

    this.planningState.combatAttackerIds = nextSelected;
    this.planningState.combatAttackStrength = targetType === 'ship'
      ? Math.min(
        Math.max(this.planningState.combatAttackStrength ?? getCombatStrength(legalAttackers), 1),
        getCombatStrength(legalAttackers.filter(ship => nextSelected.includes(ship.id))),
      )
      : null;
    return true;
  }

  private getLegalCombatAttackers(targetId: string, targetType: 'ship' | 'ordnance'): Ship[] {
    if (!this.gameState || !this.map) return [];

    const myAttackers = this.gameState.ships.filter(ship =>
      ship.owner === this.playerId && !ship.destroyed && canAttack(ship),
    );

    if (targetType === 'ordnance') {
      const target = this.gameState.ordnance.find(ord =>
        ord.id === targetId && !ord.destroyed && ord.owner !== this.playerId && ord.type === 'nuke',
      );
      if (!target) return [];
      return myAttackers.filter(attacker => hasLineOfSightToTarget(attacker, target, this.map!));
    }

    const target = this.gameState.ships.find(ship =>
      ship.id === targetId && !ship.destroyed && ship.owner !== this.playerId,
    );
    if (!target) return [];
    return myAttackers.filter(attacker => hasLineOfSight(attacker, target, this.map!));
  }

  /**
   * Check if a screen click falls within the minimap area.
   * If so, pan the camera to the corresponding world position.
   * Returns true if the click was consumed by the minimap.
   */
  private handleMinimapClick(screenX: number, screenY: number): boolean {
    if (!this.map) return false;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const mmW = 140;
    const mmH = 140;
    const mmX = w - mmW - 10;
    const mmY = h - mmH - 10;
    const mmPad = 8;

    // Check if click is within minimap bounds
    if (screenX < mmX || screenX > mmX + mmW || screenY < mmY || screenY > mmY + mmH) {
      return false;
    }

    // Convert minimap click to world coordinates
    const bounds = this.map.bounds;
    const worldMinX = hexToPixel({ q: bounds.minQ, r: bounds.minR }, HEX_SIZE).x;
    const worldMaxX = hexToPixel({ q: bounds.maxQ, r: bounds.maxR }, HEX_SIZE).x;
    const worldMinY = hexToPixel({ q: bounds.minQ, r: bounds.minR }, HEX_SIZE).y;
    const worldMaxY = hexToPixel({ q: bounds.maxQ, r: bounds.maxR }, HEX_SIZE).y;
    const worldW = worldMaxX - worldMinX || 1;
    const worldH = worldMaxY - worldMinY || 1;

    const innerW = mmW - mmPad * 2;
    const innerH = mmH - mmPad * 2;
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = mmX + mmPad + (innerW - worldW * scale) / 2;
    const offsetY = mmY + mmPad + (innerH - worldH * scale) / 2;

    const worldClickX = (screenX - offsetX) / scale + worldMinX;
    const worldClickY = (screenY - offsetY) / scale + worldMinY;

    this.camera.targetX = worldClickX;
    this.camera.targetY = worldClickY;

    return true;
  }

  private handleDoubleClick(screenX: number, screenY: number) {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    this.camera.targetX = worldPos.x;
    this.camera.targetY = worldPos.y;
  }
}
