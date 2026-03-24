import type { HexCoord } from '../../shared/hex';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import { createMinimapLayout } from '../game/minimap';
import type { Camera } from './camera';
import {
  buildMinimapSceneView,
  type MinimapObjectiveBearingView,
} from './minimap';

const drawMinimapChrome = (
  ctx: CanvasRenderingContext2D,
  mmX: number,
  mmY: number,
  mmW: number,
  mmH: number,
): void => {
  ctx.fillStyle = 'rgba(10, 10, 26, 0.8)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(mmX, mmY, mmW, mmH, 4);
  ctx.fill();
  ctx.stroke();
};

const drawMinimapTrail = (
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
): void => {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
};

const drawMinimapViewport = (
  ctx: CanvasRenderingContext2D,
  viewport: { x: number; y: number; width: number; height: number },
): void => {
  ctx.fillStyle = 'rgba(79, 195, 247, 0.06)';
  ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
};

const drawMinimapObjectiveBearing = (
  ctx: CanvasRenderingContext2D,
  bearing: MinimapObjectiveBearingView,
): void => {
  const { from, to } = bearing;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);

  if (len < 8) {
    return;
  }

  const ux = dx / len;
  const uy = dy / len;
  const arrowLen = Math.min(34, Math.max(12, len * 0.38));
  const tipX = from.x + ux * arrowLen;
  const tipY = from.y + uy * arrowLen;
  const head = 5;
  const ang = Math.atan2(uy, ux);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 224, 130, 0.95)';
  ctx.fillStyle = 'rgba(255, 224, 130, 0.95)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - head * Math.cos(ang - 0.5),
    tipY - head * Math.sin(ang - 0.5),
  );
  ctx.lineTo(
    tipX - head * Math.cos(ang + 0.5),
    tipY - head * Math.sin(ang + 0.5),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

export type DrawMinimapOverlayInput = {
  ctx: CanvasRenderingContext2D;
  map: SolarSystemMap;
  state: GameState;
  playerId: number;
  shipTrails: Map<string, HexCoord[]>;
  camera: Camera;
  screenW: number;
  screenH: number;
  hexSize: number;
  selectedShipId: string | null;
};

export const drawMinimapOverlay = (input: DrawMinimapOverlayInput): void => {
  const {
    ctx,
    map,
    state,
    playerId,
    shipTrails,
    camera,
    screenW,
    screenH,
    hexSize,
    selectedShipId,
  } = input;
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
    selectedShipId,
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
  if (scene.objectiveBearing) {
    drawMinimapObjectiveBearing(ctx, scene.objectiveBearing);
  }
  if (scene.viewport) {
    drawMinimapViewport(ctx, scene.viewport);
  }
  ctx.restore();
};
