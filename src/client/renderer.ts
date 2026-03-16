import {
  type HexCoord,
  type PixelCoord,
  type HexVec,
  hexToPixel,
  hexAdd,
  hexKey,
  hexEqual,
  HEX_DIRECTIONS,
  hexVecLength,
} from '../shared/hex';
import type { GameState, Ship, ShipMovement, OrdnanceMovement, MovementEvent, SolarSystemMap, CelestialBody, CombatResult, CombatAttack, PlayerState } from '../shared/types';
import { MOVEMENT_ANIM_DURATION, CAMERA_LERP_SPEED, SHIP_STATS, SHIP_DETECTION_RANGE, BASE_DETECTION_RANGE } from '../shared/constants';
import { computeCourse, predictDestination } from '../shared/movement';
import {
  getCombatOverlayHighlights,
  getCombatPreview,
  getCombatTargetEntity,
  getQueuedCombatOverlayAttacks,
} from './renderer-combat';
import {
  buildShipLabelView,
  getDetonatedOrdnanceOverlay,
  getDisabledShipLabel,
  getOrdnanceColor,
  getOrdnanceHeading,
  getOrdnanceLifetimeView,
  getOrdnancePulse,
  getShipHeading,
  getShipIconAlpha,
  getShipIdentityMarker,
  getShipStackOffsets,
  getVisibleShips,
  shouldShowLandedIndicator,
  shouldShowOrbitIndicator,
} from './renderer-entities';
import {
  buildCombatResultToastLines,
  formatMovementEventToast,
  getToastFadeAlpha,
} from './renderer-toast';
import {
  clipViewportToMinimap,
  createMinimapLayout,
  projectWorldToMinimap,
} from './game-client-minimap';

// --- Camera ---

export class Camera {
  x = 0;
  y = 0;
  zoom = 1.0;
  targetX = 0;
  targetY = 0;
  targetZoom = 1.0;
  private canvasW = 0;
  private canvasH = 0;

  readonly minZoom = 0.15;
  readonly maxZoom = 4.0;

  update(dt: number, canvasW: number, canvasH: number) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    const speed = Math.min(CAMERA_LERP_SPEED * dt, 1);
    this.x += (this.targetX - this.x) * speed;
    this.y += (this.targetY - this.y) * speed;
    this.zoom += (this.targetZoom - this.zoom) * speed;
  }

  applyTransform(ctx: CanvasRenderingContext2D) {
    ctx.translate(this.canvasW / 2, this.canvasH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
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

  frameBounds(minX: number, maxX: number, minY: number, maxY: number, padding = 80) {
    this.targetX = (minX + maxX) / 2;
    this.targetY = (minY + maxY) / 2;
    const w = maxX - minX + padding * 2;
    const h = maxY - minY + padding * 2;
    const zx = this.canvasW / w;
    const zy = this.canvasH / h;
    this.targetZoom = Math.min(zx, zy, this.maxZoom);
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
    // Use target values so rapid trackpad events don't drift
    const worldX = (sx - this.canvasW / 2) / this.targetZoom + this.targetX;
    const worldY = (sy - this.canvasH / 2) / this.targetZoom + this.targetY;
    this.targetZoom = newZoom;
    // Adjust target to keep the point under cursor stable
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

  /** Check if a world-space point is visible (with margin for off-screen elements) */
  isVisible(wx: number, wy: number, margin = 50): boolean {
    const halfW = this.canvasW / 2 / this.zoom + margin;
    const halfH = this.canvasH / 2 / this.zoom + margin;
    return Math.abs(wx - this.x) < halfW && Math.abs(wy - this.y) < halfH;
  }
}

// --- Stars background (seeded procedural) ---

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
}

function generateStars(count: number, range: number): Star[] {
  // Simple seeded random
  let seed = 42;
  function rand(): number {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  }

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: (rand() - 0.5) * range * 2,
      y: (rand() - 0.5) * range * 2,
      brightness: 0.3 + rand() * 0.7,
      size: 0.5 + rand() * 1.5,
    });
  }
  return stars;
}

// --- Animation state ---

export interface AnimationState {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  startTime: number;
  duration: number;
  onComplete: () => void;
}

// --- Combat visual effects ---

interface CombatEffect {
  type: 'beam' | 'explosion' | 'gameOverExplosion';
  from: PixelCoord;
  to: PixelCoord;
  startTime: number;
  duration: number;
  color: string;
}

interface HexFlash {
  position: PixelCoord;
  startTime: number;
  duration: number;
  color: string;
}

// --- Planning state (controlled by input handler) ---

export interface PlanningState {
  selectedShipId: string | null;
  burns: Map<string, number | null>; // shipId -> burn direction (or null for no burn)
  overloads: Map<string, number | null>; // shipId -> overload direction (warships only, 2 fuel total)
  weakGravityChoices: Map<string, Record<string, boolean>>; // shipId -> { hexKey: true to ignore }
  torpedoAccel: number | null; // direction for torpedo launch boost
  torpedoAccelSteps: 1 | 2 | null;
  combatTargetId: string | null; // enemy ship targeted for combat
  combatTargetType: 'ship' | 'ordnance' | null;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
  queuedAttacks: CombatAttack[]; // multi-target: attacks queued before sending
  hoverHex: HexCoord | null; // current hex being hovered by mouse
}

// --- Renderer ---

