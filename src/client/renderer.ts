import {
  type HexCoord,
  type PixelCoord,
  hexToPixel,
  hexAdd,
  hexKey,
  hexEqual,
  HEX_DIRECTIONS,
  hexVecLength,
} from '../shared/hex';
import type { GameState, Ship, ShipMovement, OrdnanceMovement, MovementEvent, SolarSystemMap, CombatResult, CombatAttack } from '../shared/types';
import { MOVEMENT_ANIM_DURATION, SHIP_STATS } from '../shared/constants';
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
  buildAsteroidDebrisView,
  buildBaseMarkerView,
  buildBodyView,
  buildLandingObjectiveView,
  buildMapBorderView,
} from './renderer-map';
import { buildMinimapSceneView } from './renderer-minimap';
import {
  buildDetectionRangeViews,
  buildMovementPathViews,
  buildOrdnanceTrailViews,
  buildShipTrailViews,
  buildVelocityVectorViews,
} from './renderer-vectors';
import { buildAstrogationCoursePreviewViews } from './renderer-course';
import {
  createMinimapLayout,
} from './game-client-minimap';
import { Camera } from './renderer-camera';
import {
  drawCombatEffects, drawHexFlashes,
  type CombatEffect, type HexFlash,
} from './renderer-effects';
import {
  drawShipIcon as drawShipIconFn,
  drawThrustTrail as drawThrustTrailFn,
  interpolatePath as interpolatePathFn,
  drawOrdnanceVelocity,
} from './renderer-draw';

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

