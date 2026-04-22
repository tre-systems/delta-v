import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { PlanningState } from '../game/planning';
import {
  type AstrogationVectorReadoutView,
  buildAstrogationCoursePreviewViews,
  buildAstrogationVectorReadout,
  type CourseArrowView,
  type CourseCrashMarkerView,
  type CoursePreviewView,
} from './course';
import type { DrawShipIconInput } from './draw';
import { drawCourseMarkerView, drawWeakGravityMarkerView } from './markers';
import { scaledFont } from './text';

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

const drawCourseCrashMarker = (
  ctx: CanvasRenderingContext2D,
  marker: CourseCrashMarkerView,
): void => {
  const { x, y } = marker.position;
  const radius = 11;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 68, 68, 0.35)';
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const arm = 6;
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
  ctx.restore();
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

const drawTakeoffSegment = (
  ctx: CanvasRenderingContext2D,
  segment: { points: { x: number; y: number }[] },
): void => {
  if (segment.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(segment.points[0].x, segment.points[0].y);
  for (let i = 1; i < segment.points.length; i++) {
    ctx.lineTo(segment.points[i].x, segment.points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
};

const drawSingleCoursePreview = (
  ctx: CanvasRenderingContext2D,
  preview: CoursePreviewView,
  drawShipIcon: DrawShipIconFn,
  playerId: PlayerId,
  zoom: number,
): void => {
  if (preview.takeoffSegment) {
    drawTakeoffSegment(ctx, preview.takeoffSegment);
  }
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
  if (preview.crashMarker) {
    drawCourseCrashMarker(ctx, preview.crashMarker);
  }
  if (preview.ghostShip) {
    const g = preview.ghostShip;
    drawShipIcon({
      ctx,
      x: g.position.x,
      y: g.position.y,
      owner: g.owner,
      playerId,
      alpha: g.alpha,
      heading: g.heading,
      disabledTurns: 0,
      shipType: g.shipType,
    });
  }
  for (const marker of [...preview.burnMarkers, ...preview.overloadMarkers]) {
    drawCourseMarkerView(ctx, marker, zoom);
  }
  if (preview.burnArrow) {
    drawCourseArrow(ctx, preview.burnArrow);
  }
  if (preview.overloadArrow) {
    drawCourseArrow(ctx, preview.overloadArrow);
  }
  for (const marker of preview.weakGravityMarkers) {
    drawWeakGravityMarkerView(ctx, marker, zoom);
  }
  if (preview.fuelCostLabel) {
    const f = preview.fuelCostLabel;
    ctx.fillStyle = f.color;
    ctx.font = scaledFont('bold 11px monospace', zoom);
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.position.x, f.position.y);
  }
};

export type DrawAstrogationCoursePreviewLayerInput = {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  playerId: PlayerId;
  planningState: PlanningState;
  map: SolarSystemMap;
  hexSize: number;
  drawShipIcon: DrawShipIconFn;
  zoom: number;
};

const drawReadoutArrow = (
  ctx: CanvasRenderingContext2D,
  arrow: AstrogationVectorReadoutView['currentVelocityArrow'],
): void => {
  if (!arrow) return;
  ctx.save();
  ctx.strokeStyle = arrow.color;
  ctx.fillStyle = arrow.color;
  ctx.lineWidth = arrow.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(arrow.lineDash);
  ctx.beginPath();
  ctx.moveTo(arrow.from.x, arrow.from.y);
  ctx.lineTo(arrow.to.x, arrow.to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Filled triangular arrowhead reads more clearly than a two-stroke V
  // against the busy course preview behind it.
  ctx.beginPath();
  ctx.moveTo(arrow.to.x, arrow.to.y);
  ctx.lineTo(arrow.headLeft.x, arrow.headLeft.y);
  ctx.lineTo(arrow.headRight.x, arrow.headRight.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawAstrogationVectorReadout = (
  ctx: CanvasRenderingContext2D,
  readout: AstrogationVectorReadoutView,
  zoom: number,
): void => {
  ctx.save();
  // Draw v first (baseline), then Δv, then v' on top so the emphasized
  // result vector wins the z-order without relying on side-effects.
  drawReadoutArrow(ctx, readout.currentVelocityArrow);
  drawReadoutArrow(ctx, readout.burnArrow);
  drawReadoutArrow(ctx, readout.resultVelocityArrow);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = scaledFont('700 12px monospace', zoom);

  for (const label of readout.labels) {
    const metrics = ctx.measureText(label.text);
    const padX = 5;
    const h = 16;
    const w = metrics.width + padX * 2;
    const x = label.position.x - w / 2;
    const y = label.position.y - h / 2;
    // Rounded pill with a 1px matching-color border so the readout
    // stays legible against the course polyline and gravity rings.
    ctx.fillStyle = 'rgba(6, 14, 28, 0.82)';
    ctx.strokeStyle = label.color;
    ctx.lineWidth = 1;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = label.color;
    ctx.fillText(label.text, label.position.x, label.position.y);
  }
  ctx.restore();
};

export const drawAstrogationCoursePreviewLayer = (
  input: DrawAstrogationCoursePreviewLayerInput,
): void => {
  const {
    ctx,
    state,
    playerId,
    planningState,
    map,
    hexSize,
    drawShipIcon,
    zoom,
  } = input;
  for (const preview of buildAstrogationCoursePreviewViews(
    state,
    playerId,
    planningState,
    map,
    hexSize,
  )) {
    drawSingleCoursePreview(ctx, preview, drawShipIcon, playerId, zoom);
  }
  const readout = buildAstrogationVectorReadout(
    state,
    playerId,
    planningState,
    hexSize,
  );
  if (readout) {
    drawAstrogationVectorReadout(ctx, readout, zoom);
  }
};
