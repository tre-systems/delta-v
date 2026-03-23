// Low-level Canvas drawing primitives for ships, ordnance,
// and movement interpolation.
// Pure functions extracted from Renderer — no class state
// dependencies.

import { SHIP_STATS } from '../../shared/constants';
import {
  type HexCoord,
  hexAdd,
  hexToPixel,
  type PixelCoord,
} from '../../shared/hex';

// Draw a ship icon (arrow or octagon for orbital base)
// at the given position.
export const drawShipIcon = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: number,
  alpha: number,
  heading: number,
  disabledTurns = 0,
  shipType = '',
): void => {
  const color =
    owner === 0
      ? `rgba(79, 195, 247, ${alpha})`
      : `rgba(255, 152, 0, ${alpha})`;

  const stats = SHIP_STATS[shipType];
  const combat = stats?.combat ?? 2;

  const size = combat >= 15 ? 12 : combat >= 8 ? 10 : combat >= 4 ? 9 : 8;

  ctx.save();
  ctx.translate(x, y);

  // Damage glow for disabled ships (flickering red/orange)
  if (disabledTurns > 0) {
    const flickerPhase = performance.now() / 200 + x * 0.1;

    const intensity =
      0.3 + 0.2 * Math.sin(flickerPhase) + 0.1 * Math.sin(flickerPhase * 2.7);

    const glowColor =
      disabledTurns >= 4
        ? `rgba(255, 50, 50, ${intensity})`
        : `rgba(255, 150, 50, ${intensity})`;

    const glowRadius = 10 + disabledTurns;

    ctx.fillStyle = glowColor;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(heading);
  ctx.fillStyle = color;
  ctx.beginPath();

  if (shipType === 'orbitalBase') {
    const r = 12;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, -size * 0.5);
    ctx.lineTo(-size * 0.3, 0);
    ctx.lineTo(-size * 0.6, size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
};

// Draw a thrust exhaust trail behind a moving ship.
export const drawThrustTrail = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  progress: number,
): void => {
  const len = 12 + Math.sin(progress * 20) * 4;
  const spread = 0.3;
  const alpha = 0.6 * (1 - progress);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, `rgba(255, 200, 50, ${alpha})`);
  grad.addColorStop(0.5, `rgba(255, 100, 20, ${alpha * 0.5})`);
  grad.addColorStop(1, 'transparent');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(len, -len * spread);
  ctx.lineTo(len, len * spread);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
};

// Smoothly interpolate a position along a hex path
// with ease-in-out.
export const interpolatePath = (
  path: HexCoord[],
  progress: number,
  hexSize: number,
): PixelCoord => {
  if (path.length <= 1) return hexToPixel(path[0], hexSize);

  // Ease in-out
  const t =
    progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;

  const totalSegments = path.length - 1;
  const pathT = t * totalSegments;
  const segIndex = Math.min(Math.floor(pathT), totalSegments - 1);
  const segT = pathT - segIndex;

  const from = hexToPixel(path[segIndex], hexSize);
  const to = hexToPixel(path[segIndex + 1], hexSize);

  return {
    x: from.x + (to.x - from.x) * segT,
    y: from.y + (to.y - from.y) * segT,
  };
};

// Draw an ordnance velocity vector (dashed line from
// current position to next).
export const drawOrdnanceVelocity = (
  ctx: CanvasRenderingContext2D,
  position: HexCoord,
  velocity: { dq: number; dr: number },
  px: PixelCoord,
  color: string,
  hexSize: number,
): void => {
  if (velocity.dq === 0 && velocity.dr === 0) return;

  const dest = hexToPixel(hexAdd(position, velocity), hexSize);

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(px.x, px.y);
  ctx.lineTo(dest.x, dest.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
