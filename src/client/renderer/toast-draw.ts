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

export type DrawCombatResultsToastOverlayInput = {
  ctx: CanvasRenderingContext2D;
  results: CombatResult[];
  gameState: GameState;
  now: number;
  screenW: number;
  showUntil: number;
};

export const drawCombatResultsToastOverlay = (
  input: DrawCombatResultsToastOverlayInput,
): void => {
  const { ctx, results, gameState, now, screenW, showUntil } = input;
  if (results.length === 0) return;
  const alpha = getToastFadeAlpha(showUntil, now);
  ctx.save();
  ctx.globalAlpha = alpha;
  let y = 60;
  for (const line of buildCombatResultToastLines(results, must(gameState))) {
    const isSecondary = line.variant === 'secondary';
    ctx.font = isSecondary ? '11px monospace' : 'bold 12px monospace';
    const w = ctx.measureText(line.text).width;
    const x = screenW / 2;
    ctx.fillStyle = isSecondary ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - w / 2 - 8, y - 12, w + 16, isSecondary ? 18 : 20);
    ctx.fillStyle = line.color;
    ctx.textAlign = 'center';
    ctx.fillText(line.text, x, y + 2);
    y += isSecondary ? 24 : 26;
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
