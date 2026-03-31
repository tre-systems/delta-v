import { must } from '../../shared/assert';
import type {
  CombatResult,
  GameState,
  MovementEvent,
} from '../../shared/types/domain';
import {
  buildCombatResultToastLines,
  formatMovementEventToast,
  getToastFadeAlpha,
} from './toast';

// Duration of the die rolling animation in ms.
const ROLL_DURATION = 700;

// Standard die pip positions for values 1-6.
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

// Draw a die face with pips on the canvas.
const drawDieFace = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  value: number,
  size: number,
): void => {
  const half = size / 2;
  const r = size * 0.15;

  // Die body
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.roundRect(cx - half, cy - half, size, size, size * 0.15);
  ctx.fill();

  // Pips
  ctx.fillStyle = '#111';
  const pips = PIP_LAYOUTS[value] ?? PIP_LAYOUTS[1];
  const spread = size * 0.28;
  for (const [px, py] of pips) {
    ctx.beginPath();
    ctx.arc(cx + px * spread, cy + py * spread, r, 0, Math.PI * 2);
    ctx.fill();
  }
};

export type DrawCombatResultsToastOverlayInput = {
  ctx: CanvasRenderingContext2D;
  results: CombatResult[];
  gameState: GameState;
  now: number;
  screenW: number;
  showStart: number;
  showUntil: number;
};

export const drawCombatResultsToastOverlay = (
  input: DrawCombatResultsToastOverlayInput,
): void => {
  const { ctx, results, gameState, now, screenW, showStart, showUntil } = input;
  if (results.length === 0) return;

  const elapsed = now - showStart;
  const rollProgress = Math.min(elapsed / ROLL_DURATION, 1);
  const alpha = getToastFadeAlpha(showUntil, now);

  ctx.save();
  ctx.globalAlpha = alpha;

  const centerX = screenW / 2;

  if (rollProgress < 1) {
    // Rolling phase — show animated die
    const dieRoll = results[0].dieRoll;
    const dieSize = 36;

    // Cycle through random values, settling on the real one
    const cycleSpeed = 4 + rollProgress * 12;
    const displayValue =
      rollProgress > 0.85
        ? dieRoll
        : (Math.floor(elapsed * cycleSpeed * 0.01) % 6) + 1;

    // Slight shake that dampens
    const shake = (1 - rollProgress) * 3;
    const shakeX = Math.sin(elapsed * 0.03) * shake;
    const shakeY = Math.cos(elapsed * 0.04) * shake;

    drawDieFace(ctx, centerX + shakeX, 60 + shakeY, displayValue, dieSize);

    // "Rolling..." label
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText(
      rollProgress > 0.85 ? `Rolled ${dieRoll}!` : 'Rolling...',
      centerX,
      60 + dieSize / 2 + 16,
    );
  } else {
    // Result phase — show final die + result text
    const settleProgress = Math.min((elapsed - ROLL_DURATION) / 200, 1);
    const scale = 1 + (1 - settleProgress) * 0.15;
    const dieRoll = results[0].dieRoll;

    // Draw settled die (shrinking from pop)
    ctx.save();
    ctx.translate(centerX, 60);
    ctx.scale(scale, scale);
    drawDieFace(ctx, 0, 0, dieRoll, 32);
    ctx.restore();

    // Result text lines below the die
    let y = 98;
    for (const line of buildCombatResultToastLines(results, must(gameState))) {
      const isSecondary = line.variant === 'secondary';
      ctx.font = isSecondary ? '11px monospace' : 'bold 12px monospace';
      const w = ctx.measureText(line.text).width;
      ctx.fillStyle = isSecondary
        ? 'rgba(0, 0, 0, 0.65)'
        : 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(centerX - w / 2 - 8, y - 12, w + 16, isSecondary ? 18 : 20);
      ctx.fillStyle = line.color;
      ctx.textAlign = 'center';
      ctx.fillText(line.text, centerX, y + 2);
      y += isSecondary ? 24 : 26;
    }
  }

  ctx.restore();
};

export type DrawMovementEventsToastOverlayInput = {
  ctx: CanvasRenderingContext2D;
  events: MovementEvent[];
  gameState: GameState | null;
  now: number;
  screenW: number;
  showUntil: number;
};

export const drawMovementEventsToastOverlay = (
  input: DrawMovementEventsToastOverlayInput,
): void => {
  const { ctx, events, gameState, now, screenW, showUntil } = input;
  if (events.length === 0) return;
  const alpha = getToastFadeAlpha(showUntil, now);
  ctx.save();
  ctx.globalAlpha = alpha;
  let y = 60;
  for (const ev of events) {
    const ship = gameState?.ships.find((s) => s.id === ev.shipId);
    const shipName = ship ? ship.type : ev.shipId;
    const line = formatMovementEventToast(ev, shipName);
    if (!line) continue;
    ctx.font = 'bold 12px monospace';
    const w = ctx.measureText(line.text).width;
    const x = screenW / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, 20);
    ctx.fillStyle = line.color;
    ctx.textAlign = 'center';
    ctx.fillText(line.text, x, y + 2);
    y += 26;
  }
  ctx.restore();
};
