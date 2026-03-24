import type { CourseMarkerView, WeakGravityMarkerView } from './course';

export const drawCourseMarkerView = (
  ctx: CanvasRenderingContext2D,
  marker: CourseMarkerView,
): void => {
  if (marker.shadowBlur > 0 && marker.shadowColor) {
    ctx.shadowBlur = marker.shadowBlur;
    ctx.shadowColor = marker.shadowColor;
  }
  ctx.fillStyle = marker.fillColor;
  ctx.strokeStyle = marker.strokeColor;
  ctx.lineWidth = marker.lineWidth;
  ctx.beginPath();
  ctx.arc(marker.position.x, marker.position.y, marker.size, 0, Math.PI * 2);
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
};

export const drawWeakGravityMarkerView = (
  ctx: CanvasRenderingContext2D,
  marker: WeakGravityMarkerView,
): void => {
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
};
