import { must } from '../../shared/assert';
import { MOVEMENT_ANIM_DURATION } from '../../shared/constants';
import { type HexCoord, hexToPixel } from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  PlayerId,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import { cond } from '../../shared/util';
import type { PlanningState } from '../game/planning';
import {
  type AnimationState,
  collectAnimatedHexes,
  createMovementAnimationManager,
} from './animation';
import { createCamera } from './camera';
import { buildCombatEffectsForResults } from './combat-fx';
import { drawAstrogationCoursePreviewLayer } from './course-draw';
import {
  drawShipIcon as drawShipIconFn,
  interpolatePath as interpolatePathFn,
} from './draw';
import {
  type CombatEffect,
  drawCombatEffects,
  drawHexFlashes,
  type HexFlash,
} from './effects';
import { frameCameraOnAnimatedHexes, frameCameraOnPlayerShips } from './frame';
import { drawMinimapOverlay } from './minimap-draw';
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
import { drawShipsLayer } from './ships';
import {
  invalidateStaticSceneLayer,
  type StaticSceneLayer,
} from './static-layer';
import { drawStaticSceneWithCache } from './static-scene';
import {
  drawCombatResultsToastOverlay,
  drawMovementEventsToastOverlay,
} from './toast-draw';
import { drawAnimatedMovementPaths, drawShipAndOrdnanceTrails } from './trails';
import { buildBaseThreatZoneViews } from './vectors';
import { drawVelocityVectorLayer } from './vel-draw';

export const HEX_SIZE = 28;

