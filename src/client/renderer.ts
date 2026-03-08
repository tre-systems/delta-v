import {
  type HexCoord,
  type PixelCoord,
  type HexVec,
  hexToPixel,
  hexAdd,
  hexKey,
  HEX_DIRECTIONS,
  hexVecLength,
} from '../shared/hex';
import type { GameState, Ship, ShipMovement, SolarSystemMap, CelestialBody, CombatResult } from '../shared/types';
import { MOVEMENT_ANIM_DURATION, CAMERA_LERP_SPEED, SHIP_STATS } from '../shared/constants';
import { computeCourse, predictDestination } from '../shared/movement';
import { computeOdds, computeRangeMod, computeVelocityMod, getCombatStrength, canAttack } from '../shared/combat';

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
    const worldBefore = this.screenToWorld(sx, sy);
    this.targetZoom = newZoom;
    // Adjust target to keep the point under cursor stable
    const ratio = 1 - this.zoom / newZoom;
    this.targetX += (worldBefore.x - this.x) * ratio;
    this.targetY += (worldBefore.y - this.y) * ratio;
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
  startTime: number;
  duration: number;
  onComplete: () => void;
}

// --- Planning state (controlled by input handler) ---

export interface PlanningState {
  selectedShipId: string | null;
  burns: Map<string, number | null>; // shipId -> burn direction (or null for no burn)
  overloads: Map<string, number | null>; // shipId -> overload direction (warships only, 2 fuel total)
  weakGravityChoices: Map<string, Record<string, boolean>>; // shipId -> { hexKey: true to ignore }
  torpedoAccel: number | null; // direction for torpedo terminal guidance
  combatTargetId: string | null; // enemy ship targeted for combat
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
  planningState: PlanningState = { selectedShipId: null, burns: new Map(), overloads: new Map(), weakGravityChoices: new Map(), torpedoAccel: null, combatTargetId: null };
  private combatResults: { results: CombatResult[]; showUntil: number } | null = null;
  private lastTime = 0;

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