// CombatEffect and HexFlash types imported from renderer-effects.ts

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
      const view = buildBodyView(body, HEX_SIZE, now);
      const p = view.center;
      const r = view.radius;

      // Atmospheric/Gravity Ripples
      for (const ripple of view.ripples) {
        ctx.strokeStyle = body.color;
        ctx.globalAlpha = ripple.alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Primary Glow
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3);
      glow.addColorStop(0, view.glowStops[0]);
      glow.addColorStop(0.4, view.glowStops[1]);
      glow.addColorStop(1, view.glowStops[2]);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
      ctx.fill();

      // Body disc
      const grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
      grad.addColorStop(0, view.coreColor);
      grad.addColorStop(1, view.edgeColor);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '600 11px var(--font-display), sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(view.label, p.x, view.labelY);
    }
  }

  private renderBaseMarkers(ctx: CanvasRenderingContext2D, map: SolarSystemMap, state: GameState | null) {
    for (const [key, hex] of map.hexes) {
      if (!hex.base) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
      const markerView = buildBaseMarkerView(key, state, this.playerId);
      if (markerView.kind === 'destroyed') {
        ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)';
        ctx.lineWidth = markerView.lineWidth;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 5);
        ctx.moveTo(p.x + 5, p.y - 5);
        ctx.lineTo(p.x - 5, p.y + 5);
        ctx.stroke();
        continue;
      }

      ctx.fillStyle = markerView.fillStyle!;
      ctx.strokeStyle = markerView.strokeStyle;
      ctx.lineWidth = markerView.lineWidth;

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
    const borderView = buildMapBorderView(
      map.bounds,
      Boolean(state.players[this.playerId]?.escapeWins),
      now,
      HEX_SIZE,
    );
    ctx.strokeStyle = borderView.strokeStyle;
    ctx.lineWidth = borderView.lineWidth;
    ctx.setLineDash(borderView.lineDash);
    ctx.strokeRect(borderView.topLeft.x, borderView.topLeft.y, borderView.width, borderView.height);
    ctx.setLineDash([]);
  }

  private renderAsteroids(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    const destroyed = new Set(this.gameState?.destroyedAsteroids ?? []);
    for (const [key, hex] of map.hexes) {
      if (hex.terrain !== 'asteroid') continue;
      if (destroyed.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      const debrisView = buildAsteroidDebrisView({ q, r }, HEX_SIZE);
      if (!this.camera.isVisible(debrisView.center.x, debrisView.center.y)) continue;

      // Small scattered dots to suggest asteroid debris
      ctx.fillStyle = 'rgba(160, 140, 120, 0.35)';
      for (const particle of debrisView.particles) {
        ctx.beginPath();
        ctx.arc(
          debrisView.center.x + particle.xOffset,
          debrisView.center.y + particle.yOffset,
          particle.size,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  private renderLandingTarget(ctx: CanvasRenderingContext2D, map: SolarSystemMap, state: GameState, now: number) {
    const objectiveView = buildLandingObjectiveView(state.players[this.playerId], map, now, HEX_SIZE);
    if (!objectiveView) return;
    if (objectiveView.kind === 'escape') {
      ctx.fillStyle = objectiveView.color;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      for (const marker of objectiveView.markers) {
        ctx.fillText(marker.text, marker.position.x, marker.position.y);
      }
      return;
    }

    ctx.strokeStyle = objectiveView.strokeStyle;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(objectiveView.center.x, objectiveView.center.y, objectiveView.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = objectiveView.labelStyle;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(objectiveView.labelText, objectiveView.center.x, objectiveView.labelY);
  }

  private renderDetectionRanges(ctx: CanvasRenderingContext2D, state: GameState, map: SolarSystemMap) {
    if (this.animState) return;
    const overlays = buildDetectionRangeViews(
      state,
      this.playerId,
      this.planningState.selectedShipId,
      map,
      HEX_SIZE,
    );
    for (const overlay of overlays) {
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = overlay.lineWidth;
      ctx.setLineDash(overlay.lineDash);
      ctx.beginPath();
      ctx.arc(overlay.center.x, overlay.center.y, overlay.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private renderCourseVectors(ctx: CanvasRenderingContext2D, state: GameState, map: SolarSystemMap, now: number) {
    // During animation, don't show planning vectors
    if (this.animState) return;

    for (const vector of buildVelocityVectorViews(state, this.playerId, HEX_SIZE)) {
      ctx.strokeStyle = vector.color;
      ctx.lineWidth = vector.lineWidth;
      ctx.setLineDash(vector.lineDash);
      ctx.beginPath();
      ctx.moveTo(vector.from.x, vector.from.y);
      ctx.lineTo(vector.to.x, vector.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (vector.speedLabel) {
        ctx.fillStyle = vector.speedLabel.color;
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(vector.speedLabel.text, vector.speedLabel.position.x, vector.speedLabel.position.y);
      }
    }

    for (const preview of buildAstrogationCoursePreviewViews(
      state,
      this.playerId,
      this.planningState,
      map,
      HEX_SIZE,
    )) {
      ctx.strokeStyle = preview.lineColor;
      ctx.lineWidth = preview.lineWidth;
      ctx.setLineDash(preview.lineDash);
      ctx.beginPath();
      ctx.moveTo(preview.linePoints[0].x, preview.linePoints[0].y);
      for (let i = 1; i < preview.linePoints.length; i++) {
        ctx.lineTo(preview.linePoints[i].x, preview.linePoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (const arrow of preview.gravityArrows) {
        ctx.strokeStyle = arrow.color;
        ctx.lineWidth = arrow.lineWidth;
        ctx.beginPath();
        ctx.moveTo(arrow.from.x, arrow.from.y);
        ctx.lineTo(arrow.to.x, arrow.to.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(arrow.to.x, arrow.to.y);
        ctx.lineTo(arrow.headLeft.x, arrow.headLeft.y);
        ctx.moveTo(arrow.to.x, arrow.to.y);
        ctx.lineTo(arrow.headRight.x, arrow.headRight.y);
        ctx.stroke();
      }

      if (preview.ghostShip) {
        this.drawShipIcon(
          ctx,
          preview.ghostShip.position.x,
          preview.ghostShip.position.y,
          preview.ghostShip.owner,
          preview.ghostShip.alpha,
          0,
          0,
          preview.ghostShip.shipType,
        );
      }

      for (const marker of [...preview.burnMarkers, ...preview.overloadMarkers]) {
        if (marker.shadowBlur > 0 && marker.shadowColor) {
          ctx.shadowBlur = marker.shadowBlur;
          ctx.shadowColor = marker.shadowColor;
        }
        ctx.fillStyle = marker.fillColor;
        ctx.strokeStyle = marker.strokeColor;
        ctx.lineWidth = marker.lineWidth;
        ctx.beginPath();
        ctx.arc(marker.position.x, marker.position.y, marker.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      for (const marker of preview.weakGravityMarkers) {
        ctx.strokeStyle = marker.strokeColor;
        ctx.fillStyle = marker.fillColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(marker.position.x, marker.position.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = marker.labelColor;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('G', marker.position.x, marker.position.y + 3);
        if (marker.strikeFrom && marker.strikeTo) {
          ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(marker.strikeFrom.x, marker.strikeFrom.y);
          ctx.lineTo(marker.strikeTo.x, marker.strikeTo.y);
          ctx.stroke();
        }
      }

      if (preview.fuelCostLabel) {
        ctx.fillStyle = preview.fuelCostLabel.color;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          preview.fuelCostLabel.text,
          preview.fuelCostLabel.position.x,
          preview.fuelCostLabel.position.y,
        );
      }
    }
  }

  private renderTrails(ctx: CanvasRenderingContext2D, state: GameState) {
    for (const trail of buildShipTrailViews(state, this.playerId, this.shipTrails, HEX_SIZE)) {
      ctx.strokeStyle = trail.lineColor;
      ctx.lineWidth = trail.lineWidth;
      ctx.setLineDash(trail.lineDash);
      ctx.beginPath();
      ctx.moveTo(trail.points[0].x, trail.points[0].y);
      for (let i = 1; i < trail.points.length; i++) {
        ctx.lineTo(trail.points[i].x, trail.points[i].y);
      }
      ctx.stroke();

      if (trail.waypointColor) {
        for (const point of trail.points) {
          if (!this.camera.isVisible(point.x, point.y)) continue;
          ctx.fillStyle = trail.waypointColor;
          ctx.beginPath();
          ctx.arc(point.x, point.y, trail.waypointRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    for (const trail of buildOrdnanceTrailViews(state, this.playerId, this.ordnanceTrails, HEX_SIZE)) {
      ctx.strokeStyle = trail.lineColor;
      ctx.lineWidth = trail.lineWidth;
      ctx.setLineDash(trail.lineDash);
      ctx.beginPath();
      ctx.moveTo(trail.points[0].x, trail.points[0].y);
      for (let i = 1; i < trail.points.length; i++) {
        ctx.lineTo(trail.points[i].x, trail.points[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private renderMovementPaths(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (!this.animState) return;

    const progress = Math.min((now - this.animState.startTime) / this.animState.duration, 1);
    for (const pathView of buildMovementPathViews(state, this.playerId, this.animState.movements, progress, HEX_SIZE)) {
      ctx.strokeStyle = pathView.color;
      ctx.lineWidth = pathView.lineWidth;
      ctx.setLineDash(pathView.lineDash);
      ctx.beginPath();
      ctx.moveTo(pathView.points[0].x, pathView.points[0].y);
      for (let i = 1; i < pathView.points.length; i++) {
        ctx.lineTo(pathView.points[i].x, pathView.points[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (const waypoint of pathView.passedWaypoints) {
        ctx.fillStyle = pathView.color;
        ctx.beginPath();
        ctx.arc(waypoint.x, waypoint.y, pathView.waypointRadius, 0, Math.PI * 2);
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
    drawShipIconFn(ctx, x, y, owner, alpha, heading, disabledTurns, shipType);
  }

  private drawThrustTrail(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, progress: number) {
    drawThrustTrailFn(ctx, x, y, angle, progress);
  }

  private interpolatePath(path: HexCoord[], progress: number): PixelCoord {
    return interpolatePathFn(path, progress, HEX_SIZE);
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
      if (!this.animState) {
        drawOrdnanceVelocity(ctx, ord.position, ord.velocity, p, color, HEX_SIZE);
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
    this.hexFlashes = drawHexFlashes(ctx, this.hexFlashes, now, HEX_SIZE);
  }

  private renderCombatEffects(ctx: CanvasRenderingContext2D, now: number) {
    this.combatEffects = drawCombatEffects(ctx, this.combatEffects, now);
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

    const scene = buildMinimapSceneView(
      this.map,
      this.gameState,
      this.playerId,
      this.shipTrails,
      layout,
      this.camera,
      screenW,
      screenH,
      HEX_SIZE,
    );

    for (const body of scene.bodies) {
      ctx.fillStyle = body.color;
      ctx.globalAlpha = body.alpha;
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, body.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const trail of scene.shipTrails) {
      if (trail.points.length < 2) continue;
      ctx.strokeStyle = trail.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(trail.points[0].x, trail.points[0].y);
      for (let i = 1; i < trail.points.length; i++) {
        ctx.lineTo(trail.points[i].x, trail.points[i].y);
      }
      ctx.stroke();
    }

    for (const ship of scene.ships) {
      ctx.fillStyle = ship.color;
      ctx.globalAlpha = ship.alpha;
      ctx.beginPath();
      ctx.arc(ship.position.x, ship.position.y, ship.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const ordnance of scene.ordnance) {
      ctx.fillStyle = ordnance.color;
      ctx.globalAlpha = ordnance.alpha;
      ctx.beginPath();
      ctx.arc(ordnance.position.x, ordnance.position.y, ordnance.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (scene.viewport) {
      ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
      ctx.fillRect(scene.viewport.x, scene.viewport.y, scene.viewport.width, scene.viewport.height);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(scene.viewport.x, scene.viewport.y, scene.viewport.width, scene.viewport.height);
    }

    ctx.restore();
  }
}
