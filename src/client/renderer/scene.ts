/**
 * Map/scene-level Canvas drawing: stars, hex grid, gravity indicators,
 * bodies, base markers, map border, asteroids, landing targets, detection ranges.
 * Pure functions extracted from Renderer — no class state dependencies.
 */

import { must } from '../../shared/assert';
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexToPixel,
  parseHexKey,
} from '../../shared/hex';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import {
  buildAsteroidDebrisView,
  buildBaseMarkerView,
  buildBodyView,
  buildLandingObjectiveView,
  buildMapBorderView,
} from './map';
import { buildDetectionRangeViews } from './vectors';
export interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
}
export const generateStars = (count: number, range: number): Star[] => {
  let seed = 42;
  const rand = (): number => {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, () => ({
    x: (rand() - 0.5) * range * 2,
    y: (rand() - 0.5) * range * 2,
    brightness: 0.3 + rand() * 0.7,
    size: 0.5 + rand() * 1.5,
  }));
};
// Precomputed flat-top hex vertex offsets (cos/sin at 60-degree intervals)
const HEX_OFFSETS: [number, number][] = Array.from({ length: 7 }, (_, i) => {
  const angle = (Math.PI / 3) * i;
  return [Math.cos(angle), Math.sin(angle)] as [number, number];
});
export const renderStars = (
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  zoom: number,
): void => {
  for (const star of stars) {
    ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * 0.6})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
};
export const renderHexGrid = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  hexSize: number,
  isVisible: (x: number, y: number) => boolean,
): void => {
  ctx.strokeStyle = 'rgba(100, 140, 200, 0.35)';
  ctx.lineWidth = 1;
  const size = hexSize;
  const { minQ, maxQ, minR, maxR } = map.bounds;
  const corners = [
    hexToPixel({ q: minQ, r: minR }, size),
    hexToPixel({ q: maxQ, r: minR }, size),
    hexToPixel({ q: minQ, r: maxR }, size),
    hexToPixel({ q: maxQ, r: maxR }, size),
  ];
  const pxMinX = Math.min(...corners.map((c) => c.x)) - size;
  const pxMaxX = Math.max(...corners.map((c) => c.x)) + size;
  const pxMinY = Math.min(...corners.map((c) => c.y)) - size;
  const pxMaxY = Math.max(...corners.map((c) => c.y)) + size;
  const qPad = Math.ceil((maxR - minR) / 2) + 2;
  ctx.beginPath();
  for (let q = minQ - qPad; q <= maxQ + qPad; q++) {
    for (let r = minR - qPad; r <= maxR + qPad; r++) {
      const p = hexToPixel({ q, r }, size);
      if (p.x < pxMinX || p.x > pxMaxX || p.y < pxMinY || p.y > pxMaxY)
        continue;
      if (!isVisible(p.x, p.y)) continue;
      ctx.moveTo(
        p.x + HEX_OFFSETS[0][0] * size,
        p.y + HEX_OFFSETS[0][1] * size,
      );
      for (let i = 1; i <= 6; i++) {
        ctx.lineTo(
          p.x + HEX_OFFSETS[i][0] * size,
          p.y + HEX_OFFSETS[i][1] * size,
        );
      }
    }
  }
  ctx.stroke();
};
export const renderGravityIndicators = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  hexSize: number,
  isVisible: (x: number, y: number) => boolean,
): void => {
  for (const [key, hex] of map.hexes) {
    if (!hex.gravity) continue;
    const coord = parseHexKey(key);
    const p = hexToPixel(coord, hexSize);
    if (!isVisible(p.x, p.y)) continue;
    const dir = HEX_DIRECTIONS[hex.gravity.direction];
    const target = hexToPixel(hexAdd(coord, dir), hexSize);
    ctx.strokeStyle =
      hex.gravity.strength === 'weak'
        ? 'rgba(100, 140, 255, 0.12)'
        : 'rgba(100, 140, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + (target.x - p.x) * 0.4, p.y + (target.y - p.y) * 0.4);
    ctx.stroke();
    const ax = p.x + (target.x - p.x) * 0.4;
    const ay = p.y + (target.y - p.y) * 0.4;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    const headLen = 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - headLen * Math.cos(angle - 0.5),
      ay - headLen * Math.sin(angle - 0.5),
    );
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - headLen * Math.cos(angle + 0.5),
      ay - headLen * Math.sin(angle + 0.5),
    );
    ctx.stroke();
  }
};
export const renderBodies = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  hexSize: number,
  now: number,
): void => {
  for (const body of map.bodies) {
    const view = buildBodyView(body, hexSize, now);
    const p = view.center;
    const r = view.radius;
    for (const ripple of view.ripples) {
      ctx.strokeStyle = body.color;
      ctx.globalAlpha = ripple.alpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ripple.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3);
    glow.addColorStop(0, view.glowStops[0]);
    glow.addColorStop(0.4, view.glowStops[1]);
    glow.addColorStop(1, view.glowStops[2]);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(
      p.x - r * 0.3,
      p.y - r * 0.3,
      r * 0.1,
      p.x,
      p.y,
      r,
    );
    grad.addColorStop(0, view.coreColor);
    grad.addColorStop(1, view.edgeColor);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '600 11px var(--font-display), sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(view.label, p.x, view.labelY);
  }
};
export const renderBaseMarkers = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  state: GameState | null,
  playerId: number,
  hexSize: number,
): void => {
  for (const [key, hex] of map.hexes) {
    if (!hex.base) continue;
    const coord = parseHexKey(key);
    const p = hexToPixel(coord, hexSize);
    const markerView = buildBaseMarkerView(key, state, playerId);
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
    ctx.fillStyle = must(markerView.fillStyle);
    ctx.strokeStyle = markerView.strokeStyle;
    ctx.lineWidth = markerView.lineWidth;
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
};
export const renderMapBorder = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  state: GameState,
  playerId: number,
  hexSize: number,
  now: number,
): void => {
  const borderView = buildMapBorderView(
    map.bounds,
    Boolean(state.players[playerId]?.escapeWins),
    now,
    hexSize,
  );
  ctx.strokeStyle = borderView.strokeStyle;
  ctx.lineWidth = borderView.lineWidth;
  ctx.setLineDash(borderView.lineDash);
  ctx.strokeRect(
    borderView.topLeft.x,
    borderView.topLeft.y,
    borderView.width,
    borderView.height,
  );
  ctx.setLineDash([]);
};
export const renderAsteroids = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  destroyedAsteroids: string[],
  hexSize: number,
  isVisible: (x: number, y: number) => boolean,
): void => {
  const destroyed = new Set(destroyedAsteroids);
  for (const [key, hex] of map.hexes) {
    if (hex.terrain !== 'asteroid') continue;
    if (destroyed.has(key)) continue;
    const debrisView = buildAsteroidDebrisView(parseHexKey(key), hexSize);
    if (!isVisible(debrisView.center.x, debrisView.center.y)) continue;
    // Rock particles
    ctx.fillStyle = 'rgba(100, 100, 100, 0.65)';
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
};
export const renderLandingTarget = (
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  state: GameState,
  playerId: number,
  hexSize: number,
  now: number,
): void => {
  const objectiveView = buildLandingObjectiveView(
    state.players[playerId],
    map,
    now,
    hexSize,
  );
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
  ctx.arc(
    objectiveView.center.x,
    objectiveView.center.y,
    objectiveView.radius,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = objectiveView.labelStyle;
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    objectiveView.labelText,
    objectiveView.center.x,
    objectiveView.labelY,
  );
};
export const renderDetectionRanges = (
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playerId: number,
  selectedShipId: string | null,
  map: SolarSystemMap,
  hexSize: number,
  isAnimating: boolean,
): void => {
  if (isAnimating) return;
  const overlays = buildDetectionRangeViews(
    state,
    playerId,
    selectedShipId,
    map,
    hexSize,
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
};
