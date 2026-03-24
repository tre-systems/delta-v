import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type { PlanningState } from '../game/planning';
import {
  buildAstrogationCoursePreviewViews,
  type CourseArrowView,
  type CoursePreviewView,
} from './course';
import {
  drawCourseMarkerView,
  drawWeakGravityMarkerView,
} from './course-markers';
import type { DrawShipIconInput } from './draw';

export type DrawShipIconFn = (input: DrawShipIconInput) => void;

const drawDriftSegment = (
  ctx: CanvasRenderingContext2D,
  seg: CoursePreviewView['driftSegments'][number],
): void => {
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
};

const drawCourseArrow = (
  ctx: CanvasRenderingContext2D,
  arrow: CourseArrowView,
): void => {
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
};

const drawPendingGravityArrow = (
  ctx: CanvasRenderingContext2D,
  arrow: CourseArrowView,
): void => {
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
};

const drawPreviewPolyline = (
  ctx: CanvasRenderingContext2D,
  preview: CoursePreviewView,
): void => {
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
};

const drawSingleCoursePreview = (
  ctx: CanvasRenderingContext2D,
  preview: CoursePreviewView,
  drawShipIcon: DrawShipIconFn,
): void => {
  drawPreviewPolyline(ctx, preview);
  for (const arrow of preview.gravityArrows) {
    drawCourseArrow(ctx, arrow);
  }
  for (const arrow of preview.pendingGravityArrows) {
    drawPendingGravityArrow(ctx, arrow);
  }
  for (const seg of preview.driftSegments) {
    drawDriftSegment(ctx, seg);
  }
  if (preview.ghostShip) {
    const g = preview.ghostShip;
    drawShipIcon({
      ctx,
      x: g.position.x,
      y: g.position.y,
      owner: g.owner,
      alpha: g.alpha,
      heading: 0,
      disabledTurns: 0,
      shipType: g.shipType,
    });
  }
  for (const marker of [...preview.burnMarkers, ...preview.overloadMarkers]) {
    drawCourseMarkerView(ctx, marker);
  }
  for (const marker of preview.weakGravityMarkers) {
    drawWeakGravityMarkerView(ctx, marker);
  }
  if (preview.fuelCostLabel) {
    const f = preview.fuelCostLabel;
    ctx.fillStyle = f.color;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.position.x, f.position.y);
  }
};

export type DrawAstrogationCoursePreviewLayerInput = {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  playerId: number;
  planningState: PlanningState;
  map: SolarSystemMap;
  hexSize: number;
  drawShipIcon: DrawShipIconFn;
};

export const drawAstrogationCoursePreviewLayer = (
  input: DrawAstrogationCoursePreviewLayerInput,
): void => {
  const { ctx, state, playerId, planningState, map, hexSize, drawShipIcon } =
    input;
  for (const preview of buildAstrogationCoursePreviewViews(
    state,
    playerId,
    planningState,
    map,
    hexSize,
  )) {
    drawSingleCoursePreview(ctx, preview, drawShipIcon);
  }
};
