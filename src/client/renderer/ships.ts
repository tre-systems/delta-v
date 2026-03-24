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

export type DrawShipsLayerInput = {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  map: SolarSystemMap | null;
  now: number;
  playerId: number;
  planningSelectedShipId: string | null;
  hexSize: number;
  animState: AnimationState | null;
};

type DrawOneShipInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  state: GameState;
  map: SolarSystemMap | null;
  now: number;
  playerId: number;
  planningSelectedShipId: string | null;
  hexSize: number;
  animState: AnimationState | null;
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null;
};

type ShipScreenPlacementInput = {
  ship: GameState['ships'][number];
  hexSize: number;
  animState: AnimationState | null;
  now: number;
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null;
  ctx: CanvasRenderingContext2D;
};

export const drawShipsLayer = (input: DrawShipsLayerInput): void => {
  const {
    ctx,
    state,
    map,
    now,
    playerId,
    planningSelectedShipId,
    hexSize,
    animState,
  } = input;
  const visibleShips = getVisibleShips(state, playerId, animState !== null);
  const stackOffsets = animState ? null : getShipStackOffsets(visibleShips);

  for (const ship of visibleShips) {
    drawOneShip({
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
    });
  }
};

const drawOneShip = (input: DrawOneShipInput): void => {
  const {
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
  } = input;
  const { pos, velocity, labelYOffset } = shipScreenPlacement({
    ship,
    hexSize,
    animState,
    now,
    stackOffsets,
    ctx,
  });
  const heading = getShipHeading(ship.position, velocity, hexSize);

  drawSelectionRingIfNeeded(ctx, ship.id, planningSelectedShipId, pos);
  drawShipIconFn({
    ctx,
    x: pos.x,
    y: pos.y,
    owner: ship.owner,
    alpha: getShipIconAlpha(ship),
    heading,
    disabledTurns: ship.damage.disabledTurns,
    shipType: ship.type,
  });
  drawDisabledShipBadge(ctx, ship, pos, animState);
  drawIdentityMarkers({ ctx, ship, playerId, state, pos, animState });

  const inGravity = Boolean(map?.hexes.get(hexKey(ship.position))?.gravity);

  drawOrbitAndLandedRings({
    ctx,
    ship,
    pos,
    now,
    inGravity,
    animState,
  });
  drawShipLabels({
    ctx,
    ship,
    playerId,
    pos,
    labelYOffset,
    inGravity,
    animState,
  });
};

const shipScreenPlacement = (
  input: ShipScreenPlacementInput,
): {
  pos: PixelCoord;
  velocity: GameState['ships'][number]['velocity'];
  labelYOffset: number;
} => {
  const { ship, hexSize, animState, now, stackOffsets, ctx } = input;
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
};

const maybeDrawThrustDuringMove = (
  ctx: CanvasRenderingContext2D,
  movement: AnimationState['movements'][number],
  pos: PixelCoord,
  progress: number,
  hexSize: number,
): void => {
  if (movement.fuelSpent <= 0 || progress >= 0.8) return;

  const fromPx = hexToPixel(movement.from, hexSize);
  const toPx = hexToPixel(movement.to, hexSize);
  const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);

  drawThrustTrailFn(ctx, pos.x, pos.y, angle + Math.PI, progress);
};

const drawSelectionRingIfNeeded = (
  ctx: CanvasRenderingContext2D,
  shipId: string,
  selectedId: string | null,
  pos: PixelCoord,
): void => {
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
};

const drawDisabledShipBadge = (
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

type DrawIdentityMarkersInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  playerId: number;
  state: GameState;
  pos: PixelCoord;
  animState: AnimationState | null;
};

const drawIdentityMarkers = (input: DrawIdentityMarkersInput): void => {
  const { ctx, ship, playerId, state, pos, animState } = input;
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

type DrawOrbitAndLandedRingsInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  pos: PixelCoord;
  now: number;
  inGravity: boolean;
  animState: AnimationState | null;
};

const drawOrbitAndLandedRings = (input: DrawOrbitAndLandedRingsInput): void => {
  const { ctx, ship, pos, now, inGravity, animState } = input;
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

type DrawShipLabelsInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  playerId: number;
  pos: PixelCoord;
  labelYOffset: number;
  inGravity: boolean;
  animState: AnimationState | null;
};

const drawShipLabels = (input: DrawShipLabelsInput): void => {
  const { ctx, ship, playerId, pos, labelYOffset, inGravity, animState } =
    input;
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
