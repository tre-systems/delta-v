import type { HexCoord } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { AnimationState } from './animation';
import type { Camera } from './camera';
import {
  buildMovementPathViews,
  buildOrdnanceTrailViews,
  buildShipTrailViews,
  type TrailView,
} from './vectors';
import { minScreenScale, screenDash, screenLineWidth } from './visibility';

const drawPolylineTrail = (
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  lineColor: string,
  lineWidth: number,
  lineDash: number[],
  zoom: number,
): void => {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = screenLineWidth(lineWidth, zoom);
  ctx.shadowColor = lineColor;
  ctx.shadowBlur = 2;
  ctx.setLineDash(screenDash(lineDash, zoom));
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
};

const drawTrailWaypoints = (
  ctx: CanvasRenderingContext2D,
  trail: TrailView,
  camera: Camera,
): void => {
  if (!trail.waypointColor) return;
  for (const point of trail.points) {
    if (!camera.isVisible(point.x, point.y)) continue;
    ctx.fillStyle = trail.waypointColor;
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      trail.waypointRadius * minScreenScale(camera.zoom, 0.85),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
};

export const drawShipAndOrdnanceTrails = (
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playerId: PlayerId,
  shipTrails: Map<string, HexCoord[]>,
  ordnanceTrails: Map<string, HexCoord[]>,
  hexSize: number,
  camera: Camera,
): void => {
  for (const trail of buildShipTrailViews(
    state,
    playerId,
    shipTrails,
    hexSize,
  )) {
    drawPolylineTrail(
      ctx,
      trail.points,
      trail.lineColor,
      trail.lineWidth,
      trail.lineDash,
      camera.zoom,
    );
    drawTrailWaypoints(ctx, trail, camera);
  }
  for (const trail of buildOrdnanceTrailViews(
    state,
    playerId,
    ordnanceTrails,
    hexSize,
  )) {
    drawPolylineTrail(
      ctx,
      trail.points,
      trail.lineColor,
      trail.lineWidth,
      trail.lineDash,
      camera.zoom,
    );
    ctx.setLineDash([]);
  }
};

export const drawAnimatedMovementPaths = (
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playerId: PlayerId,
  animState: AnimationState,
  now: number,
  hexSize: number,
  zoom: number,
): void => {
  const progress = Math.min(
    (now - animState.startTime) / animState.duration,
    1,
  );
  for (const pathView of buildMovementPathViews(
    state,
    playerId,
    animState.movements,
    progress,
    hexSize,
  )) {
    ctx.save();
    ctx.strokeStyle = pathView.color;
    ctx.lineWidth = screenLineWidth(pathView.lineWidth, zoom);
    ctx.shadowColor = pathView.color;
    ctx.shadowBlur = 3;
    ctx.setLineDash(screenDash(pathView.lineDash, zoom));
    ctx.beginPath();
    ctx.moveTo(pathView.points[0].x, pathView.points[0].y);
    for (let i = 1; i < pathView.points.length; i++) {
      ctx.lineTo(pathView.points[i].x, pathView.points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    for (const waypoint of pathView.passedWaypoints) {
      ctx.fillStyle = pathView.color;
      ctx.beginPath();
      ctx.arc(
        waypoint.x,
        waypoint.y,
        pathView.waypointRadius * minScreenScale(zoom, 0.85),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
};
