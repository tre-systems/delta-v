import { must } from '../../shared/assert';
import { MOVEMENT_ANIM_DURATION } from '../../shared/constants';
import {
  type HexCoord,
  hexKey,
  hexToPixel,
  type PixelCoord,
  parseHexKey,
} from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import { createMinimapLayout } from '../game/minimap';
// CombatEffect and HexFlash types imported from
// renderer-effects.ts
// PlanningState is owned by GameClient, passed in as
// a reference
import type { PlanningState } from '../game/planning';
import {
  type AnimationState,
  collectAnimatedHexes,
  createMovementAnimationManager,
} from './animation-manager';
import { Camera } from './camera';
import { getCombatTargetEntity } from './combat';
import { buildAstrogationCoursePreviewViews } from './course';
import {
  drawShipIcon as drawShipIconFn,
  drawThrustTrail as drawThrustTrailFn,
  interpolatePath as interpolatePathFn,
} from './draw';
import {
  type CombatEffect,
  drawCombatEffects,
  drawHexFlashes,
  type HexFlash,
} from './effects';
import {
  buildShipLabelView,
  getDisabledShipLabel,
  getShipHeading,
  getShipIconAlpha,
  getShipIdentityMarker,
  getShipStackOffsets,
  getVisibleShips,
  shouldShowLandedIndicator,
  shouldShowOrbitIndicator,
} from './entities';
import { buildMinimapSceneView } from './minimap';
import {
  renderCombatOverlay as renderCombatOverlayFn,
  renderOrdnance as renderOrdnanceFn,
  renderTorpedoGuidance as renderTorpedoGuidanceFn,
} from './overlay';
import {
  generateStars,
  renderAsteroids as renderAsteroidsFn,
  renderBaseMarkers as renderBaseMarkersFn,
  renderBodies as renderBodiesFn,
  renderDetectionRanges as renderDetectionRangesFn,
  renderGravityIndicators as renderGravityIndicatorsFn,
  renderHexGrid as renderHexGridFn,
  renderLandingTarget as renderLandingTargetFn,
  renderMapBorder as renderMapBorderFn,
  renderStars as renderStarsFn,
  type Star,
} from './scene';
import {
  buildCombatResultToastLines,
  formatMovementEventToast,
  getToastFadeAlpha,
} from './toast';
import {
  buildBaseThreatZoneViews,
  buildMovementPathViews,
  buildOrdnanceTrailViews,
  buildShipTrailViews,
  buildVelocityVectorViews,
} from './vectors';
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
  private planningState: PlanningState;
  private combatResults: {
    results: CombatResult[];
    showUntil: number;
  } | null = null;
  private combatEffects: CombatEffect[] = [];
  private hexFlashes: HexFlash[] = [];
  private movementEvents: {
    events: MovementEvent[];
    showUntil: number;
  } | null = null;
  // Phase banner removed — DOM phase alert in ui.ts
  // is the sole overlay
  private lastTime = 0;
  private readonly movementAnimation = createMovementAnimationManager();

  private get animState(): AnimationState | null {
    return this.movementAnimation.getAnimationState();
  }

  private get shipTrails(): Map<string, HexCoord[]> {
    return this.movementAnimation.getShipTrails();
  }

  private get ordnanceTrails(): Map<string, HexCoord[]> {
    return this.movementAnimation.getOrdnanceTrails();
  }

  constructor(canvas: HTMLCanvasElement, planningState: PlanningState) {
    this.canvas = canvas;
    this.ctx = must(canvas.getContext('2d'));
    this.camera = new Camera();
    this.planningState = planningState;
    this.stars = generateStars(600, 2000);
    // Complete stale animations when visibility
    // changes. When hidden: rAF stops and setTimeout
    // may be fully suspended, so skip the animation
    // immediately. When visible again: catch any that
    // slipped through.
    document.addEventListener('visibilitychange', () => {
      this.movementAnimation.handleVisibilityChange(
        document.visibilityState,
        performance.now(),
      );
    });
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
    this.movementAnimation.clearTrails();
  }
  animateMovements(
    movements: ShipMovement[],
    ordnanceMovements: OrdnanceMovement[],
    onComplete: () => void,
  ) {
    this.movementAnimation.start(movements, ordnanceMovements, onComplete);
    // Frame camera on all moving ships and ordnance
    const allHexes = collectAnimatedHexes(movements, ordnanceMovements);
    if (this.map && allHexes.length > 0) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
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
    this.combatResults = {
      results,
      showUntil: now + 3000,
    };
    // Create visual effects for each combat result
    for (const r of results) {
      const target = getCombatTargetEntity(
        r,
        this.gameState,
        previousState ?? null,
      );
      if (!target) continue;
      const targetPos = hexToPixel(target.position, HEX_SIZE);
      // Beam from attacker(s) to target
      if (r.attackerIds.length > 0) {
        const firstId = r.attackerIds[0];
        let attackerPos: PixelCoord | null = null;
        if (firstId.startsWith('base:')) {
          const baseRef = firstId.slice(5);
          if (baseRef.includes(',')) {
            attackerPos = hexToPixel(parseHexKey(baseRef), HEX_SIZE);
          } else if (this.map) {
            // Backward-compatible fallback for older
            // replays/messages
            const baseEntry = [...this.map.hexes.entries()].find(
              ([, hex]) => hex.base?.bodyName === baseRef,
            );
            if (baseEntry) {
              attackerPos = hexToPixel(parseHexKey(baseEntry[0]), HEX_SIZE);
            }
          }
        } else {
          const attacker = this.gameState?.ships.find((s) => s.id === firstId);
          if (attacker) {
            attackerPos = hexToPixel(attacker.position, HEX_SIZE);
          }
        }
        if (attackerPos && r.attackType !== 'asteroidHazard') {
          const beamColor = firstId.startsWith('base:')
            ? '#66bb6a'
            : r.damageType === 'eliminated'
              ? '#ff4444'
              : r.damageType === 'disabled'
                ? '#ffaa00'
                : '#4fc3f7';
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
          startTime: now + 300,
          duration: 800,
          color: r.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
        });
      }
      // Same for counterattack
      if (r.counterattack && r.counterattack.damageType !== 'none') {
        const counterTarget = this.gameState?.ships.find(
          (s) => s.id === r.counterattack?.targetId,
        );
        if (counterTarget) {
          const counterPos = hexToPixel(counterTarget.position, HEX_SIZE);
          this.combatEffects.push({
            type: 'beam',
            from: targetPos,
            to: counterPos,
            startTime: now + 500,
            duration: 600,
            color:
              r.counterattack.damageType === 'eliminated'
                ? '#ff4444'
                : '#ffaa00',
          });
          this.combatEffects.push({
            type: 'explosion',
            from: counterPos,
            to: counterPos,
            startTime: now + 800,
            duration: 800,
            color:
              r.counterattack.damageType === 'eliminated'
                ? '#ff4444'
                : '#ffaa00',
          });
        }
      }
    }
  }
  showMovementEvents(events: MovementEvent[]) {
    if (events.length > 0) {
      const now = performance.now();
      this.movementEvents = {
        events,
        showUntil: now + 4000,
      };
      // Create hex flashes at event locations
      for (const ev of events) {
        const p = hexToPixel(ev.hex, HEX_SIZE);
        const color =
          ev.type === 'crash'
            ? '#ff4444'
            : ev.type === 'nukeDetonation'
              ? '#ff6600'
              : ev.damageType === 'eliminated'
                ? '#ff4444'
                : '#ffaa00';
        this.hexFlashes.push({
          position: p,
          startTime: now + MOVEMENT_ANIM_DURATION * 0.8,
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
   * Trigger dramatic staggered explosions on the
   * losing player's ships.
   * Returns the total animation duration in ms.
   */
  triggerGameOverExplosions(ships: Ship[]): number {
    const now = performance.now();
    const stagger = 250;
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
    return ships.length * stagger + 1500;
  }
  // showPhaseBanner removed — DOM phase alert in
  // ui.ts is the sole overlay
  isAnimating(): boolean {
    return this.movementAnimation.isAnimating();
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
    const myShips = this.gameState.ships.filter(
      (s) => s.owner === this.playerId && s.lifecycle !== 'destroyed',
    );
    if (myShips.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const s of myShips) {
      const p = hexToPixel(s.position, HEX_SIZE);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    this.camera.frameBounds(minX, maxX, minY, maxY, 200);
    // Clamp zoom so hex grid is visible but enough
    // context is shown for orientation
    const MIN_FRAME_ZOOM = 0.6;
    const MAX_FRAME_ZOOM = 1.8;
    this.camera.targetZoom = Math.max(
      MIN_FRAME_ZOOM,
      Math.min(MAX_FRAME_ZOOM, this.camera.targetZoom),
    );
  }
  start() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }
  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth);
    const h = Math.round(this.canvas.clientHeight);

    if (w <= 0 || h <= 0) {
      return;
    }

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  private loop(now: number) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    const cw = Math.round(this.canvas.clientWidth);
    const ch = Math.round(this.canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;

    if (
      cw > 0 &&
      ch > 0 &&
      (this.canvas.width !== Math.round(cw * dpr) ||
        this.canvas.height !== Math.round(ch * dpr))
    ) {
      this.resize();
    }

    this.camera.update(dt, cw, ch);
    this.render(now, cw, ch);
    this.movementAnimation.completeIfElapsed(now);
    requestAnimationFrame((t) => this.loop(t));
  }
  private render(
    now: number,
    w = this.canvas.clientWidth,
    h = this.canvas.clientHeight,
  ) {
    const ctx = this.ctx;
    // Clear
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    this.camera.applyTransform(ctx);
    this.renderStars(ctx);
    if (this.map) {
      this.renderHexGrid(ctx, this.map);
      if (this.gameState) {
        this.renderMapBorder(ctx, this.map, this.gameState, now);
      }
      this.renderAsteroids(ctx, this.map);
      this.renderGravityIndicators(ctx, this.map);
      this.renderBodies(ctx, now, this.map);
      this.renderBaseMarkers(ctx, this.map, this.gameState);
      if (this.gameState) {
        this.renderLandingTarget(ctx, this.map, this.gameState, now);
      }
    }
    if (this.gameState && this.map) {
      this.renderBaseThreatZones(ctx, this.gameState, this.map);
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
    renderStarsFn(ctx, this.stars, this.camera.zoom);
  }
  private renderHexGrid(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    renderHexGridFn(ctx, map, HEX_SIZE, (x, y) => this.camera.isVisible(x, y));
  }
  private renderGravityIndicators(
    ctx: CanvasRenderingContext2D,
    map: SolarSystemMap,
  ) {
    renderGravityIndicatorsFn(ctx, map, HEX_SIZE, (x, y) =>
      this.camera.isVisible(x, y),
    );
  }
  private renderBodies(
    ctx: CanvasRenderingContext2D,
    now: number,
    map: SolarSystemMap,
  ) {
    renderBodiesFn(ctx, map, HEX_SIZE, now);
  }
  private renderBaseMarkers(
    ctx: CanvasRenderingContext2D,
    map: SolarSystemMap,
    state: GameState | null,
  ) {
    renderBaseMarkersFn(ctx, map, state, this.playerId, HEX_SIZE);
  }
  private renderMapBorder(
    ctx: CanvasRenderingContext2D,
    map: SolarSystemMap,
    state: GameState,
    now: number,
  ) {
    renderMapBorderFn(ctx, map, state, this.playerId, HEX_SIZE, now);
  }
  private renderAsteroids(ctx: CanvasRenderingContext2D, map: SolarSystemMap) {
    renderAsteroidsFn(
      ctx,
      map,
      this.gameState?.destroyedAsteroids ?? [],
      HEX_SIZE,
      (x, y) => this.camera.isVisible(x, y),
    );
  }
  private renderLandingTarget(
    ctx: CanvasRenderingContext2D,
    map: SolarSystemMap,
    state: GameState,
    now: number,
  ) {
    renderLandingTargetFn(ctx, map, state, this.playerId, HEX_SIZE, now);
  }
  private renderBaseThreatZones(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    map: SolarSystemMap,
  ) {
    if (this.animState) return;
    const zones = buildBaseThreatZoneViews(state, this.playerId, map, HEX_SIZE);
    for (const zone of zones) {
      ctx.fillStyle = 'rgba(255, 80, 60, 0.08)';
      ctx.strokeStyle = 'rgba(255, 80, 60, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(zone.hexCenter.x, zone.hexCenter.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  private renderDetectionRanges(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    map: SolarSystemMap,
  ) {
    renderDetectionRangesFn(
      ctx,
      state,
      this.playerId,
      this.planningState.selectedShipId,
      map,
      HEX_SIZE,
      this.animState !== null,
    );
  }
  private renderCourseVectors(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    map: SolarSystemMap,
    _now: number,
  ) {
    // During animation, don't show planning vectors
    if (this.animState) return;
    for (const vector of buildVelocityVectorViews(
      state,
      this.playerId,
      HEX_SIZE,
    )) {
      ctx.strokeStyle = vector.color;
      ctx.lineWidth = vector.lineWidth;
      ctx.setLineDash(vector.lineDash);
      ctx.beginPath();
      ctx.moveTo(vector.from.x, vector.from.y);
      ctx.lineTo(vector.to.x, vector.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (vector.arrowHead) {
        ctx.beginPath();
        ctx.moveTo(vector.to.x, vector.to.y);
        ctx.lineTo(vector.arrowHead.left.x, vector.arrowHead.left.y);
        ctx.moveTo(vector.to.x, vector.to.y);
        ctx.lineTo(vector.arrowHead.right.x, vector.arrowHead.right.y);
        ctx.stroke();
      }
      if (vector.ghostDot) {
        ctx.fillStyle = vector.ghostDot.color;
        ctx.beginPath();
        ctx.arc(
          vector.ghostDot.position.x,
          vector.ghostDot.position.y,
          vector.ghostDot.radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if (vector.speedLabel) {
        ctx.fillStyle = vector.speedLabel.color;
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          vector.speedLabel.text,
          vector.speedLabel.position.x,
          vector.speedLabel.position.y,
        );
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
      // Pending gravity arrows (next-turn effects)
      // in cyan
      for (const arrow of preview.pendingGravityArrows) {
        ctx.strokeStyle = arrow.color;
        ctx.lineWidth = arrow.lineWidth;
        ctx.setLineDash([3, 3]);
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
        ctx.setLineDash([]);
      }
      // Drift segments — faded future-turn paths
      for (const seg of preview.driftSegments) {
        ctx.save();
        ctx.globalAlpha = seg.alpha;
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(seg.points[0].x, seg.points[0].y);
        for (let i = 1; i < seg.points.length; i++) {
          ctx.lineTo(seg.points[i].x, seg.points[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
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
      for (const marker of [
        ...preview.burnMarkers,
        ...preview.overloadMarkers,
      ]) {
        if (marker.shadowBlur > 0 && marker.shadowColor) {
          ctx.shadowBlur = marker.shadowBlur;
          ctx.shadowColor = marker.shadowColor;
        }
        ctx.fillStyle = marker.fillColor;
        ctx.strokeStyle = marker.strokeColor;
        ctx.lineWidth = marker.lineWidth;
        ctx.beginPath();
        ctx.arc(
          marker.position.x,
          marker.position.y,
          marker.size,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (marker.label && marker.labelColor) {
          ctx.fillStyle = marker.labelColor;
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(marker.label, marker.position.x, marker.position.y);
        }
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
    for (const trail of buildShipTrailViews(
      state,
      this.playerId,
      this.shipTrails,
      HEX_SIZE,
    )) {
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
          if (!this.camera.isVisible(point.x, point.y)) {
            continue;
          }
          ctx.fillStyle = trail.waypointColor;
          ctx.beginPath();
          ctx.arc(point.x, point.y, trail.waypointRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    for (const trail of buildOrdnanceTrailViews(
      state,
      this.playerId,
      this.ordnanceTrails,
      HEX_SIZE,
    )) {
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
  private renderMovementPaths(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
  ) {
    if (!this.animState) return;
    const progress = Math.min(
      (now - this.animState.startTime) / this.animState.duration,
      1,
    );
    for (const pathView of buildMovementPathViews(
      state,
      this.playerId,
      this.animState.movements,
      progress,
      HEX_SIZE,
    )) {
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
        ctx.arc(
          waypoint.x,
          waypoint.y,
          pathView.waypointRadius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
  private renderShips(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
  ) {
    const visibleShips = getVisibleShips(
      state,
      this.playerId,
      this.animState !== null,
    );
    const stackOffsets = this.animState
      ? null
      : getShipStackOffsets(visibleShips);
    for (const ship of visibleShips) {
      let pos: PixelCoord;
      let velocity = ship.velocity;
      let labelYOffset = 24;
      // Check if this ship is being animated
      if (this.animState) {
        const movement = this.animState.movements.find(
          (m) => m.shipId === ship.id,
        );
        if (movement) {
          const progress = Math.min(
            (now - this.animState.startTime) / this.animState.duration,
            1,
          );
          pos = this.interpolatePath(movement.path, progress);
          velocity = movement.newVelocity;
          // Thrust trail during animation
          if (movement.fuelSpent > 0 && progress < 0.8) {
            const angle = Math.atan2(
              hexToPixel(movement.to, HEX_SIZE).y -
                hexToPixel(movement.from, HEX_SIZE).y,
              hexToPixel(movement.to, HEX_SIZE).x -
                hexToPixel(movement.from, HEX_SIZE).x,
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
        pos = {
          x: pos.x + stackOffset.xOffset,
          y: pos.y,
        };
        labelYOffset = stackOffset.labelYOffset;
      }
      // Ship heading based on velocity
      const heading = getShipHeading(ship.position, velocity, HEX_SIZE);
      // Selection highlight — pulsing glow
      const isSelected = ship.id === this.planningState.selectedShipId;
      if (isSelected) {
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
        ctx.save();
        ctx.strokeStyle = `rgba(79, 195, 247, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = '#4fc3f7';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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
      // Disabled indicator — background plate for
      // visibility
      if (disabledLabel) {
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        const labelX = pos.x + 12;
        const labelY = pos.y - 12;
        const metrics = ctx.measureText(disabledLabel);
        const pad = 3;
        ctx.fillStyle = 'rgba(180, 20, 20, 0.6)';
        ctx.beginPath();
        ctx.roundRect(
          labelX - pad,
          labelY - 8 - pad,
          metrics.width + pad * 2,
          10 + pad * 2,
          3,
        );
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(disabledLabel, labelX, labelY);
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
      } else if (
        identityMarker === 'enemyFugitive' ||
        identityMarker === 'enemyDecoy'
      ) {
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
      const inGravity = Boolean(
        this.map?.hexes.get(hexKey(ship.position))?.gravity,
      );
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
      const labelView = buildShipLabelView(
        ship,
        this.playerId,
        inGravity,
        this.animState !== null,
      );
      if (labelView) {
        ctx.textAlign = 'center';
        ctx.fillStyle = labelView.typeColor;
        ctx.font = labelView.typeFont;
        ctx.fillText(labelView.typeName, pos.x, pos.y + labelYOffset);
        if (
          labelView.statusTag &&
          labelView.statusColor &&
          labelView.statusFont
        ) {
          ctx.fillStyle = labelView.statusColor;
          ctx.font = labelView.statusFont;
          ctx.fillText(labelView.statusTag, pos.x, pos.y + labelYOffset + 9);
        }
      }
    }
  }
  private drawShipIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    owner: number,
    alpha: number,
    heading: number,
    disabledTurns = 0,
    shipType = '',
  ) {
    drawShipIconFn(ctx, x, y, owner, alpha, heading, disabledTurns, shipType);
  }
  private drawThrustTrail(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    progress: number,
  ) {
    drawThrustTrailFn(ctx, x, y, angle, progress);
  }
  private interpolatePath(path: HexCoord[], progress: number): PixelCoord {
    return interpolatePathFn(path, progress, HEX_SIZE);
  }
  private renderOrdnance(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
  ) {
    renderOrdnanceFn(
      ctx,
      state,
      this.playerId,
      this.animState,
      HEX_SIZE,
      now,
      (path, progress) => this.interpolatePath(path, progress),
    );
  }
  private renderTorpedoGuidance(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
  ) {
    renderTorpedoGuidanceFn(
      ctx,
      state,
      this.playerId,
      this.planningState,
      this.animState !== null,
      HEX_SIZE,
      now,
    );
  }
  private renderCombatOverlay(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
  ) {
    renderCombatOverlayFn(
      ctx,
      state,
      this.playerId,
      this.planningState,
      this.map,
      this.animState !== null,
      HEX_SIZE,
      now,
    );
  }
  private renderHexFlashes(ctx: CanvasRenderingContext2D, now: number) {
    this.hexFlashes = drawHexFlashes(ctx, this.hexFlashes, now, HEX_SIZE);
  }
  private renderCombatEffects(ctx: CanvasRenderingContext2D, now: number) {
    this.combatEffects = drawCombatEffects(ctx, this.combatEffects, now);
  }
  private renderMovementEventsToast(
    ctx: CanvasRenderingContext2D,
    events: MovementEvent[],
    now: number,
    screenW: number,
  ) {
    if (events.length === 0) return;
    const showUntil = this.movementEvents?.showUntil;
    if (showUntil === undefined) return;
    const alpha = getToastFadeAlpha(showUntil, now);
    ctx.save();
    ctx.globalAlpha = alpha;
    let y = 60;
    for (const ev of events) {
      const ship = this.gameState?.ships.find((s) => s.id === ev.shipId);
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
  private renderCombatResultsToast(
    ctx: CanvasRenderingContext2D,
    results: CombatResult[],
    now: number,
    screenW: number,
  ) {
    if (results.length === 0) return;
    const showUntil = this.combatResults?.showUntil;
    if (showUntil === undefined) return;
    const alpha = getToastFadeAlpha(showUntil, now);
    ctx.save();
    ctx.globalAlpha = alpha;
    let y = 60;
    for (const line of buildCombatResultToastLines(
      results,
      must(this.gameState),
    )) {
      const isSecondary = line.variant === 'secondary';
      ctx.font = isSecondary ? '11px monospace' : 'bold 12px monospace';
      const w = ctx.measureText(line.text).width;
      const x = screenW / 2;
      ctx.fillStyle = isSecondary
        ? 'rgba(0, 0, 0, 0.65)'
        : 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, isSecondary ? 18 : 20);
      ctx.fillStyle = line.color;
      ctx.textAlign = 'center';
      ctx.fillText(line.text, x, y + 2);
      y += isSecondary ? 24 : 26;
    }
    ctx.restore();
  }
  // renderPhaseBanner removed — DOM overlay handles
  // phase announcements
  private renderMinimap(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
  ) {
    if (!this.map || !this.gameState) return;
    const hudTopOffset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--hud-top-offset',
      ) || '0',
    );
    const layout = createMinimapLayout(
      this.map.bounds,
      screenW,
      screenH,
      HEX_SIZE,
      hudTopOffset,
    );
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
      ctx.arc(
        ordnance.position.x,
        ordnance.position.y,
        ordnance.radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (scene.viewport) {
      ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
      ctx.fillRect(
        scene.viewport.x,
        scene.viewport.y,
        scene.viewport.width,
        scene.viewport.height,
      );
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        scene.viewport.x,
        scene.viewport.y,
        scene.viewport.width,
        scene.viewport.height,
      );
    }
    ctx.restore();
  }
}
