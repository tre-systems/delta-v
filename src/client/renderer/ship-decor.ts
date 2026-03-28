import type { PixelCoord } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { AnimationState } from './animation';
import {
  buildShipLabelView,
  getDisabledShipLabel,
  getShipIdentityMarker,
  shouldShowLandedIndicator,
  shouldShowOrbitIndicator,
} from './entities';

type DrawIdentityMarkersInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  playerId: PlayerId;
  state: GameState;
  pos: PixelCoord;
  animState: AnimationState | null;
};

type DrawOrbitAndLandedRingsInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  pos: PixelCoord;
  now: number;
  inGravity: boolean;
  animState: AnimationState | null;
};

type DrawShipLabelsInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  playerId: PlayerId;
  pos: PixelCoord;
  labelYOffset: number;
  inGravity: boolean;
  animState: AnimationState | null;
};

export const drawDisabledShipBadge = (
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  pos: PixelCoord,
  animState: AnimationState | null,
): void => {
  const disabledLabel = getDisabledShipLabel(ship, animState !== null);

  if (!disabledLabel) return;

  ctx.font = 'bold 9px Inter, sans-serif';
  ctx.textAlign = 'left';
  const labelX = pos.x + 12;
  const labelY = pos.y - 12;
  const metrics = ctx.measureText(disabledLabel);
  const pad = 3;

  ctx.fillStyle = 'rgba(180, 20, 20, 0.6)';
  ctx.beginPath();
  ctx.roundRect(
    labelX - pad,
    labelY - 8 - pad,
    metrics.width + pad * 2,
    10 + pad * 2,
    3,
  );
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(disabledLabel, labelX, labelY);
};

export const drawIdentityMarkers = ({
  ctx,
  ship,
  playerId,
  state,
  pos,
  animState,
}: DrawIdentityMarkersInput): void => {
  const identityMarker = getShipIdentityMarker(
    ship,
    playerId,
    Boolean(state.scenarioRules.hiddenIdentityInspection),
    animState !== null,
  );

  if (identityMarker === null) return;

  switch (identityMarker) {
    case 'friendlyFugitive':
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u2605', pos.x, pos.y - 14);
      break;

    case 'enemyFugitive':
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 120, 120, 0.95)';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('\u2605', pos.x, pos.y - 14);
      break;

    case 'enemyDecoy':
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(220, 220, 220, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 14, 4, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
};

export const drawOrbitAndLandedRings = ({
  ctx,
  ship,
  pos,
  now,
  inGravity,
  animState,
}: DrawOrbitAndLandedRingsInput): void => {
  if (shouldShowOrbitIndicator(ship, inGravity, animState !== null)) {
    const phase = now / 2000 + pos.x * 0.01;

    ctx.strokeStyle = 'rgba(150, 200, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 16, phase, phase + Math.PI * 1.5);
    ctx.stroke();
  }

  if (shouldShowLandedIndicator(ship, animState !== null)) {
    ctx.strokeStyle = 'rgba(100, 200, 100, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
};

export const drawShipLabels = ({
  ctx,
  ship,
  playerId,
  pos,
  labelYOffset,
  inGravity,
  animState,
}: DrawShipLabelsInput): void => {
  const labelView = buildShipLabelView(
    ship,
    playerId,
    inGravity,
    animState !== null,
  );

  if (!labelView) return;

  ctx.textAlign = 'center';
  ctx.fillStyle = labelView.typeColor;
  ctx.font = labelView.typeFont;
  ctx.fillText(labelView.typeName, pos.x, pos.y + labelYOffset);

  if (labelView.statusTag && labelView.statusColor && labelView.statusFont) {
    ctx.fillStyle = labelView.statusColor;
    ctx.font = labelView.statusFont;
    ctx.fillText(labelView.statusTag, pos.x, pos.y + labelYOffset + 9);
  }
};