export const HEX_SIZE = 28; // pixels per hex radius

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  camera: Camera;
  private stars: Star[];
  private map: SolarSystemMap | null = null;
  private gameState: GameState | null = null;
  private playerId = -1;
  private animState: AnimationState | null = null;
  planningState: PlanningState = {
    selectedShipId: null,
    burns: new Map(),
    overloads: new Map(),
    weakGravityChoices: new Map(),
    torpedoAccel: null,
    torpedoAccelSteps: null,
    combatTargetId: null,
    combatTargetType: null,
    combatAttackerIds: [],
    combatAttackStrength: null,
    queuedAttacks: [],
    hoverHex: null,
  };
  private combatResults: { results: CombatResult[]; showUntil: number } | null = null;
  private combatEffects: CombatEffect[] = [];
  private hexFlashes: HexFlash[] = [];
  private movementEvents: { events: MovementEvent[]; showUntil: number } | null = null;
  // Phase banner removed — DOM phase alert in ui.ts is the sole overlay
  private lastTime = 0;
  // Persistent ship trails: shipId -> array of hex positions visited across turns
  private shipTrails: Map<string, HexCoord[]> = new Map();
  private ordnanceTrails: Map<string, HexCoord[]> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = new Camera();
    this.stars = generateStars(600, 2000);
  }

  setMap(map: SolarSystemMap) {
    this.map = map;
  }

  setGameState(state: GameState) {
    this.gameState = state;
  }

  setPlayerId(id: number) {
    this.playerId = id;
  }

  clearTrails() {
    this.shipTrails.clear();
    this.ordnanceTrails.clear();
  }

  animateMovements(movements: ShipMovement[], ordnanceMovements: OrdnanceMovement[], onComplete: () => void) {
    // Record movement paths into persistent trails
    for (const m of movements) {
      const trail = this.shipTrails.get(m.shipId);
      if (trail) {
        // Append path (skip first point if it matches the trail's last point)
        const start = (trail.length > 0 && m.path.length > 0 &&
          trail[trail.length - 1].q === m.path[0].q &&
          trail[trail.length - 1].r === m.path[0].r) ? 1 : 0;
        for (let i = start; i < m.path.length; i++) trail.push(m.path[i]);
      } else {
        this.shipTrails.set(m.shipId, [...m.path]);
      }
    }
    for (const m of ordnanceMovements) {
      const trail = this.ordnanceTrails.get(m.ordnanceId);
      if (trail) {
        const start = (trail.length > 0 && m.path.length > 0 &&
          trail[trail.length - 1].q === m.path[0].q &&
          trail[trail.length - 1].r === m.path[0].r) ? 1 : 0;
        for (let i = start; i < m.path.length; i++) trail.push(m.path[i]);
      } else {
        this.ordnanceTrails.set(m.ordnanceId, [...m.path]);
      }
    }

    this.animState = {
      movements,
      ordnanceMovements,
      startTime: performance.now(),
      duration: MOVEMENT_ANIM_DURATION,
      onComplete,
    };

    // Frame camera on all moving ships and ordnance
    const allFrom = [...movements.map(m => m.from), ...ordnanceMovements.map(m => m.from)];
    const allTo = [...movements.map(m => m.to), ...ordnanceMovements.map(m => m.to)];
    const allHexes = [...allFrom, ...allTo];
    if (this.map && allHexes.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const h of allHexes) {
        const p = hexToPixel(h, HEX_SIZE);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      this.camera.frameBounds(minX, maxX, minY, maxY, 150);
    }
  }

  showCombatResults(results: CombatResult[], previousState?: GameState | null) {
    const now = performance.now();
    this.combatResults = { results, showUntil: now + 3000 };

    // Create visual effects for each combat result
    for (const r of results) {
      const target = getCombatTargetEntity(r, this.gameState, previousState ?? null);
      if (!target) continue;
      const targetPos = hexToPixel(target.position, HEX_SIZE);

      // Beam from attacker(s) to target
      if (r.attackerIds.length > 0) {
        const firstId = r.attackerIds[0];
        let attackerPos: PixelCoord | null = null;

        if (firstId.startsWith('base:')) {
          const baseRef = firstId.slice(5);
          if (baseRef.includes(',')) {
            const [bq, br] = baseRef.split(',').map(Number);
            attackerPos = hexToPixel({ q: bq, r: br }, HEX_SIZE);
          } else if (this.map) {
            // Backward-compatible fallback for older replays/messages
            for (const [key, hex] of this.map.hexes) {
              if (hex.base?.bodyName === baseRef) {
                const [bq, br] = key.split(',').map(Number);
                attackerPos = hexToPixel({ q: bq, r: br }, HEX_SIZE);
                break;
              }
            }
          }
        } else {
          const attacker = this.gameState?.ships.find(s => s.id === firstId);
          if (attacker) {
            attackerPos = hexToPixel(attacker.position, HEX_SIZE);
          }
        }

        if (attackerPos && r.attackType !== 'asteroidHazard') {
          const beamColor = firstId.startsWith('base:') ? '#66bb6a'
            : r.damageType === 'eliminated' ? '#ff4444'
            : r.damageType === 'disabled' ? '#ffaa00' : '#4fc3f7';
          this.combatEffects.push({
            type: 'beam',
            from: attackerPos,
            to: targetPos,
            startTime: now,
            duration: 600,
            color: beamColor,
          });
        }
      }

      // Explosion at target for damage
      if (r.damageType !== 'none') {
        this.combatEffects.push({
          type: 'explosion',
          from: targetPos,
          to: targetPos,
          startTime: now + 300, // Delay for beam to reach
          duration: 800,
          color: r.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
        });
      }

      // Same for counterattack
      if (r.counterattack && r.counterattack.damageType !== 'none') {
        const counterTarget = this.gameState?.ships.find(s => s.id === r.counterattack!.targetId);
        if (counterTarget) {
          const counterPos = hexToPixel(counterTarget.position, HEX_SIZE);
          this.combatEffects.push({
            type: 'beam',
            from: targetPos,
            to: counterPos,
            startTime: now + 500,
            duration: 600,
            color: r.counterattack.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
          });
          this.combatEffects.push({
            type: 'explosion',
            from: counterPos,
            to: counterPos,
            startTime: now + 800,
            duration: 800,
            color: r.counterattack.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
          });
        }
      }
    }
  }

  showMovementEvents(events: MovementEvent[]) {
    if (events.length > 0) {
      const now = performance.now();
      this.movementEvents = { events, showUntil: now + 4000 };

      // Create hex flashes at event locations
      for (const ev of events) {
        const p = hexToPixel(ev.hex, HEX_SIZE);
        const color = ev.type === 'crash' ? '#ff4444'
          : ev.type === 'nukeDetonation' ? '#ff6600'
          : ev.damageType === 'eliminated' ? '#ff4444'
          : '#ffaa00';
        this.hexFlashes.push({
          position: p,
          startTime: now + MOVEMENT_ANIM_DURATION * 0.8, // Flash near end of movement
          duration: 1500,
          color,
        });
      }
    }
  }

  showLandingEffect(hex: HexCoord) {
    const p = hexToPixel(hex, HEX_SIZE);
    const now = performance.now();
    this.hexFlashes.push({
      position: p,
      startTime: now + MOVEMENT_ANIM_DURATION * 0.9,
      duration: 2000,
      color: '#66bb6a',
    });
  }

  /**
   * Trigger dramatic staggered explosions on the losing player's ships.
   * Returns the total animation duration in ms.
   */
  triggerGameOverExplosions(ships: Ship[]): number {
    const now = performance.now();
    const stagger = 250; // ms between each ship exploding
    for (let i = 0; i < ships.length; i++) {
      const p = hexToPixel(ships[i].position, HEX_SIZE);
      const delay = i * stagger;
      // Large dramatic explosion
      this.combatEffects.push({
        type: 'gameOverExplosion',
        from: p,
        to: p,
        startTime: now + delay,
        duration: 1500,
        color: '#ff4444',
      });
      // Secondary orange ring slightly delayed
      this.combatEffects.push({
        type: 'gameOverExplosion',
        from: p,
        to: p,
        startTime: now + delay + 200,
        duration: 1200,
        color: '#ff8800',
      });
    }
    return ships.length * stagger + 1500; // total duration before panel shows
  }

  // showPhaseBanner removed — DOM phase alert in ui.ts is the sole overlay

  isAnimating(): boolean {
    return this.animState !== null;
  }

  resetCamera() {
    this.camera.targetX = 0;
    this.camera.targetY = 0;
    this.camera.targetZoom = 0.3;
    this.camera.snapToTarget();
  }

  centerOnHex(hex: HexCoord) {
    const p = hexToPixel(hex, HEX_SIZE);
    this.camera.targetX = p.x;
    this.camera.targetY = p.y;
  }

  frameOnShips() {
    if (!this.gameState) return;
    const myShips = this.gameState.ships.filter(s => s.owner === this.playerId);
    if (myShips.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of myShips) {
      const p = hexToPixel(s.position, HEX_SIZE);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    this.camera.frameBounds(minX, maxX, minY, maxY, 200);
  }

  start() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private loop(now: number) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.camera.update(dt, window.innerWidth, window.innerHeight);
    this.render(now);

    // Check animation completion
    if (this.animState && now - this.animState.startTime >= this.animState.duration) {
      const cb = this.animState.onComplete;
      this.animState = null;
      cb();
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private render(now: number) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Clear
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    this.camera.applyTransform(ctx);

    this.renderStars(ctx);
    if (this.map) {
      this.renderHexGrid(ctx, this.map);
      if (this.gameState) this.renderMapBorder(ctx, this.map, this.gameState, now);
      this.renderAsteroids(ctx, this.map);
      this.renderGravityIndicators(ctx, this.map);
      this.renderBodies(ctx, now, this.map);
      this.renderBaseMarkers(ctx, this.map, this.gameState);
      if (this.gameState) {
        this.renderLandingTarget(ctx, this.map, this.gameState, now);
      }
    }
    if (this.gameState && this.map) {
      this.renderDetectionRanges(ctx, this.gameState, this.map);
      this.renderCourseVectors(ctx, this.gameState, this.map, now);
      this.renderOrdnance(ctx, this.gameState, now);
      this.renderTorpedoGuidance(ctx, this.gameState, now);
      this.renderCombatOverlay(ctx, this.gameState, now);
      this.renderTrails(ctx, this.gameState);
      this.renderMovementPaths(ctx, this.gameState, now);
      this.renderShips(ctx, this.gameState, now);
      this.renderHexFlashes(ctx, now);
      this.renderCombatEffects(ctx, now);
    }

    ctx.restore();

    // Combat results toast (screen-space)
    if (this.combatResults && this.gameState) {
      if (now > this.combatResults.showUntil) {
        this.combatResults = null;
      } else {
        this.renderCombatResultsToast(ctx, this.combatResults.results, now, w);
      }
    }

    // Movement events toast (screen-space)
    if (this.movementEvents && this.gameState) {
      if (now > this.movementEvents.showUntil) {
        this.movementEvents = null;
      } else {
        this.renderMovementEventsToast(ctx, this.movementEvents.events, now, w);
      }
    }

    // Phase banner removed — DOM overlay handles this

    // Minimap (screen-space, bottom-right)
    if (this.map && this.gameState) {
      this.renderMinimap(ctx, w, h);
    }
  }

  // --- Render layers ---

  private renderStars(ctx: CanvasRenderingContext2D) {
    for (const star of this.stars) {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * 0.6})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size / this.camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Precomputed flat-top hex vertex offsets (cos/sin at 60-degree intervals)
  private static readonly HEX_OFFSETS: [number, number][] = (() => {
    const offsets: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 3) * i;
      offsets.push([Math.cos(angle), Math.sin(angle)]);
    }
    return offsets;
  })();

  private renderHexGrid(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    ctx.strokeStyle = 'rgba(100, 140, 200, 0.25)';
    ctx.lineWidth = 0.8;
    const offsets = Renderer.HEX_OFFSETS;
    const size = HEX_SIZE;
    const { minQ, maxQ, minR, maxR } = map.bounds;
    // Compute pixel-space bounding rectangle from all four corners
    const corners = [
      hexToPixel({ q: minQ, r: minR }, size),
      hexToPixel({ q: maxQ, r: minR }, size),
      hexToPixel({ q: minQ, r: maxR }, size),
      hexToPixel({ q: maxQ, r: maxR }, size),
    ];
    const pxMinX = Math.min(...corners.map(c => c.x)) - size;
    const pxMaxX = Math.max(...corners.map(c => c.x)) + size;
    const pxMinY = Math.min(...corners.map(c => c.y)) - size;
    const pxMaxY = Math.max(...corners.map(c => c.y)) + size;
    // Over-iterate q range to fill the rectangle, clipping by pixel bounds
    const qPad = Math.ceil((maxR - minR) / 2) + 2;
    ctx.beginPath();
    for (let q = minQ - qPad; q <= maxQ + qPad; q++) {
      for (let r = minR - qPad; r <= maxR + qPad; r++) {
        const p = hexToPixel({ q, r }, size);
        if (p.x < pxMinX || p.x > pxMaxX || p.y < pxMinY || p.y > pxMaxY) continue;
        if (!this.camera.isVisible(p.x, p.y)) continue;
        ctx.moveTo(p.x + offsets[0][0] * size, p.y + offsets[0][1] * size);
        for (let i = 1; i <= 6; i++) {
          ctx.lineTo(p.x + offsets[i][0] * size, p.y + offsets[i][1] * size);
        }
      }
    }
    ctx.stroke();
  }

  private renderGravityIndicators(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    // Subtle radial lines pointing toward body for each gravity hex
    for (const [key, hex] of map.hexes) {
      if (!hex.gravity) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
      // Viewport culling — skip off-screen hexes
      if (!this.camera.isVisible(p.x, p.y)) continue;
      const dir = HEX_DIRECTIONS[hex.gravity.direction];
      const target = hexToPixel(hexAdd({ q, r }, dir), HEX_SIZE);

      ctx.strokeStyle = hex.gravity.strength === 'weak'
        ? 'rgba(100, 140, 255, 0.12)'
        : 'rgba(100, 140, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(
        p.x + (target.x - p.x) * 0.4,
        p.y + (target.y - p.y) * 0.4,
      );
      ctx.stroke();

      // Small arrowhead
      const ax = p.x + (target.x - p.x) * 0.4;
      const ay = p.y + (target.y - p.y) * 0.4;
      const angle = Math.atan2(target.y - p.y, target.x - p.x);
      const headLen = 4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle - 0.5), ay - headLen * Math.sin(angle - 0.5));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle + 0.5), ay - headLen * Math.sin(angle + 0.5));
      ctx.stroke();
    }
  }

  private renderBodies(ctx: CanvasRenderingContext2D, now: number, map: SolarSystemMap) {
    for (const body of map.bodies) {
      const p = hexToPixel(body.center, HEX_SIZE);
      const r = body.renderRadius * HEX_SIZE;
      const pulse = 0.5 + 0.5 * Math.sin(now / 1500 + p.x * 0.01);

      // Atmospheric/Gravity Ripples
      const rippleCount = 3;
      for (let i = 1; i <= rippleCount; i++) {
        const rippleR = r * (1.2 + i * 0.8 + pulse * 0.2);
        const rippleAlpha = (0.15 / i) * (1 - pulse * 0.3);
        ctx.strokeStyle = body.color;
        ctx.globalAlpha = rippleAlpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rippleR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Primary Glow
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3);
      glow.addColorStop(0, body.color + '30');
      glow.addColorStop(0.4, body.color + '10');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
      ctx.fill();

      // Body disc
      const grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
      grad.addColorStop(0, lightenColor(body.color, 30));
      grad.addColorStop(1, body.color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '600 11px var(--font-display), sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(body.name.toUpperCase(), p.x, p.y + r + 18);
    }
  }

  private renderBaseMarkers(ctx: CanvasRenderingContext2D, map: SolarSystemMap, state: GameState | null) {
    let myBases = new Set<string>();
    let enemyBases = new Set<string>();
    const destroyed = new Set(state?.destroyedBases ?? []);
    if (state && this.playerId >= 0) {
      myBases = new Set(state.players[this.playerId]?.bases ?? []);
      enemyBases = new Set(state.players[1 - this.playerId]?.bases ?? []);
    }

    for (const [key, hex] of map.hexes) {
      if (!hex.base) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
      const isDestroyed = destroyed.has(key);

      if (isDestroyed) {
        ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 5);
        ctx.moveTo(p.x + 5, p.y - 5);
        ctx.lineTo(p.x - 5, p.y + 5);
        ctx.stroke();
        continue;
      }

      // Color by ownership
      if (myBases.has(key)) {
        ctx.fillStyle = '#4fc3f7'; // friendly blue
        ctx.strokeStyle = '#2196f3';
      } else if (enemyBases.has(key)) {
        ctx.fillStyle = '#ff8a65'; // enemy orange
        ctx.strokeStyle = '#e64a19';
      } else {
        ctx.fillStyle = '#66bb6a'; // neutral green
        ctx.strokeStyle = '#388e3c';
      }
      ctx.lineWidth = 1;

      // Small diamond marker
      const s = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private renderMapBorder(ctx: CanvasRenderingContext2D, map: SolarSystemMap, state: GameState, now: number) {
    // Only show for escape scenarios (or always as subtle boundary)
    const player = state.players[this.playerId];
    const isEscape = player?.escapeWins;

    const bounds = map.bounds;
    const margin = 3; // match hasEscaped
    const tl = hexToPixel({ q: bounds.minQ - margin, r: bounds.minR - margin }, HEX_SIZE);
    const br = hexToPixel({ q: bounds.maxQ + margin, r: bounds.maxR + margin }, HEX_SIZE);

    if (isEscape) {
      // Prominent pulsing border for escape scenarios
      const pulse = 0.15 + 0.1 * Math.sin(now / 1000);
      ctx.strokeStyle = `rgba(100, 255, 100, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.setLineDash([]);
    } else {
      // Subtle border for awareness
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }
  }

  private renderAsteroids(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    const destroyed = new Set(this.gameState?.destroyedAsteroids ?? []);
    for (const [key, hex] of map.hexes) {
      if (hex.terrain !== 'asteroid') continue;
      if (destroyed.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
      if (!this.camera.isVisible(p.x, p.y)) continue;

      // Small scattered dots to suggest asteroid debris
      ctx.fillStyle = 'rgba(160, 140, 120, 0.35)';
      const seed = q * 7 + r * 13; // deterministic per hex
      for (let i = 0; i < 3; i++) {
        const ox = ((seed * (i + 1) * 17) % 11 - 5) * 1.5;
        const oy = ((seed * (i + 1) * 23) % 11 - 5) * 1.5;
        const sz = 1.5 + ((seed * (i + 1) * 31) % 5) * 0.3;
        ctx.beginPath();
        ctx.arc(p.x + ox, p.y + oy, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private renderLandingTarget(ctx: CanvasRenderingContext2D, map: SolarSystemMap, state: GameState, now: number) {
    const player = state.players[this.playerId];
    if (!player) return;

    if (player.escapeWins) {
      // Escape objective: render edge arrows showing "escape" direction
      const bounds = map.bounds;
      const pulse = 0.3 + 0.2 * Math.sin(now / 600);
      ctx.fillStyle = `rgba(100, 255, 100, ${pulse})`;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';

      // Show arrows at several positions along map edges
      const edgePositions = [
        hexToPixel({ q: bounds.maxQ + 2, r: Math.floor((bounds.minR + bounds.maxR) / 2) }, HEX_SIZE),
        hexToPixel({ q: bounds.minQ - 2, r: Math.floor((bounds.minR + bounds.maxR) / 2) }, HEX_SIZE),
        hexToPixel({ q: Math.floor((bounds.minQ + bounds.maxQ) / 2), r: bounds.maxR + 2 }, HEX_SIZE),
        hexToPixel({ q: Math.floor((bounds.minQ + bounds.maxQ) / 2), r: bounds.minR - 2 }, HEX_SIZE),
      ];
      const arrows = ['→ ESCAPE', '← ESCAPE', '↓ ESCAPE', '↑ ESCAPE'];
      for (let i = 0; i < edgePositions.length; i++) {
        ctx.fillText(arrows[i], edgePositions[i].x, edgePositions[i].y);
      }
      return;
    }

    if (!player.targetBody) return;

    // Find the target body
    const body = map.bodies.find(b => b.name === player.targetBody);
    if (!body) return;

    const p = hexToPixel(body.center, HEX_SIZE);
    const r = body.renderRadius * HEX_SIZE;

    // Pulsing ring around target body
    const pulse = 0.4 + 0.3 * Math.sin(now / 800);
    ctx.strokeStyle = `rgba(100, 255, 100, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // "TARGET" label below body label
    ctx.fillStyle = `rgba(100, 255, 100, ${0.5 + pulse * 0.3})`;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▼ TARGET', p.x, p.y + r + 24);
  }

  private renderDetectionRanges(ctx: CanvasRenderingContext2D, state: GameState, map: SolarSystemMap) {
    if (this.animState) return;

    // Show detection range for selected own ship
    const selectedId = this.planningState.selectedShipId;
    for (const ship of state.ships) {
      if (ship.owner !== this.playerId || ship.destroyed) continue;
      const isSelected = ship.id === selectedId;
      if (!isSelected) continue; // Only show for selected ship to avoid clutter

      const p = hexToPixel(ship.position, HEX_SIZE);
      const detRange = SHIP_DETECTION_RANGE;
      // Approximate circle radius from hex distance
      const radius = detRange * HEX_SIZE * 1.73; // sqrt(3) * hex_size * range

      ctx.strokeStyle = 'rgba(79, 195, 247, 0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Sensor range label removed — the dashed circle is sufficient
    }

    // Show base detection ranges for own bases
    const player = state.players[this.playerId];
    const destroyed = new Set(state.destroyedBases);
    for (const key of player?.bases ?? []) {
      if (destroyed.has(key)) continue;
      const hex = map.hexes.get(key);
      if (!hex?.base) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
      const radius = BASE_DETECTION_RANGE * HEX_SIZE * 1.73;

      ctx.strokeStyle = 'rgba(79, 195, 247, 0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private renderCourseVectors(ctx: CanvasRenderingContext2D, state: GameState, map: SolarSystemMap, now: number) {
    // During animation, don't show planning vectors
    if (this.animState) return;

    for (const ship of state.ships) {
      if (ship.landed || ship.destroyed) continue;
      // Don't show velocity vectors for undetected enemy ships
      if (ship.owner !== this.playerId && !ship.detected) continue;
      const from = hexToPixel(ship.position, HEX_SIZE);
      const predicted = predictDestination(ship);
      const to = hexToPixel(predicted, HEX_SIZE);

      // Velocity vector — thin dashed line
      const speed = hexVecLength(ship.velocity);
      if (predicted.q !== ship.position.q || predicted.r !== ship.position.r) {
        const isOwn = ship.owner === this.playerId;
        ctx.strokeStyle = isOwn
          ? 'rgba(79, 195, 247, 0.45)'
          : 'rgba(255, 152, 0, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Speed label at midpoint for detected enemy ships
        if (!isOwn && speed >= 1) {
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          ctx.fillStyle = 'rgba(255, 152, 0, 0.5)';
          ctx.font = '7px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`v${Math.round(speed)}`, mx, my - 5);
        }
      }
    }

    // Planning preview for selected ship
    if (state.phase === 'astrogation' && state.activePlayer === this.playerId) {
      for (const ship of state.ships) {
        if (ship.owner !== this.playerId || ship.destroyed) continue;
        const burn = this.planningState.burns.get(ship.id) ?? null;
        const isSelected = ship.id === this.planningState.selectedShipId;

        if (burn !== null || isSelected) {
          const overload = this.planningState.overloads.get(ship.id) ?? null;
          const wgChoices = this.planningState.weakGravityChoices.get(ship.id) ?? {};
          const course = computeCourse(ship, burn, map, {
            overload,
            weakGravityChoices: wgChoices,
            destroyedBases: state.destroyedBases,
          });
          const from = hexToPixel(ship.landed ? course.path[0] : ship.position, HEX_SIZE);
          const to = hexToPixel(course.destination, HEX_SIZE);

          // Course line
          ctx.strokeStyle = course.crashed ? '#ff4444' : '#4fc3f7';
          ctx.lineWidth = 2;
          ctx.setLineDash(burn !== null ? [] : [6, 4]);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          // Draw through intermediate path points for slight curve effect
          for (let i = 1; i < course.path.length; i++) {
            const pp = hexToPixel(course.path[i], HEX_SIZE);
            ctx.lineTo(pp.x, pp.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Show gravity deflection indicators along the path
          for (const grav of course.gravityEffects) {
            if (grav.strength === 'weak') continue; // weak has its own toggle UI
            const gp = hexToPixel(grav.hex, HEX_SIZE);
            const dp = hexToPixel(hexAdd(grav.hex, HEX_DIRECTIONS[grav.direction]), HEX_SIZE);
            const angle = Math.atan2(dp.y - gp.y, dp.x - gp.x);
            const arrowLen = 7;
            const ax = gp.x + Math.cos(angle) * arrowLen;
            const ay = gp.y + Math.sin(angle) * arrowLen;
            ctx.strokeStyle = 'rgba(255, 200, 50, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(gp.x, gp.y);
            ctx.lineTo(ax, ay);
            ctx.stroke();
            // Arrowhead
            const headLen = 4;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - headLen * Math.cos(angle - 0.5), ay - headLen * Math.sin(angle - 0.5));
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - headLen * Math.cos(angle + 0.5), ay - headLen * Math.sin(angle + 0.5));
            ctx.stroke();
          }

          // Ghost ship at destination
          if (!course.crashed) {
            this.drawShipIcon(ctx, to.x, to.y, ship.owner, 0.4, 0, 0, ship.type);
          }

          // Burn direction arrows (when selected)
          if (isSelected && ship.fuel > 0) {
            const predDest = ship.landed ? course.path[0] : predictDestination(ship);
            for (let d = 0; d < 6; d++) {
              const targetHex = hexAdd(predDest, HEX_DIRECTIONS[d]);
              const tp = hexToPixel(targetHex, HEX_SIZE);
              const isActive = burn === d;
              const isHovered = this.planningState.hoverHex && hexEqual(this.planningState.hoverHex, targetHex);

              let size = 8;
              if (isActive) size = 10;
              if (isHovered) size += 2;

              if (isHovered || isActive) {
                ctx.shadowBlur = isHovered ? 12 : 8;
                ctx.shadowColor = '#4fc3f7';
              }

              ctx.fillStyle = isActive ? 'rgba(79, 195, 247, 0.8)' : isHovered ? 'rgba(79, 195, 247, 0.4)' : 'rgba(79, 195, 247, 0.15)';
              ctx.strokeStyle = isActive || isHovered ? '#4fc3f7' : 'rgba(79, 195, 247, 0.3)';
              ctx.lineWidth = isActive || isHovered ? 2 : 1.5;
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, size, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              ctx.shadowBlur = 0;
            }

            // Overload direction arrows (shown after burn is set, for warships with enough fuel)
            if (burn !== null) {
              const stats = SHIP_STATS[ship.type];
              if (stats?.canOverload && ship.fuel >= 2 && !ship.overloadUsed) {
                const burnDest = hexAdd(predDest, HEX_DIRECTIONS[burn]);
                for (let d = 0; d < 6; d++) {
                  const olHex = hexAdd(burnDest, HEX_DIRECTIONS[d]);
                  const olp = hexToPixel(olHex, HEX_SIZE);
                  const isOlActive = overload === d;
                  const isOlHovered = this.planningState.hoverHex && hexEqual(this.planningState.hoverHex, olHex);

                  let olSize = 6;
                  if (isOlActive) olSize = 8;
                  if (isOlHovered) olSize += 1.5;

                  if (isOlHovered || isOlActive) {
                    ctx.shadowBlur = isOlHovered ? 8 : 4;
                    ctx.shadowColor = '#ffb74d';
                  }

                  ctx.fillStyle = isOlActive ? 'rgba(255, 183, 77, 0.8)' : isOlHovered ? 'rgba(255, 183, 77, 0.4)' : 'rgba(255, 183, 77, 0.1)';
                  ctx.strokeStyle = isOlActive || isOlHovered ? '#ffb74d' : 'rgba(255, 183, 77, 0.25)';
                  ctx.lineWidth = isOlActive || isOlHovered ? 2 : 1.5;
                  ctx.beginPath();
                  ctx.arc(olp.x, olp.y, olSize, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                  ctx.shadowBlur = 0;
                }
              }
            }
          }

          // Weak gravity toggle indicators on the path
          if (isSelected) {
            for (const grav of course.enteredGravityEffects) {
              if (grav.strength !== 'weak') continue;
              const gp = hexToPixel(grav.hex, HEX_SIZE);
              const key = hexKey(grav.hex);
              const isIgnored = wgChoices[key] === true;

              // Draw hollow/filled circle to indicate ignore/apply
              ctx.strokeStyle = isIgnored ? 'rgba(180, 130, 255, 0.5)' : 'rgba(180, 130, 255, 0.8)';
              ctx.fillStyle = isIgnored ? 'rgba(180, 130, 255, 0.1)' : 'rgba(180, 130, 255, 0.35)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(gp.x, gp.y, 10, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              // "G" label and strikethrough when ignored
              ctx.fillStyle = isIgnored ? 'rgba(180, 130, 255, 0.4)' : 'rgba(180, 130, 255, 0.9)';
              ctx.font = 'bold 8px monospace';
              ctx.textAlign = 'center';
              ctx.fillText('G', gp.x, gp.y + 3);
              if (isIgnored) {
                ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(gp.x - 6, gp.y + 4);
                ctx.lineTo(gp.x + 6, gp.y - 4);
                ctx.stroke();
              }
            }
          }

          // Fuel cost indicator
          if (burn !== null) {
            ctx.fillStyle = '#ffcc00';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`-${course.fuelSpent}`, to.x, to.y - 16);
          }
        }
      }
    }
  }

  private renderTrails(ctx: CanvasRenderingContext2D, state: GameState) {
    // Draw persistent ship trails (faint lines showing historical paths)
    for (const [shipId, trail] of this.shipTrails) {
      if (trail.length < 2) continue;
      const ship = state.ships.find(s => s.id === shipId);
      if (!ship) continue;
      // Skip undetected enemy trails
      if (ship.owner !== this.playerId && !ship.detected) continue;

      const isOwn = ship.owner === this.playerId;
      ctx.strokeStyle = isOwn ? 'rgba(79, 195, 247, 0.28)' : 'rgba(255, 152, 0, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      const p0 = hexToPixel(trail[0], HEX_SIZE);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < trail.length; i++) {
        const p = hexToPixel(trail[i], HEX_SIZE);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Small dots at each waypoint
      const dotColor = isOwn ? 'rgba(79, 195, 247, 0.35)' : 'rgba(255, 152, 0, 0.35)';
      for (let i = 0; i < trail.length; i++) {
        const p = hexToPixel(trail[i], HEX_SIZE);
        if (!this.camera.isVisible(p.x, p.y)) continue;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw ordnance trails (even fainter)
    for (const [ordId, trail] of this.ordnanceTrails) {
      if (trail.length < 2) continue;
      const ord = state.ordnance?.find(o => o.id === ordId);
      const isOwn = ord ? ord.owner === this.playerId : false;
      // Show all ordnance trails (they're visible objects)
      ctx.strokeStyle = isOwn ? 'rgba(79, 195, 247, 0.1)' : 'rgba(255, 152, 0, 0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      const p0 = hexToPixel(trail[0], HEX_SIZE);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < trail.length; i++) {
        const p = hexToPixel(trail[i], HEX_SIZE);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private renderMovementPaths(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (!this.animState) return;

    const progress = Math.min((now - this.animState.startTime) / this.animState.duration, 1);

    for (const movement of this.animState.movements) {
      const ship = state.ships.find(s => s.id === movement.shipId);
      if (!ship) continue;
      // Skip undetected enemy movement paths
      if (ship.owner !== this.playerId && !ship.detected) continue;
      if (movement.path.length < 2) continue;

      // Draw dotted path line
      const color = ship.owner === this.playerId ? 'rgba(79, 195, 247, 0.4)' : 'rgba(255, 152, 0, 0.4)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      const start = hexToPixel(movement.path[0], HEX_SIZE);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < movement.path.length; i++) {
        const p = hexToPixel(movement.path[i], HEX_SIZE);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Small dot at each waypoint that's been passed
      const totalSegs = movement.path.length - 1;
      const passedSegs = Math.floor(progress * totalSegs);
      for (let i = 1; i <= passedSegs && i < movement.path.length; i++) {
        const p = hexToPixel(movement.path[i], HEX_SIZE);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private renderShips(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    const visibleShips = getVisibleShips(state, this.playerId, this.animState !== null);
    const stackOffsets = this.animState ? null : getShipStackOffsets(visibleShips);

    for (const ship of visibleShips) {
      let pos: PixelCoord;
      let velocity = ship.velocity;
      let labelYOffset = 24;

      // Check if this ship is being animated
      if (this.animState) {
        const movement = this.animState.movements.find(m => m.shipId === ship.id);
        if (movement) {
          const progress = Math.min((now - this.animState.startTime) / this.animState.duration, 1);
          pos = this.interpolatePath(movement.path, progress);
          velocity = movement.newVelocity;

          // Thrust trail during animation
          if (movement.fuelSpent > 0 && progress < 0.8) {
            const angle = Math.atan2(
              hexToPixel(movement.to, HEX_SIZE).y - hexToPixel(movement.from, HEX_SIZE).y,
              hexToPixel(movement.to, HEX_SIZE).x - hexToPixel(movement.from, HEX_SIZE).x,
            );
            this.drawThrustTrail(ctx, pos.x, pos.y, angle + Math.PI, progress);
          }
        } else {
          pos = hexToPixel(ship.position, HEX_SIZE);
        }
      } else {
        pos = hexToPixel(ship.position, HEX_SIZE);
      }

      // Offset for stacked ships at same hex
      const stackOffset = stackOffsets?.get(ship.id);
      if (stackOffset) {
        pos = { x: pos.x + stackOffset.xOffset, y: pos.y };
        labelYOffset = stackOffset.labelYOffset;
      }

      // Ship heading based on velocity
      const heading = getShipHeading(ship.position, velocity, HEX_SIZE);

      // Selection highlight
      const isSelected = ship.id === this.planningState.selectedShipId;
      if (isSelected) {
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Disabled ships shown dimmer
      const disabledLabel = getDisabledShipLabel(ship, this.animState !== null);
      this.drawShipIcon(
        ctx,
        pos.x,
        pos.y,
        ship.owner,
        getShipIconAlpha(ship),
        heading,
        ship.damage.disabledTurns,
        ship.type,
      );

      // Disabled indicator
      if (disabledLabel) {
        ctx.fillStyle = '#ff5252'; // More prominent red
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(disabledLabel, pos.x + 12, pos.y - 12);
      }

      const identityMarker = getShipIdentityMarker(
        ship,
        this.playerId,
        Boolean(this.gameState?.scenarioRules.hiddenIdentityInspection),
        this.animState !== null,
      );
      if (identityMarker === 'friendlyFugitive') {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('\u2605', pos.x, pos.y - 14);
      } else if (identityMarker === 'enemyFugitive' || identityMarker === 'enemyDecoy') {
        ctx.textAlign = 'center';
        if (identityMarker === 'enemyFugitive') {
          ctx.fillStyle = 'rgba(255, 120, 120, 0.95)';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('\u2605', pos.x, pos.y - 14);
        } else {
          ctx.strokeStyle = 'rgba(220, 220, 220, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y - 14, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const inGravity = Boolean(this.map?.hexes.get(hexKey(ship.position))?.gravity);
      if (shouldShowOrbitIndicator(ship, inGravity, this.animState !== null)) {
        const phase = now / 2000 + pos.x * 0.01;
        ctx.strokeStyle = 'rgba(150, 200, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 16, phase, phase + Math.PI * 1.5);
        ctx.stroke();
      }

      if (shouldShowLandedIndicator(ship, this.animState !== null)) {
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const labelView = buildShipLabelView(ship, this.playerId, inGravity, this.animState !== null);
      if (labelView) {
        ctx.textAlign = 'center';
        ctx.fillStyle = labelView.typeColor;
        ctx.font = labelView.typeFont;
        ctx.fillText(labelView.typeName, pos.x, pos.y + labelYOffset);
        if (labelView.statusTag && labelView.statusColor && labelView.statusFont) {
          ctx.fillStyle = labelView.statusColor;
          ctx.font = labelView.statusFont;
          ctx.fillText(labelView.statusTag, pos.x, pos.y + labelYOffset + 9);
        }
      }
    }
  }

  private drawShipIcon(ctx: CanvasRenderingContext2D, x: number, y: number, owner: number, alpha: number, heading: number, disabledTurns = 0, shipType = '') {
    const color = owner === 0 ? `rgba(79, 195, 247, ${alpha})` : `rgba(255, 152, 0, ${alpha})`;
    // Size based on ship type combat value
    const stats = SHIP_STATS[shipType];
    const combat = stats?.combat ?? 2;
    const size = combat >= 15 ? 12 : combat >= 8 ? 10 : combat >= 4 ? 9 : 8;

    ctx.save();
    ctx.translate(x, y);

    // Damage glow for disabled ships (flickering red/orange)
    if (disabledTurns > 0) {
      const flickerPhase = performance.now() / 200 + x * 0.1; // unique per ship
      const intensity = 0.3 + 0.2 * Math.sin(flickerPhase) + 0.1 * Math.sin(flickerPhase * 2.7);
      const glowColor = disabledTurns >= 4 ? `rgba(255, 50, 50, ${intensity})` : `rgba(255, 150, 50, ${intensity})`;
      const glowRadius = 10 + disabledTurns;
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.rotate(heading);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (shipType === 'orbitalBase') {
      // Draw orbital base as octagon with inner ring
      const r = 12;
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(size, 0);          // Nose
      ctx.lineTo(-size * 0.6, -size * 0.5);  // Top wing
      ctx.lineTo(-size * 0.3, 0);   // Indent
      ctx.lineTo(-size * 0.6, size * 0.5);   // Bottom wing
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawThrustTrail(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, progress: number) {
    const len = 12 + Math.sin(progress * 20) * 4;
    const spread = 0.3;
    const alpha = 0.6 * (1 - progress);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgba(255, 200, 50, ${alpha})`);
    grad.addColorStop(0.5, `rgba(255, 100, 20, ${alpha * 0.5})`);
    grad.addColorStop(1, 'transparent');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(len, -len * spread);
    ctx.lineTo(len, len * spread);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private interpolatePath(path: HexCoord[], progress: number): PixelCoord {
    if (path.length <= 1) return hexToPixel(path[0], HEX_SIZE);

    // Ease in-out
    const t = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const totalSegments = path.length - 1;
    const pathT = t * totalSegments;
    const segIndex = Math.min(Math.floor(pathT), totalSegments - 1);
    const segT = pathT - segIndex;

    const from = hexToPixel(path[segIndex], HEX_SIZE);
    const to = hexToPixel(path[segIndex + 1], HEX_SIZE);

    return {
      x: from.x + (to.x - from.x) * segT,
      y: from.y + (to.y - from.y) * segT,
    };
  }
  private renderOrdnance(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (!state.ordnance || state.ordnance.length === 0) return;

    for (const ord of state.ordnance) {
      if (ord.destroyed) continue;

      let p: PixelCoord;
      // During animation, interpolate ordnance position along its path
      if (this.animState) {
        const om = this.animState.ordnanceMovements.find(m => m.ordnanceId === ord.id);
        if (om) {
          const progress = Math.min((now - this.animState.startTime) / this.animState.duration, 1);
          p = this.interpolatePath(om.path, progress);
        } else {
          p = hexToPixel(ord.position, HEX_SIZE);
        }
      } else {
        p = hexToPixel(ord.position, HEX_SIZE);
      }

      const color = getOrdnanceColor(ord.owner, this.playerId);
      const pulse = getOrdnancePulse(now);

      if (ord.type === 'nuke') {
        // Nuke: larger pulsing red diamond with glow
        const s = 6;
        const nukeColor = '#ff4444';
        ctx.fillStyle = nukeColor;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ff8888';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (ord.type === 'mine') {
        // Mine: small diamond shape
        const s = 4;
        ctx.fillStyle = color;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Torpedo: small triangle pointing in velocity direction
        const heading = getOrdnanceHeading(ord.position, ord.velocity, HEX_SIZE);
        const s = 5;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(heading);
        ctx.fillStyle = color;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(-s * 0.6, -s * 0.4);
        ctx.lineTo(-s * 0.6, s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // Velocity vector for ordnance (hide during animation)
      if (!this.animState && (ord.velocity.dq !== 0 || ord.velocity.dr !== 0)) {
        const dest = hexToPixel(hexAdd(ord.position, ord.velocity), HEX_SIZE);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(dest.x, dest.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Lifetime indicator (turns remaining until self-destruct)
      const lifetimeView = getOrdnanceLifetimeView(ord.turnsRemaining, this.animState !== null);
      if (lifetimeView) {
        ctx.fillStyle = lifetimeView.color;
        ctx.font = 'bold 6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(lifetimeView.text, p.x, p.y + 10);
      }
    }

    // During animation, also render ordnance that detonated (show until detonation point)
    if (this.animState) {
      const progress = Math.min((now - this.animState.startTime) / this.animState.duration, 1);
      for (const om of this.animState.ordnanceMovements) {
        if (!om.detonated) continue;
        const overlay = getDetonatedOrdnanceOverlay(progress);
        if (!overlay) continue;
        if (overlay.kind === 'diamond') {
          const p = this.interpolatePath(om.path, progress);
          ctx.fillStyle = overlay.color;
          ctx.globalAlpha = overlay.alpha;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - overlay.size);
          ctx.lineTo(p.x + overlay.size, p.y);
          ctx.lineTo(p.x, p.y + overlay.size);
          ctx.lineTo(p.x - overlay.size, p.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          const detP = hexToPixel(om.to, HEX_SIZE);
          ctx.fillStyle = overlay.color;
          ctx.globalAlpha = overlay.alpha;
          ctx.beginPath();
          ctx.arc(detP.x, detP.y, overlay.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  private renderTorpedoGuidance(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (state.phase !== 'ordnance' || state.activePlayer !== this.playerId) return;
    if (this.animState) return;

    const selectedId = this.planningState.selectedShipId;
    if (!selectedId) return;

    const ship = state.ships.find(s => s.id === selectedId);
    if (!ship || ship.destroyed || ship.landed) return;

    // Only show for warships (torpedo-capable)
    const stats = SHIP_STATS[ship.type];
    if (!stats?.canOverload) return;

    const shipPos = hexToPixel(ship.position, HEX_SIZE);
    const accel = this.planningState.torpedoAccel;
    const accelSteps = this.planningState.torpedoAccelSteps;

    // Show 6 direction arrows around the ship for torpedo terminal guidance
    for (let d = 0; d < 6; d++) {
      const targetHex = hexAdd(ship.position, HEX_DIRECTIONS[d]);
      const tp = hexToPixel(targetHex, HEX_SIZE);
      const isActive = accel === d;

      ctx.fillStyle = isActive ? 'rgba(255, 120, 60, 0.6)' : 'rgba(255, 120, 60, 0.12)';
      ctx.strokeStyle = isActive ? '#ff7744' : 'rgba(255, 120, 60, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Arrow from ship to target direction
      if (isActive) {
        ctx.strokeStyle = 'rgba(255, 120, 60, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(shipPos.x, shipPos.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 240, 200, 0.9)';
        ctx.font = '7px monospace';
        ctx.fillText(`x${accelSteps ?? 1}`, tp.x, tp.y + 2);
      }
    }

    // Label
    ctx.fillStyle = 'rgba(255, 120, 60, 0.8)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TORPEDO BOOST', shipPos.x, shipPos.y - 20);
  }

  private renderCombatOverlay(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (state.phase !== 'combat' || state.activePlayer !== this.playerId) return;
    if (this.animState) return;

    const pulse = 0.5 + 0.3 * Math.sin(now / 300);

    // Render queued attack lines (dimmer, dashed)
    for (const queued of getQueuedCombatOverlayAttacks(state, this.planningState.queuedAttacks)) {
      const targetPos = hexToPixel(queued.targetPosition, HEX_SIZE);
      for (const attackerPosition of queued.attackerPositions) {
        const attackerPos = hexToPixel(attackerPosition, HEX_SIZE);
        ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(attackerPos.x, attackerPos.y);
        ctx.lineTo(targetPos.x, targetPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Dim lock indicator on queued target
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(targetPos.x, targetPos.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Highlight valid enemy targets (only detected ones, not already queued)
    const highlights = getCombatOverlayHighlights(state, this.playerId, this.planningState, this.map);
    for (const ship of highlights.shipTargets) {
      const p = hexToPixel(ship.position, HEX_SIZE);
      ctx.strokeStyle = ship.isSelected
        ? `rgba(255, 80, 80, ${0.8 + pulse * 0.2})`
        : `rgba(255, 80, 80, ${0.2 + pulse * 0.15})`;
      ctx.lineWidth = ship.isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ship.isSelected ? 16 : 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const ordnance of highlights.ordnanceTargets) {
      const p = hexToPixel(ordnance.position, HEX_SIZE);
      ctx.strokeStyle = ordnance.isSelected
        ? `rgba(255, 210, 80, ${0.8 + pulse * 0.2})`
        : `rgba(255, 210, 80, ${0.2 + pulse * 0.15})`;
      ctx.lineWidth = ordnance.isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.rect(
        p.x - (ordnance.isSelected ? 10 : 8),
        p.y - (ordnance.isSelected ? 10 : 8),
        ordnance.isSelected ? 20 : 16,
        ordnance.isSelected ? 20 : 16,
      );
      ctx.stroke();
    }

    // Draw attack line and odds preview
    const preview = getCombatPreview(state, this.playerId, this.planningState, this.map);
    if (preview === null) return;

    const targetPos = hexToPixel(preview.targetPosition, HEX_SIZE);
    for (const attackerPosition of preview.attackerPositions) {
      const attackerPos = hexToPixel(attackerPosition, HEX_SIZE);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(attackerPos.x, attackerPos.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const attackerPosition of preview.attackerPositions) {
      const attackerPos = hexToPixel(attackerPosition, HEX_SIZE);
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(attackerPos.x, attackerPos.y);
      ctx.lineTo(targetPos.x, targetPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = 'bold 10px monospace';
    const textW = ctx.measureText(preview.label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(targetPos.x - textW / 2 - 4, targetPos.y - 32, textW + 8, 16);
    ctx.fillStyle = preview.totalMod > 0 ? '#88ff88' : preview.totalMod < 0 ? '#ff6666' : '#ffdd57';
    ctx.textAlign = 'center';
    ctx.fillText(preview.label, targetPos.x, targetPos.y - 20);

    if (preview.counterattackLabel) {
      ctx.fillStyle = 'rgba(255, 170, 0, 0.7)';
      ctx.font = '7px monospace';
      ctx.fillText(preview.counterattackLabel, targetPos.x, targetPos.y - 38);
    }
  }

  private renderHexFlashes(ctx: CanvasRenderingContext2D, now: number) {
    this.hexFlashes = this.hexFlashes.filter(f => now < f.startTime + f.duration);

    for (const flash of this.hexFlashes) {
      if (now < flash.startTime) continue;
      const progress = (now - flash.startTime) / flash.duration;
      const alpha = (1 - progress) * 0.6;
      const radius = HEX_SIZE * (0.5 + progress * 0.5);

      ctx.beginPath();
      ctx.arc(flash.position.x, flash.position.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = flash.color;
      ctx.globalAlpha = alpha * 0.3;
      ctx.fill();
      ctx.strokeStyle = flash.color;
      ctx.lineWidth = 2 * (1 - progress);
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private renderCombatEffects(ctx: CanvasRenderingContext2D, now: number) {
    // Clean up expired effects
    this.combatEffects = this.combatEffects.filter(e => now < e.startTime + e.duration);

    for (const effect of this.combatEffects) {
      if (now < effect.startTime) continue; // Not yet started
      const progress = (now - effect.startTime) / effect.duration;

      if (effect.type === 'beam') {
        // Beam line from attacker to target
        const beamAlpha = 1 - progress;
        const beamProgress = Math.min(progress * 3, 1); // Beam reaches target at 1/3 duration

        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = beamAlpha * 0.8;
        ctx.lineWidth = 2 * (1 - progress);
        ctx.beginPath();
        ctx.moveTo(effect.from.x, effect.from.y);
        ctx.lineTo(
          effect.from.x + (effect.to.x - effect.from.x) * beamProgress,
          effect.from.y + (effect.to.y - effect.from.y) * beamProgress,
        );
        ctx.stroke();

        // Glow line
        ctx.globalAlpha = beamAlpha * 0.3;
        ctx.lineWidth = 6 * (1 - progress);
        ctx.beginPath();
        ctx.moveTo(effect.from.x, effect.from.y);
        ctx.lineTo(
          effect.from.x + (effect.to.x - effect.from.x) * beamProgress,
          effect.from.y + (effect.to.y - effect.from.y) * beamProgress,
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (effect.type === 'explosion') {
        // Expanding ring explosion
        const maxRadius = 20;
        const radius = maxRadius * progress;
        const alpha = 1 - progress;

        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 3 * (1 - progress);
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.arc(effect.from.x, effect.from.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner flash
        if (progress < 0.3) {
          ctx.fillStyle = effect.color;
          ctx.globalAlpha = (1 - progress / 0.3) * 0.6;
          ctx.beginPath();
          ctx.arc(effect.from.x, effect.from.y, radius * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (effect.type === 'gameOverExplosion') {
        // Large dramatic multi-ring explosion for game-over
        const maxRadius = 50;
        const alpha = 1 - progress;

        // Outer expanding ring
        const outerRadius = maxRadius * progress;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 4 * (1 - progress);
        ctx.globalAlpha = alpha * 0.7;
        ctx.beginPath();
        ctx.arc(effect.from.x, effect.from.y, outerRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Second ring (slightly behind)
        if (progress > 0.1) {
          const innerProgress = (progress - 0.1) / 0.9;
          const innerRadius = maxRadius * 0.7 * innerProgress;
          ctx.lineWidth = 3 * (1 - innerProgress);
          ctx.globalAlpha = (1 - innerProgress) * 0.5;
          ctx.beginPath();
          ctx.arc(effect.from.x, effect.from.y, innerRadius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Bright core flash
        if (progress < 0.4) {
          const coreAlpha = (1 - progress / 0.4);
          const coreRadius = 15 * (1 - progress * 0.5);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = coreAlpha * 0.8;
          ctx.beginPath();
          ctx.arc(effect.from.x, effect.from.y, coreRadius, 0, Math.PI * 2);
          ctx.fill();

          // Colored glow around core
          ctx.fillStyle = effect.color;
          ctx.globalAlpha = coreAlpha * 0.4;
          ctx.beginPath();
          ctx.arc(effect.from.x, effect.from.y, coreRadius * 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Debris lines radiating outward
        if (progress > 0.05 && progress < 0.8) {
          const debrisAlpha = progress < 0.4 ? 1 : (0.8 - progress) / 0.4;
          ctx.strokeStyle = effect.color;
          ctx.globalAlpha = debrisAlpha * 0.6;
          ctx.lineWidth = 1.5;
          // Use position hash for deterministic but varied debris angles
          const seed = (effect.from.x * 7 + effect.from.y * 13) | 0;
          for (let d = 0; d < 8; d++) {
            const angle = (seed + d * 0.785) % (Math.PI * 2);
            const innerR = maxRadius * progress * 0.3;
            const outerR = maxRadius * progress * 0.7;
            ctx.beginPath();
            ctx.moveTo(
              effect.from.x + Math.cos(angle) * innerR,
              effect.from.y + Math.sin(angle) * innerR,
            );
            ctx.lineTo(
              effect.from.x + Math.cos(angle) * outerR,
              effect.from.y + Math.sin(angle) * outerR,
            );
            ctx.stroke();
          }
        }

        ctx.globalAlpha = 1;
      }
    }
  }

  private renderMovementEventsToast(ctx: CanvasRenderingContext2D, events: MovementEvent[], now: number, screenW: number) {
    if (events.length === 0) return;
    const alpha = getToastFadeAlpha(this.movementEvents!.showUntil, now);

    ctx.save();
    ctx.globalAlpha = alpha;

    let y = 60;
    for (const ev of events) {
      const ship = this.gameState?.ships.find(s => s.id === ev.shipId);
      const shipName = ship ? ship.type : ev.shipId;
      const line = formatMovementEventToast(ev, shipName);
      if (!line) continue;

      ctx.font = 'bold 12px monospace';
      const w = ctx.measureText(line.text).width;
      const x = screenW / 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, 20);
      ctx.fillStyle = line.color;
      ctx.textAlign = 'center';
      ctx.fillText(line.text, x, y + 2);
      y += 26;
    }

    ctx.restore();
  }

  private renderCombatResultsToast(ctx: CanvasRenderingContext2D, results: CombatResult[], now: number, screenW: number) {
    if (results.length === 0) return;
    const alpha = getToastFadeAlpha(this.combatResults!.showUntil, now);

    ctx.save();
    ctx.globalAlpha = alpha;

    let y = 60;
    for (const line of buildCombatResultToastLines(results, this.gameState!)) {
      const isSecondary = line.variant === 'secondary';
      ctx.font = isSecondary ? '11px monospace' : 'bold 12px monospace';
      const w = ctx.measureText(line.text).width;
      const x = screenW / 2;

      ctx.fillStyle = isSecondary ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, isSecondary ? 18 : 20);
      ctx.fillStyle = line.color;
      ctx.textAlign = 'center';
      ctx.fillText(line.text, x, y + 2);
      y += isSecondary ? 24 : 26;
    }

    ctx.restore();
  }

  // renderPhaseBanner removed — DOM overlay handles phase announcements

  private renderMinimap(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
    if (!this.map || !this.gameState) return;

    const layout = createMinimapLayout(this.map.bounds, screenW, screenH, HEX_SIZE);
    const { x: mmX, y: mmY, width: mmW, height: mmH } = layout;

    // Background
    ctx.save();
    ctx.fillStyle = 'rgba(10, 10, 26, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mmX, mmY, mmW, mmH, 4);
    ctx.fill();
    ctx.stroke();

    const toMinimap = (wx: number, wy: number) =>
      projectWorldToMinimap(layout, { x: wx, y: wy });

    // Draw celestial bodies
    for (const body of this.map.bodies) {
      const p = hexToPixel(body.center, HEX_SIZE);
      const mp = toMinimap(p.x, p.y);
      const r = Math.max(2, body.renderRadius * HEX_SIZE * layout.scale * 0.5);
      ctx.fillStyle = body.color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw ship trails on minimap
    for (const [shipId, trail] of this.shipTrails) {
      if (trail.length < 2) continue;
      const ship = this.gameState.ships.find(s => s.id === shipId);
      if (!ship) continue;
      if (ship.owner !== this.playerId && !ship.detected) continue;
      ctx.strokeStyle = ship.owner === this.playerId ? 'rgba(79, 195, 247, 0.3)' : 'rgba(255, 138, 101, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const p0 = hexToPixel(trail[0], HEX_SIZE);
      const mp0 = toMinimap(p0.x, p0.y);
      ctx.moveTo(mp0.x, mp0.y);
      for (let i = 1; i < trail.length; i++) {
        const pi = hexToPixel(trail[i], HEX_SIZE);
        const mpi = toMinimap(pi.x, pi.y);
        ctx.lineTo(mpi.x, mpi.y);
      }
      ctx.stroke();
    }

    // Draw ships as dots
    for (const ship of this.gameState.ships) {
      if (ship.destroyed) continue;
      // Skip undetected enemy ships
      if (ship.owner !== this.playerId && !ship.detected) continue;

      const p = hexToPixel(ship.position, HEX_SIZE);
      const mp = toMinimap(p.x, p.y);
      ctx.fillStyle = ship.owner === this.playerId ? '#4fc3f7' : '#ff8a65';
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw ordnance as tiny dots
    for (const ord of this.gameState.ordnance) {
      if (ord.destroyed) continue;
      const p = hexToPixel(ord.position, HEX_SIZE);
      const mp = toMinimap(p.x, p.y);
      ctx.fillStyle = ord.type === 'nuke' ? '#ff4444' : '#ffb74d';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw viewport rectangle
    const cam = this.camera;
    const vpHalfW = screenW / 2 / cam.zoom;
    const vpHalfH = screenH / 2 / cam.zoom;
    const vpTL = toMinimap(cam.x - vpHalfW, cam.y - vpHalfH);
    const vpBR = toMinimap(cam.x + vpHalfW, cam.y + vpHalfH);
    const vpW = vpBR.x - vpTL.x;
    const vpH = vpBR.y - vpTL.y;
    const viewport = clipViewportToMinimap(layout, {
      x: vpTL.x,
      y: vpTL.y,
      width: vpW,
      height: vpH,
    });

    if (viewport.width > 2 && viewport.height > 2) {
      ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    ctx.restore();
  }
}

// --- Utility ---

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}
