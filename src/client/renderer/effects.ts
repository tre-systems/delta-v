/**
 * Combat visual effects and hex flash rendering.
 * Pure Canvas drawing functions extracted from Renderer.
 */

import type { PixelCoord } from '../../shared/hex';

export interface CombatEffect {
  type: 'beam' | 'explosion' | 'gameOverExplosion';
  from: PixelCoord;
  to: PixelCoord;
  startTime: number;
  duration: number;
  color: string;
}

export interface HexFlash {
  position: PixelCoord;
  startTime: number;
  duration: number;
  color: string;
}

/**
 * Render and prune active combat visual effects (beams, explosions, game-over blasts).
 * Returns the filtered array with expired effects removed.
 */
export const drawCombatEffects = (
  ctx: CanvasRenderingContext2D,
  effects: CombatEffect[],
  now: number,
): CombatEffect[] => {
  const live = effects.filter((e) => now < e.startTime + e.duration);

  for (const effect of live) {
    if (now < effect.startTime) continue;
    const progress = (now - effect.startTime) / effect.duration;

    if (effect.type === 'beam') {
      drawBeamEffect(ctx, effect, progress);
    } else if (effect.type === 'explosion') {
      drawExplosionEffect(ctx, effect, progress);
    } else if (effect.type === 'gameOverExplosion') {
      drawGameOverExplosionEffect(ctx, effect, progress);
    }
  }

  return live;
};

const drawBeamEffect = (ctx: CanvasRenderingContext2D, effect: CombatEffect, progress: number): void => {
  const beamAlpha = 1 - progress;
  const beamProgress = Math.min(progress * 3, 1);

  ctx.strokeStyle = effect.color;
  ctx.globalAlpha = beamAlpha * 0.8;
  ctx.lineWidth = 2 * (1 - progress);
  ctx.beginPath();
  ctx.moveTo(effect.from.x, effect.from.y);
  ctx.lineTo(
    effect.from.x + (effect.to.x - effect.from.x) * beamProgress,
    effect.from.y + (effect.to.y - effect.from.y) * beamProgress,
  );
  ctx.stroke();

  // Glow line
  ctx.globalAlpha = beamAlpha * 0.3;
  ctx.lineWidth = 6 * (1 - progress);
  ctx.beginPath();
  ctx.moveTo(effect.from.x, effect.from.y);
  ctx.lineTo(
    effect.from.x + (effect.to.x - effect.from.x) * beamProgress,
    effect.from.y + (effect.to.y - effect.from.y) * beamProgress,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;
};

const drawExplosionEffect = (ctx: CanvasRenderingContext2D, effect: CombatEffect, progress: number): void => {
  const maxRadius = 20;
  const radius = maxRadius * progress;
  const alpha = 1 - progress;

  ctx.strokeStyle = effect.color;
  ctx.lineWidth = 3 * (1 - progress);
  ctx.globalAlpha = alpha * 0.8;
  ctx.beginPath();
  ctx.arc(effect.from.x, effect.from.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (progress < 0.3) {
    ctx.fillStyle = effect.color;
    ctx.globalAlpha = (1 - progress / 0.3) * 0.6;
    ctx.beginPath();
    ctx.arc(effect.from.x, effect.from.y, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const drawGameOverExplosionEffect = (ctx: CanvasRenderingContext2D, effect: CombatEffect, progress: number): void => {
  const maxRadius = 50;
  const alpha = 1 - progress;

  // Outer expanding ring
  const outerRadius = maxRadius * progress;
  ctx.strokeStyle = effect.color;
  ctx.lineWidth = 4 * (1 - progress);
  ctx.globalAlpha = alpha * 0.7;
  ctx.beginPath();
  ctx.arc(effect.from.x, effect.from.y, outerRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Second ring (slightly behind)
  if (progress > 0.1) {
    const innerProgress = (progress - 0.1) / 0.9;
    const innerRadius = maxRadius * 0.7 * innerProgress;
    ctx.lineWidth = 3 * (1 - innerProgress);
    ctx.globalAlpha = (1 - innerProgress) * 0.5;
    ctx.beginPath();
    ctx.arc(effect.from.x, effect.from.y, innerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bright core flash
  if (progress < 0.4) {
    const coreAlpha = 1 - progress / 0.4;
    const coreRadius = 15 * (1 - progress * 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = coreAlpha * 0.8;
    ctx.beginPath();
    ctx.arc(effect.from.x, effect.from.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = effect.color;
    ctx.globalAlpha = coreAlpha * 0.4;
    ctx.beginPath();
    ctx.arc(effect.from.x, effect.from.y, coreRadius * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Debris lines radiating outward
  if (progress > 0.05 && progress < 0.8) {
    const debrisAlpha = progress < 0.4 ? 1 : (0.8 - progress) / 0.4;
    ctx.strokeStyle = effect.color;
    ctx.globalAlpha = debrisAlpha * 0.6;
    ctx.lineWidth = 1.5;
    const seed = (effect.from.x * 7 + effect.from.y * 13) | 0;
    for (let d = 0; d < 8; d++) {
      const angle = (seed + d * 0.785) % (Math.PI * 2);
      const innerR = maxRadius * progress * 0.3;
      const outerR = maxRadius * progress * 0.7;
      ctx.beginPath();
      ctx.moveTo(effect.from.x + Math.cos(angle) * innerR, effect.from.y + Math.sin(angle) * innerR);
      ctx.lineTo(effect.from.x + Math.cos(angle) * outerR, effect.from.y + Math.sin(angle) * outerR);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
};

/**
 * Render and prune hex flash highlights.
 * Returns the filtered array with expired flashes removed.
 */
export const drawHexFlashes = (
  ctx: CanvasRenderingContext2D,
  flashes: HexFlash[],
  now: number,
  hexSize: number,
): HexFlash[] => {
  const live = flashes.filter((f) => now < f.startTime + f.duration);

  for (const flash of live) {
    if (now < flash.startTime) continue;
    const progress = (now - flash.startTime) / flash.duration;
    const alpha = (1 - progress) * 0.6;
    const radius = hexSize * (0.5 + progress * 0.5);

    ctx.beginPath();
    ctx.arc(flash.position.x, flash.position.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = flash.color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.fill();
    ctx.strokeStyle = flash.color;
    ctx.lineWidth = 2 * (1 - progress);
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  return live;
};