  animateMovements(movements: ShipMovement[], onComplete: () => void) {
    this.animState = {
      movements,
      startTime: performance.now(),
      duration: MOVEMENT_ANIM_DURATION,
      onComplete,
    };

    // Frame camera on all moving ships
    if (this.map && movements.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const m of movements) {
        for (const h of [m.from, m.to]) {
          const p = hexToPixel(h, HEX_SIZE);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      this.camera.frameBounds(minX, maxX, minY, maxY, 150);
    }
  }

  showCombatResults(results: CombatResult[]) {
    this.combatResults = { results, showUntil: performance.now() + 3000 };
  }

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
      this.renderGravityIndicators(ctx, this.map);
      this.renderBodies(ctx, this.map);
      this.renderBaseMarkers(ctx, this.map);
    }
    if (this.gameState && this.map) {
      this.renderCourseVectors(ctx, this.gameState, this.map, now);
      this.renderOrdnance(ctx, this.gameState, now);
      this.renderTorpedoGuidance(ctx, this.gameState, now);
      this.renderCombatOverlay(ctx, this.gameState, now);
      this.renderShips(ctx, this.gameState, now);
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

  private renderGravityIndicators(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    // Subtle radial lines pointing toward body for each gravity hex
    for (const [key, hex] of map.hexes) {
      if (!hex.gravity) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);
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

  private renderBodies(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    for (const body of map.bodies) {
      const p = hexToPixel(body.center, HEX_SIZE);
      const r = body.renderRadius * HEX_SIZE;

      // Glow
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 2);
      glow.addColorStop(0, body.color + '20');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
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
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(body.name, p.x, p.y + r + 14);
    }
  }

  private renderBaseMarkers(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    for (const [key, hex] of map.hexes) {
      if (!hex.base) continue;
      const [q, r] = key.split(',').map(Number);
      const p = hexToPixel({ q, r }, HEX_SIZE);

      ctx.fillStyle = '#66bb6a';
      ctx.strokeStyle = '#388e3c';
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
      if (predicted.q !== ship.position.q || predicted.r !== ship.position.r) {
        ctx.strokeStyle = ship.owner === this.playerId
          ? 'rgba(79, 195, 247, 0.3)'
          : 'rgba(255, 152, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
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
          const course = computeCourse(ship, burn, map, { overload, weakGravityChoices: wgChoices });
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

          // Ghost ship at destination
          if (!course.crashed) {
            this.drawShipIcon(ctx, to.x, to.y, ship.owner, 0.4, 0);
          }

          // Burn direction arrows (when selected)
          if (isSelected && ship.fuel > 0) {
            const predDest = ship.landed ? course.path[0] : predictDestination(ship);
            for (let d = 0; d < 6; d++) {
              const targetHex = hexAdd(predDest, HEX_DIRECTIONS[d]);
              const tp = hexToPixel(targetHex, HEX_SIZE);
              const isActive = burn === d;

              ctx.fillStyle = isActive ? 'rgba(79, 195, 247, 0.6)' : 'rgba(79, 195, 247, 0.15)';
              ctx.strokeStyle = isActive ? '#4fc3f7' : 'rgba(79, 195, 247, 0.3)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }

            // Overload direction arrows (shown after burn is set, for warships with enough fuel)
            if (burn !== null) {
              const stats = SHIP_STATS[ship.type];
              if (stats?.canOverload && ship.fuel >= 2) {
                const burnDest = hexAdd(predDest, HEX_DIRECTIONS[burn]);
                for (let d = 0; d < 6; d++) {
                  const olHex = hexAdd(burnDest, HEX_DIRECTIONS[d]);
                  const olp = hexToPixel(olHex, HEX_SIZE);
                  const isOlActive = overload === d;

                  ctx.fillStyle = isOlActive ? 'rgba(255, 183, 77, 0.6)' : 'rgba(255, 183, 77, 0.1)';
                  ctx.strokeStyle = isOlActive ? '#ffb74d' : 'rgba(255, 183, 77, 0.25)';
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.arc(olp.x, olp.y, 6, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                }
              }
            }
          }

          // Weak gravity toggle indicators on the path
          if (isSelected) {
            for (const grav of course.gravityEffects) {
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

  private renderShips(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    // Filter visible ships (own ships + detected enemy ships)
    const visibleShips = state.ships.filter(s => {
      if (s.destroyed && !this.animState) return false;
      if (s.owner === this.playerId) return true;
      return s.detected;
    });

    // Count ships at each hex for stacking offset
    const hexCounts = new Map<string, number>();
    const hexIndices = new Map<string, number>();
    for (const ship of visibleShips) {
      const key = hexKey(ship.position);
      hexCounts.set(key, (hexCounts.get(key) ?? 0) + 1);
    }

    for (const ship of visibleShips) {
      let pos: PixelCoord;
      let velocity = ship.velocity;

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
      if (!this.animState) {
        const key = hexKey(ship.position);
        const count = hexCounts.get(key) ?? 1;
        if (count > 1) {
          const idx = hexIndices.get(key) ?? 0;
          hexIndices.set(key, idx + 1);
          const offset = (idx - (count - 1) / 2) * 14;
          pos = { x: pos.x + offset, y: pos.y };
        }
      }

      // Ship heading based on velocity
      const speed = hexVecLength(velocity);
      const heading = speed > 0
        ? Math.atan2(
            hexToPixel(hexAdd(ship.position, velocity), HEX_SIZE).y - hexToPixel(ship.position, HEX_SIZE).y,
            hexToPixel(hexAdd(ship.position, velocity), HEX_SIZE).x - hexToPixel(ship.position, HEX_SIZE).x,
          )
        : 0;

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
      const alpha = ship.damage.disabledTurns > 0 ? 0.5 : 1.0;
      this.drawShipIcon(ctx, pos.x, pos.y, ship.owner, alpha, heading);

      // Fuel indicator
      if (ship.owner === this.playerId && !this.animState) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`F:${ship.fuel}`, pos.x, pos.y + 18);
      }
    }
  }

  private drawShipIcon(ctx: CanvasRenderingContext2D, x: number, y: number, owner: number, alpha: number, heading: number) {
    const color = owner === 0 ? `rgba(79, 195, 247, ${alpha})` : `rgba(255, 152, 0, ${alpha})`;
    const size = 8;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size, 0);          // Nose
    ctx.lineTo(-size * 0.6, -size * 0.5);  // Top wing
    ctx.lineTo(-size * 0.3, 0);   // Indent
    ctx.lineTo(-size * 0.6, size * 0.5);   // Bottom wing
    ctx.closePath();
    ctx.fill();
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
      const p = hexToPixel(ord.position, HEX_SIZE);
      const color = ord.owner === this.playerId ? '#4fc3f7' : '#ff9800';
      const pulse = 0.6 + 0.3 * Math.sin(now / 400);

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
        const heading = Math.atan2(
          hexToPixel(hexAdd(ord.position, ord.velocity), HEX_SIZE).y - p.y,
          hexToPixel(hexAdd(ord.position, ord.velocity), HEX_SIZE).x - p.x,
        );
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

      // Velocity vector for ordnance
      if (ord.velocity.dq !== 0 || ord.velocity.dr !== 0) {
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
      }
    }

    // Label
    ctx.fillStyle = 'rgba(255, 120, 60, 0.8)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GUIDANCE', shipPos.x, shipPos.y - 20);
  }

  private renderCombatOverlay(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    if (state.phase !== 'combat' || state.activePlayer !== this.playerId) return;
    if (this.animState) return;

    const targetId = this.planningState.combatTargetId;
    const target = targetId ? state.ships.find(s => s.id === targetId) : null;

    // Highlight valid enemy targets (only detected ones)
    for (const ship of state.ships) {
      if (ship.owner === this.playerId || ship.destroyed || !ship.detected) continue;
      const p = hexToPixel(ship.position, HEX_SIZE);
      const isTarget = ship.id === targetId;

      // Pulsing ring on enemies
      const pulse = 0.5 + 0.3 * Math.sin(now / 300);
      ctx.strokeStyle = isTarget
        ? `rgba(255, 80, 80, ${0.8 + pulse * 0.2})`
        : `rgba(255, 80, 80, ${0.2 + pulse * 0.15})`;
      ctx.lineWidth = isTarget ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isTarget ? 16 : 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw attack line and odds preview
    if (target && !target.destroyed) {
      const myAttackers = state.ships.filter(
        s => s.owner === this.playerId && !s.destroyed && canAttack(s),
      );
      if (myAttackers.length === 0) return;

      const targetPos = hexToPixel(target.position, HEX_SIZE);

      // Attack lines from each attacker
      for (const attacker of myAttackers) {
        const attackerPos = hexToPixel(attacker.position, HEX_SIZE);
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(attackerPos.x, attackerPos.y);
        ctx.lineTo(targetPos.x, targetPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Odds preview at target
      const attackStr = getCombatStrength(myAttackers);
      const defendStr = getCombatStrength([target]);
      const odds = computeOdds(attackStr, defendStr);
      const rangeMod = computeRangeMod(myAttackers[0], target);
      const velMod = computeVelocityMod(myAttackers[0], target);

      // Background box
      const label = `${odds}  R-${rangeMod} V-${velMod}`;
      ctx.font = 'bold 10px monospace';
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(targetPos.x - textW / 2 - 4, targetPos.y - 32, textW + 8, 16);
      ctx.fillStyle = '#ff6666';
      ctx.textAlign = 'center';
      ctx.fillText(label, targetPos.x, targetPos.y - 20);
    }
  }

  private renderCombatResultsToast(ctx: CanvasRenderingContext2D, results: CombatResult[], now: number, screenW: number) {
    if (results.length === 0) return;
    const fadeStart = this.combatResults!.showUntil - 1000;
    const alpha = now > fadeStart ? Math.max(0, (this.combatResults!.showUntil - now) / 1000) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    let y = 60;
    for (const r of results) {
      const text = formatCombatResult(r, this.gameState!);
      ctx.font = 'bold 12px monospace';
      const w = ctx.measureText(text).width;
      const x = screenW / 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, 20);
      ctx.fillStyle = r.damageType === 'eliminated' ? '#ff4444'
        : r.damageType === 'disabled' ? '#ffaa00'
        : '#88ff88';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y + 2);
      y += 26;

      if (r.counterattack) {
        const cText = formatCombatResult(r.counterattack, this.gameState!);
        ctx.font = '11px monospace';
        const cw = ctx.measureText(cText).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(x - cw / 2 - 8, y - 12, cw + 16, 18);
        ctx.fillStyle = r.counterattack.damageType === 'eliminated' ? '#ff4444'
          : r.counterattack.damageType === 'disabled' ? '#ffaa00'
          : '#88ff88';
        ctx.fillText(cText, x, y + 2);
        y += 24;
      }
    }

    ctx.restore();
  }
}

function formatCombatResult(r: CombatResult, state: GameState): string {
  const targetShip = state.ships.find(s => s.id === r.targetId);
  const targetName = targetShip ? `${targetShip.type}` : r.targetId;
  const result = r.damageType === 'eliminated' ? 'ELIMINATED'
    : r.damageType === 'disabled' ? `DISABLED ${r.disabledTurns}T`
    : 'MISS';
  return `${r.odds} [${r.dieRoll}→${r.modifiedRoll}] ${targetName}: ${result}`;
}

// --- Utility ---

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}
