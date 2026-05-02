import type { CourseMarkerView, WeakGravityMarkerView } from './course';
import { scaledFont } from './text';
import { screenLineWidth } from './visibility';

export const drawCourseMarkerView = (
  ctx: CanvasRenderingContext2D,
  marker: CourseMarkerView,
  zoom: number,
): void => {
  ctx.save();
  if (marker.shadowBlur > 0 && marker.shadowColor) {
    ctx.shadowBlur = marker.shadowBlur;
    ctx.shadowColor = marker.shadowColor;
  }
  ctx.fillStyle = marker.fillColor;
  ctx.strokeStyle = marker.strokeColor;
  ctx.lineWidth = screenLineWidth(marker.lineWidth, zoom);
  ctx.beginPath();
  ctx.arc(marker.position.x, marker.position.y, marker.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (marker.label && marker.labelColor) {
    ctx.fillStyle = marker.labelColor;
    ctx.font = scaledFont('bold 11px monospace', zoom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(marker.label, marker.position.x, marker.position.y);
  }
};

export const drawWeakGravityMarkerView = (
  ctx: CanvasRenderingContext2D,
  marker: WeakGravityMarkerView,
  zoom: number,
): void => {
  ctx.save();
  ctx.strokeStyle = marker.strokeColor;
  ctx.fillStyle = marker.fillColor;
  ctx.lineWidth = screenLineWidth(1.65, zoom);
  ctx.shadowColor = marker.strokeColor;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(marker.position.x, marker.position.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = marker.labelColor;
  ctx.font = scaledFont('bold 10px monospace', zoom);
  ctx.textAlign = 'center';
  ctx.fillText('G', marker.position.x, marker.position.y + 3);
  if (marker.strikeFrom && marker.strikeTo) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)';
    ctx.lineWidth = screenLineWidth(1.15, zoom);
    ctx.beginPath();
    ctx.moveTo(marker.strikeFrom.x, marker.strikeFrom.y);
    ctx.lineTo(marker.strikeTo.x, marker.strikeTo.y);
    ctx.stroke();
    ctx.restore();
  }
};
