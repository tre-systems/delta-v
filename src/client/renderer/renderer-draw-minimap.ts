import type { HexCoord } from '../../shared/hex';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import { createMinimapLayout } from '../game/minimap';
import type { Camera } from './camera';
import { buildMinimapSceneView } from './minimap';

export function drawMinimapOverlay(
  ctx: CanvasRenderingContext2D,
  map: SolarSystemMap,
  state: GameState,
  playerId: number,
  shipTrails: Map<string, HexCoord[]>,
  camera: Camera,
  screenW: number,
  screenH: number,
  hexSize: number,
): void {
  const hudTopOffset = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--hud-top-offset',
    ) || '0',
  );
  const layout = createMinimapLayout(
    map.bounds,
    screenW,
    screenH,
    hexSize,
    hudTopOffset,
  );
  const { x: mmX, y: mmY, width: mmW, height: mmH } = layout;
  ctx.save();
  drawMinimapChrome(ctx, mmX, mmY, mmW, mmH);
  const scene = buildMinimapSceneView(
    map,
    state,
    playerId,
    shipTrails,
    layout,
    camera,
    screenW,
    screenH,
    hexSize,
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
    drawMinimapTrail(ctx, trail.points, trail.color);
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
    drawMinimapViewport(ctx, scene.viewport);
  }
  ctx.restore();
}

function drawMinimapChrome(
  ctx: CanvasRenderingContext2D,
  mmX: number,
  mmY: number,
  mmW: number,
  mmH: number,
): void {
  ctx.fillStyle = 'rgba(10, 10, 26, 0.8)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(mmX, mmY, mmW, mmH, 4);
  ctx.fill();
  ctx.stroke();
}

function drawMinimapTrail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawMinimapViewport(
  ctx: CanvasRenderingContext2D,
  viewport: { x: number; y: number; width: number; height: number },
): void {
  ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
  ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
}