export const createRenderer = (
  canvas: HTMLCanvasElement,
  planningState: PlanningState,
) => {
  const ctx = must(canvas.getContext('2d'));
  const camera = createCamera();
  const stars: Star[] = generateStars(600, 2000);
  const movementAnimation = createMovementAnimationManager();
  const staticLayerRef: { layer: StaticSceneLayer | null } = { layer: null };

  let map: SolarSystemMap | null = null;
  let gameState: GameState | null = null;
  let playerId = 0 as PlayerId;
  let combatResults: {
    results: CombatResult[];
    showUntil: number;
  } | null = null;
  let combatEffects: CombatEffect[] = [];
  let hexFlashes: HexFlash[] = [];
  let screenFlash: {
    startTime: number;
    duration: number;
    color: string;
  } | null = null;
  let movementEvents: {
    events: MovementEvent[];
    showUntil: number;
  } | null = null;
  let lastTime = 0;

  const animState = (): AnimationState | null =>
    movementAnimation.getAnimationState();
  const shipTrails = (): Map<string, HexCoord[]> =>
    movementAnimation.getShipTrails();
  const ordnanceTrails = (): Map<string, HexCoord[]> =>
    movementAnimation.getOrdnanceTrails();

  document.addEventListener('visibilitychange', () => {
    movementAnimation.handleVisibilityChange(
      document.visibilityState,
      performance.now(),
    );
  });

  const invalidateStatic = (): void => {
    invalidateStaticSceneLayer(staticLayerRef.layer);
  };

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth);
    const h = Math.round(canvas.clientHeight);
    if (w <= 0 || h <= 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    invalidateStatic();
  };

  const drawBaseThreatZones = (
    layerCtx: CanvasRenderingContext2D,
    state: GameState,
    solarMap: SolarSystemMap,
  ): void => {
    if (animState()) return;
    const zones = buildBaseThreatZoneViews(state, playerId, solarMap, HEX_SIZE);
    for (const zone of zones) {
      layerCtx.fillStyle = 'rgba(255, 80, 60, 0.08)';
      layerCtx.strokeStyle = 'rgba(255, 80, 60, 0.2)';
      layerCtx.lineWidth = 1;
      layerCtx.beginPath();
      layerCtx.arc(
        zone.hexCenter.x,
        zone.hexCenter.y,
        zone.radius,
        0,
        Math.PI * 2,
      );
      layerCtx.fill();
      layerCtx.stroke();
    }
  };

  const drawCourseLayers = (
    layerCtx: CanvasRenderingContext2D,
    state: GameState,
    solarMap: SolarSystemMap,
  ): void => {
    if (animState()) return;
    drawVelocityVectorLayer(layerCtx, state, playerId, HEX_SIZE);
    drawAstrogationCoursePreviewLayer({
      ctx: layerCtx,
      state,
      playerId,
      planningState,
      map: solarMap,
      hexSize: HEX_SIZE,
      drawShipIcon: drawShipIconFn,
    });
  };

  const drawScreenFlash = (
    layerCtx: CanvasRenderingContext2D,
    now: number,
    w: number,
    h: number,
  ): void => {
    if (screenFlash && now < screenFlash.startTime + screenFlash.duration) {
      const p = (now - screenFlash.startTime) / screenFlash.duration;
      const alpha = (1 - p) * 0.35;
      layerCtx.fillStyle = screenFlash.color;
      layerCtx.globalAlpha = alpha;
      layerCtx.fillRect(0, 0, w, h);
      layerCtx.globalAlpha = 1;
    } else if (screenFlash) {
      screenFlash = null;
    }
  };

  const drawToasts = (
    layerCtx: CanvasRenderingContext2D,
    now: number,
    w: number,
  ): void => {
    if (combatResults && gameState) {
      if (now > combatResults.showUntil) {
        combatResults = null;
      } else {
        drawCombatResultsToastOverlay({
          ctx: layerCtx,
          results: combatResults.results,
          gameState,
          now,
          screenW: w,
          showUntil: combatResults.showUntil,
        });
      }
    }
    if (movementEvents && gameState) {
      if (now > movementEvents.showUntil) {
        movementEvents = null;
      } else {
        drawMovementEventsToastOverlay({
          ctx: layerCtx,
          events: movementEvents.events,
          gameState,
          now,
          screenW: w,
          showUntil: movementEvents.showUntil,
        });
      }
    }
  };

  const renderFrame = (
    now: number,
    w = canvas.clientWidth,
    h = canvas.clientHeight,
  ): void => {
    const layerCtx = ctx;
    layerCtx.fillStyle = '#08081a';
    layerCtx.fillRect(0, 0, w, h);

    let renderedStatic = false;
    if (map) {
      renderedStatic = drawStaticSceneWithCache({
        mainCtx: layerCtx,
        layerRef: staticLayerRef,
        now,
        width: w,
        height: h,
        camera,
        map,
        gameState,
        stars,
        hexSize: HEX_SIZE,
      });
    }

    layerCtx.save();
    camera.applyTransform(layerCtx);

    if (map) {
      if (!renderedStatic) {
        renderStarsFn(layerCtx, stars, camera.zoom);
        renderHexGridFn(layerCtx, map, HEX_SIZE, (x, y) =>
          camera.isVisible(x, y),
        );
        renderAsteroidsFn(
          layerCtx,
          map,
          gameState?.destroyedAsteroids ?? [],
          HEX_SIZE,
          (x, y) => camera.isVisible(x, y),
        );
        renderGravityIndicatorsFn(layerCtx, map, HEX_SIZE, (x, y) =>
          camera.isVisible(x, y),
        );
        renderBodiesFn(layerCtx, map, HEX_SIZE, now);
      }
      if (gameState) {
        renderMapBorderFn(layerCtx, map, gameState, playerId, HEX_SIZE, now);
      }
      renderBaseMarkersFn(layerCtx, map, gameState, playerId, HEX_SIZE);
      if (gameState) {
        renderLandingTargetFn(
          layerCtx,
          map,
          gameState,
          playerId,
          HEX_SIZE,
          now,
        );
      }
    }

    if (gameState && map) {
      drawBaseThreatZones(layerCtx, gameState, map);
      renderDetectionRangesFn(
        layerCtx,
        gameState,
        playerId,
        planningState.selectedShipId,
        map,
        HEX_SIZE,
        animState() !== null,
      );
      drawCourseLayers(layerCtx, gameState, map);
      renderOrdnanceFn({
        ctx: layerCtx,
        state: gameState,
        playerId,
        animState: animState(),
        hexSize: HEX_SIZE,
        now,
        interpolatePath: (path, progress) =>
          interpolatePathFn(path, progress, HEX_SIZE),
      });
      renderTorpedoGuidanceFn({
        ctx: layerCtx,
        state: gameState,
        playerId,
        planningState,
        isAnimating: animState() !== null,
        hexSize: HEX_SIZE,
        now,
      });
      renderCombatOverlayFn({
        ctx: layerCtx,
        state: gameState,
        playerId,
        planningState,
        map,
        isAnimating: animState() !== null,
        hexSize: HEX_SIZE,
        now,
      });
      drawShipAndOrdnanceTrails(
        layerCtx,
        gameState,
        playerId,
        shipTrails(),
        ordnanceTrails(),
        HEX_SIZE,
        camera,
      );
      const a = animState();
      if (a) {
        drawAnimatedMovementPaths(
          layerCtx,
          gameState,
          playerId,
          a,
          now,
          HEX_SIZE,
        );
      }
      drawShipsLayer({
        ctx: layerCtx,
        state: gameState,
        map,
        now,
        playerId,
        planningSelectedShipId: planningState.selectedShipId,
        hexSize: HEX_SIZE,
        animState: animState(),
      });
      hexFlashes = drawHexFlashes(layerCtx, hexFlashes, now, HEX_SIZE);
      combatEffects = drawCombatEffects(layerCtx, combatEffects, now);
    }

    layerCtx.restore();

    drawScreenFlash(layerCtx, now, w, h);
    drawToasts(layerCtx, now, w);
    if (map && gameState) {
      drawMinimapOverlay({
        ctx: layerCtx,
        map,
        state: gameState,
        playerId,
        shipTrails: shipTrails(),
        camera,
        screenW: w,
        screenH: h,
        hexSize: HEX_SIZE,
        selectedShipId: planningState.selectedShipId,
      });
    }
  };

  const loop = (now: number): void => {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const cw = Math.round(canvas.clientWidth);
    const ch = Math.round(canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (
      cw > 0 &&
      ch > 0 &&
      (canvas.width !== Math.round(cw * dpr) ||
        canvas.height !== Math.round(ch * dpr))
    ) {
      resize();
    }
    camera.update(dt, cw, ch);
    renderFrame(now, cw, ch);
    movementAnimation.completeIfElapsed(now);
    requestAnimationFrame(loop);
  };

  return {
    canvas,
    camera,

    setMap: (next: SolarSystemMap) => {
      map = next;
      invalidateStatic();
    },

    setGameState: (state: GameState | null) => {
      gameState = state;
    },

    setPlayerId: (id: number) => {
      playerId = id as PlayerId;
    },

    clearTrails: () => {
      movementAnimation.clearTrails();
    },

    animateMovements: (
      movements: ShipMovement[],
      ordnanceMovements: OrdnanceMovement[],
      onComplete: () => void,
    ) => {
      movementAnimation.start(movements, ordnanceMovements, onComplete);

      // Only frame camera on ships visible to this player
      const visibleMovements = gameState
        ? movements.filter((m) => {
            const ship = gameState?.ships.find((s) => s.id === m.shipId);
            return ship && (ship.owner === playerId || ship.detected);
          })
        : movements;
      const visibleOrdnance = ordnanceMovements;

      const allHexes = collectAnimatedHexes(visibleMovements, visibleOrdnance);
      if (map && allHexes.length > 0) {
        frameCameraOnAnimatedHexes(
          camera,
          map,
          visibleMovements,
          visibleOrdnance,
          HEX_SIZE,
          150,
        );
      }
    },

    showCombatResults: (
      results: CombatResult[],
      previousState?: GameState | null,
    ) => {
      const now = performance.now();
      combatResults = { results, showUntil: now + 3000 };
      combatEffects.push(
        ...buildCombatEffectsForResults(
          results,
          gameState,
          previousState,
          map,
          now,
          HEX_SIZE,
        ),
      );
    },

    showMovementEvents: (events: MovementEvent[]) => {
      if (events.length === 0) return;
      const now = performance.now();
      movementEvents = { events, showUntil: now + 4000 };
      for (const ev of events) {
        const p = hexToPixel(ev.hex, HEX_SIZE);
        const color =
          cond(
            [ev.type === 'crash', '#ff4444'],
            [ev.type === 'nukeDetonation', '#ff6600'],
            [ev.damageType === 'eliminated', '#ff4444'],
          ) ?? '#ffaa00';
        hexFlashes.push({
          position: p,
          startTime: now + MOVEMENT_ANIM_DURATION * 0.8,
          duration: 1500,
          color,
        });
      }
    },

    showLandingEffect: (hex: HexCoord) => {
      const p = hexToPixel(hex, HEX_SIZE);
      const now = performance.now();
      hexFlashes.push({
        position: p,
        startTime: now + MOVEMENT_ANIM_DURATION * 0.9,
        duration: 2000,
        color: '#66bb6a',
      });
    },

    triggerGameOverEffect: (won: boolean): number => {
      const now = performance.now();
      const color = won ? '#4488ff' : '#ff4444';
      camera.shake(12, 1.5);
      screenFlash = { startTime: now, duration: 1200, color };
      return 1200;
    },

    isAnimating: (): boolean => movementAnimation.isAnimating(),

    resetCamera: () => {
      camera.targetX = 0;
      camera.targetY = 0;
      camera.targetZoom = 0.3;
      camera.snapToTarget();
    },

    centerOnHex: (hex: HexCoord) => {
      const p = hexToPixel(hex, HEX_SIZE);
      camera.targetX = p.x;
      camera.targetY = p.y;
    },

    frameOnShips: () => {
      if (!gameState) return;
      frameCameraOnPlayerShips(camera, gameState, playerId, HEX_SIZE);
    },

    start: () => {
      resize();
      window.addEventListener('resize', resize);
      window.visualViewport?.addEventListener('resize', resize);
      lastTime = performance.now();
      requestAnimationFrame(loop);
    },

    /** @internal Used by tests — full canvas paint for one frame. */
    renderFrameForTests: (now: number, width?: number, height?: number) => {
      renderFrame(now, width, height);
    },
  };
};

export type Renderer = ReturnType<typeof createRenderer>;
