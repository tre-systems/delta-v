import { hexKey, hexToPixel, type PixelCoord } from '../../shared/hex';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type { AnimationState } from './animation-manager';
import {
  drawShipIcon as drawShipIconFn,
  drawThrustTrail as drawThrustTrailFn,
  interpolatePath as interpolatePathFn,
} from './draw';
import {
  buildShipLabelView,
  getDisabledShipLabel,
  getShipHeading,
  getShipIconAlpha,
  getShipIdentityMarker,
  getShipStackOffsets,
  getVisibleShips,
  shouldShowLandedIndicator,
  shouldShowOrbitIndicator,
} from './entities';

export function drawShipsLayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  map: SolarSystemMap | null,
  now: number,
  playerId: number,
  planningSelectedShipId: string | null,
  hexSize: number,
  animState: AnimationState | null,
): void {
  const visibleShips = getVisibleShips(state, playerId, animState !== null);
  const stackOffsets = animState ? null : getShipStackOffsets(visibleShips);

  for (const ship of visibleShips) {
    drawOneShip(
      ctx,
      ship,
      state,
      map,
      now,
      playerId,
      planningSelectedShipId,
      hexSize,
      animState,
      stackOffsets,
    );
  }
}

function drawOneShip(
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  state: GameState,
  map: SolarSystemMap | null,
  now: number,
  playerId: number,
  planningSelectedShipId: string | null,
  hexSize: number,
  animState: AnimationState | null,
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null,
): void {
  const { pos, velocity, labelYOffset } = shipScreenPlacement(
    ship,
    hexSize,
    animState,
    now,
    stackOffsets,
    ctx,
  );
  const heading = getShipHeading(ship.position, velocity, hexSize);
  drawSelectionRingIfNeeded(ctx, ship.id, planningSelectedShipId, pos);
  drawShipIconFn(
    ctx,
    pos.x,
    pos.y,
    ship.owner,
    getShipIconAlpha(ship),
    heading,
    ship.damage.disabledTurns,
    ship.type,
  );
  drawDisabledShipBadge(ctx, ship, pos, animState);
  drawIdentityMarkers(ctx, ship, playerId, state, pos, animState);
  const inGravity = Boolean(map?.hexes.get(hexKey(ship.position))?.gravity);
  drawOrbitAndLandedRings(ctx, ship, pos, now, inGravity, animState);
  drawShipLabels(ctx, ship, playerId, pos, labelYOffset, inGravity, animState);
}

function shipScreenPlacement(
  ship: GameState['ships'][number],
  hexSize: number,
  animState: AnimationState | null,
  now: number,
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null,
  ctx: CanvasRenderingContext2D,
): {
  pos: PixelCoord;
  velocity: GameState['ships'][number]['velocity'];
  labelYOffset: number;
} {
  let pos: PixelCoord;
  let velocity = ship.velocity;
  let labelYOffset = 24;

  if (animState) {
    const movement = animState.movements.find((m) => m.shipId === ship.id);
    if (movement) {
      const progress = Math.min(
        (now - animState.startTime) / animState.duration,
        1,
      );
      pos = interpolatePathFn(movement.path, progress, hexSize);
      velocity = movement.newVelocity;
      maybeDrawThrustDuringMove(ctx, movement, pos, progress, hexSize);
    } else {
      pos = hexToPixel(ship.position, hexSize);
    }
  } else {
    pos = hexToPixel(ship.position, hexSize);
  }

  const stackOffset = stackOffsets?.get(ship.id);
  if (stackOffset) {
    pos = { x: pos.x + stackOffset.xOffset, y: pos.y };
    labelYOffset = stackOffset.labelYOffset;
  }

  return { pos, velocity, labelYOffset };
}

function maybeDrawThrustDuringMove(
  ctx: CanvasRenderingContext2D,
  movement: AnimationState['movements'][number],
  pos: PixelCoord,
  progress: number,
  hexSize: number,
): void {
  if (movement.fuelSpent <= 0 || progress >= 0.8) return;
  const angle = Math.atan2(
    hexToPixel(movement.to, hexSize).y - hexToPixel(movement.from, hexSize).y,
    hexToPixel(movement.to, hexSize).x - hexToPixel(movement.from, hexSize).x,
  );
  drawThrustTrailFn(ctx, pos.x, pos.y, angle + Math.PI, progress);
}

function drawSelectionRingIfNeeded(
  ctx: CanvasRenderingContext2D,
  shipId: string,
  selectedId: string | null,
  pos: PixelCoord,
): void {
  if (shipId !== selectedId) return;
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
  ctx.save();
  ctx.strokeStyle = `rgba(79, 195, 247, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.shadowColor = '#4fc3f7';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDisabledShipBadge(
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  pos: PixelCoord,
  animState: AnimationState | null,
): void {
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
}

function drawIdentityMarkers(
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  playerId: number,
  state: GameState,
  pos: PixelCoord,
  animState: AnimationState | null,
): void {
  const identityMarker = getShipIdentityMarker(
    ship,
    playerId,
    Boolean(state.scenarioRules.hiddenIdentityInspection),
    animState !== null,
  );
  if (identityMarker === 'friendlyFugitive') {
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u2605', pos.x, pos.y - 14);
    return;
  }
  if (identityMarker === 'enemyFugitive' || identityMarker === 'enemyDecoy') {
    ctx.textAlign = 'center';
    if (identityMarker === 'enemyFugitive') {
      ctx.fillStyle = 'rgba(255, 120, 120, 0.95)';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('\u2605', pos.x, pos.y - 14);
    } else {
      ctx.strokeStyle = 'rgba(220, 220, 220, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 14, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawOrbitAndLandedRings(
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  pos: PixelCoord,
  now: number,
  inGravity: boolean,
  animState: AnimationState | null,
): void {
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
}

function drawShipLabels(
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  playerId: number,
  pos: PixelCoord,
  labelYOffset: number,
  inGravity: boolean,
  animState: AnimationState | null,
): void {
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
}
