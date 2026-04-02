// Gameplay overlay Canvas drawing: ordnance, torpedo
// guidance, combat overlay.
// Pure functions extracted from Renderer — no class
// state dependencies.

import {
  HEX_DIRECTIONS,
  type HexCoord,
  hexAdd,
  hexToPixel,
  type PixelCoord,
} from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { PlanningState } from '../game/planning';
import type { AnimationState } from './animation';
import {
  getCombatOverlayHighlights,
  getCombatPreview,
  getQueuedCombatOverlayAttacks,
} from './combat';
import { drawOrdnanceVelocity } from './draw';
import {
  getDetonatedOrdnanceOverlay,
  getOrdnanceColor,
  getOrdnanceHeading,
  getOrdnanceLifetimeView,
  getOrdnancePulse,
} from './entities';
import { scaledFont } from './text';

export interface RenderOrdnanceInput {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  playerId: PlayerId;
  animState: AnimationState | null;
  hexSize: number;
  now: number;
  interpolatePath: (path: HexCoord[], progress: number) => PixelCoord;
  zoom: number;
}

export const renderOrdnance = ({
  ctx,
  state,
  playerId,
  animState,
  hexSize,
  now,
  interpolatePath,
  zoom,
}: RenderOrdnanceInput): void => {
  if (!state.ordnance || state.ordnance.length === 0) {
    return;
  }

  for (const ord of state.ordnance) {
    if (ord.lifecycle === 'destroyed') continue;

    const p: PixelCoord = (() => {
      if (animState) {
        const om = animState.ordnanceMovements.find(
          (m) => m.ordnanceId === ord.id,
        );

        if (om) {
          const progress = Math.min(
            (now - animState.startTime) / animState.duration,
            1,
          );

          return interpolatePath(om.path, progress);
        }
      }

      return hexToPixel(ord.position, hexSize);
    })();

    const color = getOrdnanceColor(ord.owner, playerId);
    const pulse = getOrdnancePulse(now);
    const isFriendly = ord.owner === playerId;

    if (ord.type === 'nuke') {
      const s = 7;
      const nukeColor = '#ff4444';

      ctx.fillStyle = nukeColor;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#ff8888';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (ord.type === 'mine') {
      const s = 5;
      const mineColor = isFriendly ? '#4fc3f7' : '#ff9800';

      // Mine glow
      ctx.save();
      ctx.shadowBlur = 4;
      ctx.shadowColor = mineColor;
      ctx.fillStyle = mineColor;
      ctx.globalAlpha = 0.4 + pulse * 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      const heading = getOrdnanceHeading(ord.position, ord.velocity, hexSize);
      const s = 6;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(heading);
      ctx.fillStyle = color;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.6, -s * 0.4);
      ctx.lineTo(-s * 0.6, s * 0.4);
      ctx.closePath();
      ctx.fill();

      // Torpedo glow
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    if (!animState) {
      drawOrdnanceVelocity(ctx, ord.position, ord.velocity, p, color, hexSize);

      // Labels for clarity
      ctx.fillStyle = color;
      ctx.font = scaledFont('bold 9px Inter, sans-serif', zoom);
      ctx.textAlign = 'center';
      const labelY = ord.type === 'mine' ? p.y - 10 : p.y - 12;
      const typeLabel = ord.type.toUpperCase();
      ctx.fillText(typeLabel, p.x, labelY);

      const ownershipLabel = isFriendly ? 'FRIENDLY' : 'ENEMY';
      ctx.font = scaledFont('7px Inter, sans-serif', zoom);
      ctx.fillText(ownershipLabel, p.x, labelY - 7);
    }

    const lifetimeView = getOrdnanceLifetimeView(
      ord.turnsRemaining,
      animState !== null,
    );

    if (lifetimeView) {
      ctx.fillStyle = lifetimeView.color;
      ctx.font = scaledFont('bold 12px monospace', zoom);
      ctx.textAlign = 'center';
      ctx.fillText(lifetimeView.text, p.x, p.y + 12);
    }
  }

  if (animState) {
    const progress = Math.min(
      (now - animState.startTime) / animState.duration,
      1,
    );

    for (const om of animState.ordnanceMovements) {
      if (!om.detonated) continue;

      const overlay = getDetonatedOrdnanceOverlay(progress);

      if (!overlay) continue;

      if (overlay.kind === 'diamond') {
        const p = interpolatePath(om.path, progress);

        ctx.fillStyle = overlay.color;
        ctx.globalAlpha = overlay.alpha;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - overlay.size);
        ctx.lineTo(p.x + overlay.size, p.y);
        ctx.lineTo(p.x, p.y + overlay.size);
        ctx.lineTo(p.x - overlay.size, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        const detP = hexToPixel(om.to, hexSize);

        ctx.fillStyle = overlay.color;
        ctx.globalAlpha = overlay.alpha;
        ctx.beginPath();
        ctx.arc(detP.x, detP.y, overlay.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
};

export interface RenderTorpedoGuidanceInput {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  playerId: PlayerId;
  planningState: PlanningState;
  isAnimating: boolean;
  hexSize: number;
  now: number;
  zoom: number;
}

export const renderTorpedoGuidance = ({
  ctx,
  state,
  playerId,
  planningState,
  isAnimating,
  hexSize,
  now: _now,
  zoom,
}: RenderTorpedoGuidanceInput): void => {
  if (state.phase !== 'ordnance' || state.activePlayer !== playerId) {
    return;
  }

  if (isAnimating) return;

  const selectedId = planningState.selectedShipId;

  if (!selectedId) return;

  const ship = state.ships.find((s) => s.id === selectedId);

  if (!ship || ship.lifecycle !== 'active') return;

  if (!planningState.torpedoAimingActive) return;

  const shipPos = hexToPixel(ship.position, hexSize);
  const accel = planningState.torpedoAccel;
  const accelSteps = planningState.torpedoAccelSteps;

  const isX2 = accelSteps === 2;

  for (let d = 0; d < 6; d++) {
    const targetHex = hexAdd(ship.position, HEX_DIRECTIONS[d]);
    const tp = hexToPixel(targetHex, hexSize);
    const isActive = accel === d;

    ctx.fillStyle = isActive
      ? isX2
        ? 'rgba(255, 60, 60, 0.7)'
        : 'rgba(255, 120, 60, 0.6)'
      : 'rgba(255, 120, 60, 0.12)';
    ctx.strokeStyle = isActive
      ? isX2
        ? '#ff4444'
        : '#ff7744'
      : 'rgba(255, 120, 60, 0.3)';
    ctx.lineWidth = isActive ? 2 : 1.5;

    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isActive && isX2) {
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (isActive) {
      ctx.strokeStyle = isX2
        ? 'rgba(255, 60, 60, 0.5)'
        : 'rgba(255, 120, 60, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shipPos.x, shipPos.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 240, 200, 0.95)';
      ctx.font = scaledFont('bold 12px monospace', zoom);
      ctx.fillText(`\u00d7${accelSteps ?? 1}`, tp.x, tp.y + 4);
    }
  }

  ctx.fillStyle = 'rgba(255, 120, 60, 0.9)';
  ctx.font = scaledFont('11px monospace', zoom);
  ctx.textAlign = 'center';

  if (accel !== null) {
    const hint = isX2 ? 'click again to cancel' : 'click again for \u00d72';
    ctx.fillText(
      `TORPEDO \u00d7${accelSteps ?? 1} \u2014 ${hint}`,
      shipPos.x,
      shipPos.y - 20,
    );
  } else {
    ctx.fillText(
      'Click direction for torpedo boost',
      shipPos.x,
      shipPos.y - 20,
    );
  }
};

export interface RenderCombatOverlayInput {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  playerId: PlayerId;
  planningState: PlanningState;
  map: SolarSystemMap | null;
  isAnimating: boolean;
  hexSize: number;
  now: number;
  zoom: number;
}

export const renderCombatOverlay = ({
  ctx,
  state,
  playerId,
  planningState,
  map,
  isAnimating,
  hexSize,
  now,
  zoom,
}: RenderCombatOverlayInput): void => {
  if (state.phase !== 'combat' || state.activePlayer !== playerId) {
    return;
  }

  if (isAnimating) return;

  const pulse = 0.5 + 0.3 * Math.sin(now / 300);

  // Queued attacks
  for (const queued of getQueuedCombatOverlayAttacks(
    state,
    planningState.queuedAttacks,
  )) {
    const targetPos = hexToPixel(queued.targetPosition, hexSize);

    for (const attackerPosition of queued.attackerPositions) {
      const attackerPos = hexToPixel(attackerPosition, hexSize);

      ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(attackerPos.x, attackerPos.y);
      ctx.lineTo(targetPos.x, targetPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(255, 80, 80, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(targetPos.x, targetPos.y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Highlights
  const highlights = getCombatOverlayHighlights(
    state,
    playerId,
    planningState,
    map,
  );

  for (const ship of highlights.shipTargets) {
    const p = hexToPixel(ship.position, hexSize);

    ctx.strokeStyle = ship.isSelected
      ? `rgba(255, 80, 80, ${0.8 + pulse * 0.2})`
      : `rgba(255, 80, 80, ${0.2 + pulse * 0.15})`;
    ctx.lineWidth = ship.isSelected ? 2.5 : 1.5;

    ctx.beginPath();
    ctx.arc(p.x, p.y, ship.isSelected ? 16 : 13, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const ordnance of highlights.ordnanceTargets) {
    const p = hexToPixel(ordnance.position, hexSize);

    ctx.strokeStyle = ordnance.isSelected
      ? `rgba(255, 210, 80, ${0.8 + pulse * 0.2})`
      : `rgba(255, 210, 80, ${0.2 + pulse * 0.15})`;
    ctx.lineWidth = ordnance.isSelected ? 2.5 : 1.5;

    ctx.beginPath();
    ctx.rect(
      p.x - (ordnance.isSelected ? 10 : 8),
      p.y - (ordnance.isSelected ? 10 : 8),
      ordnance.isSelected ? 20 : 16,
      ordnance.isSelected ? 20 : 16,
    );
    ctx.stroke();
  }

  // Preview
  const preview = getCombatPreview(state, playerId, planningState, map);

  if (preview === null) return;

  const targetPos = hexToPixel(preview.targetPosition, hexSize);

  for (const attackerPosition of preview.attackerPositions) {
    const attackerPos = hexToPixel(attackerPosition, hexSize);

    ctx.strokeStyle = 'rgba(79, 195, 247, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(attackerPos.x, attackerPos.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const attackerPosition of preview.attackerPositions) {
    const attackerPos = hexToPixel(attackerPosition, hexSize);

    ctx.strokeStyle = 'rgba(255, 80, 80, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(attackerPos.x, attackerPos.y);
    ctx.lineTo(targetPos.x, targetPos.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.textAlign = 'center';

  // Main odds label (e.g. "1:1  ATK 2/2")
  ctx.font = scaledFont('bold 12px monospace', zoom);
  const oddsW = ctx.measureText(preview.label).width;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(targetPos.x - oddsW / 2 - 5, targetPos.y - 32, oddsW + 10, 16);
  ctx.fillStyle = '#ffdd57';
  ctx.fillText(preview.label, targetPos.x, targetPos.y - 20);

  // Compact sub-label: modifier and/or counter icon
  const hasInfo = preview.modLabel || preview.canCounter;
  if (hasInfo) {
    const counterIcon = preview.canCounter ? '\u2694' : '';
    const subParts = [preview.modLabel, counterIcon].filter(Boolean).join(' ');

    ctx.font = scaledFont('bold 11px monospace', zoom);
    const subW = ctx.measureText(subParts).width;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(targetPos.x - subW / 2 - 4, targetPos.y - 46, subW + 8, 13);

    // Draw modifier in its color, counter icon in orange
    if (preview.modLabel && preview.canCounter) {
      const modW = ctx.measureText(preview.modLabel).width;
      const gap = ctx.measureText(' ').width;
      const totalW = subW;
      const startX = targetPos.x - totalW / 2;

      ctx.fillStyle = preview.modColor;
      ctx.fillText(preview.modLabel, startX + modW / 2, targetPos.y - 36);

      ctx.fillStyle = 'rgba(255, 170, 0, 0.9)';
      ctx.fillText(
        counterIcon,
        startX + modW + gap + ctx.measureText(counterIcon).width / 2,
        targetPos.y - 36,
      );
    } else if (preview.modLabel) {
      ctx.fillStyle = preview.modColor;
      ctx.fillText(preview.modLabel, targetPos.x, targetPos.y - 36);
    } else {
      ctx.fillStyle = 'rgba(255, 170, 0, 0.9)';
      ctx.fillText(counterIcon, targetPos.x, targetPos.y - 36);
    }
  }
};
