import type { GameState } from '../../shared/types/domain';
import { buildVelocityVectorViews, type VelocityVectorView } from './vectors';

export function drawVelocityVectorLayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playerId: number,
  hexSize: number,
): void {
  for (const vector of buildVelocityVectorViews(state, playerId, hexSize)) {
    ctx.strokeStyle = vector.color;
    ctx.lineWidth = vector.lineWidth;
    ctx.setLineDash(vector.lineDash);
    ctx.beginPath();
    ctx.moveTo(vector.from.x, vector.from.y);
    ctx.lineTo(vector.to.x, vector.to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawVectorArrowHead(ctx, vector);
    drawVectorGhostDot(ctx, vector);
    drawVectorSpeedLabel(ctx, vector);
  }
}

function drawVectorArrowHead(
  ctx: CanvasRenderingContext2D,
  vector: VelocityVectorView,
): void {
  if (!vector.arrowHead) return;
  ctx.beginPath();
  ctx.moveTo(vector.to.x, vector.to.y);
  ctx.lineTo(vector.arrowHead.left.x, vector.arrowHead.left.y);
  ctx.moveTo(vector.to.x, vector.to.y);
  ctx.lineTo(vector.arrowHead.right.x, vector.arrowHead.right.y);
  ctx.stroke();
}

function drawVectorGhostDot(
  ctx: CanvasRenderingContext2D,
  vector: VelocityVectorView,
): void {
  if (!vector.ghostDot) return;
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

function drawVectorSpeedLabel(
  ctx: CanvasRenderingContext2D,
  vector: VelocityVectorView,
): void {
  if (!vector.speedLabel) return;
  ctx.fillStyle = vector.speedLabel.color;
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    vector.speedLabel.text,
    vector.speedLabel.position.x,
    vector.speedLabel.position.y,
  );
}
