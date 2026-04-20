import { hexKey, hexToPixel, type PixelCoord } from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { AnimationState } from './animation';
import {
  drawShipIcon as drawShipIconFn,
  drawThrustTrail as drawThrustTrailFn,
  interpolatePath as interpolatePathFn,
} from './draw';
import {
  getShipHeading,
  getShipIconAlpha,
  getShipStackOffsets,
  getVisibleShips,
} from './entities';
import {
  drawDisabledShipBadge,
  drawIdentityMarkers,
  drawOrbitAndLandedRings,
  drawShipLabels,
} from './ship-decor';

export type DrawShipsLayerInput = {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  map: SolarSystemMap | null;
  now: number;
  playerId: PlayerId;
  planningSelectedShipId: string | null;
  hexSize: number;
  animState: AnimationState | null;
  zoom: number;
};

type DrawOneShipInput = {
  ctx: CanvasRenderingContext2D;
  ship: GameState['ships'][number];
  state: GameState;
  map: SolarSystemMap | null;
  now: number;
  playerId: PlayerId;
  planningSelectedShipId: string | null;
  hexSize: number;
  animState: AnimationState | null;
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null;
  zoom: number;
};

type ShipScreenPlacementInput = {
  ship: GameState['ships'][number];
  hexSize: number;
  animState: AnimationState | null;
  now: number;
  stackOffsets: ReturnType<typeof getShipStackOffsets> | null;
  ctx: CanvasRenderingContext2D;
};

export const drawShipsLayer = ({
  ctx,
  state,
  map,
  now,
  playerId,
  planningSelectedShipId,
  hexSize,
  animState,
  zoom,
}: DrawShipsLayerInput): void => {
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
      zoom,
    });
  }
};

const drawOneShip = ({
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
  zoom,
}: DrawOneShipInput): void => {
  const { pos, velocity, labelYOffset } = shipScreenPlacement({
    ship,
    hexSize,
    animState,
    now,
    stackOffsets,
    ctx,
  });
  const heading = getShipHeading(
    ship.position,
    velocity,
    hexSize,
    ship.lastBurnDirection,
  );

  drawSelectionRingIfNeeded(ctx, ship.id, planningSelectedShipId, pos);
  drawShipIconFn({
    ctx,
    x: pos.x,
    y: pos.y,
    owner: ship.owner,
    playerId,
    alpha: getShipIconAlpha(ship),
    heading,
    disabledTurns: ship.damage.disabledTurns,
    shipType: ship.type,
  });
  drawDisabledShipBadge(ctx, ship, pos, animState, zoom);
  drawIdentityMarkers({ ctx, ship, playerId, state, pos, animState, zoom });

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
    zoom,
  });
};

const shipScreenPlacement = ({
  ship,
  hexSize,
  animState,
  now,
  stackOffsets,
  ctx,
}: ShipScreenPlacementInput): {
  pos: PixelCoord;
  velocity: GameState['ships'][number]['velocity'];
  labelYOffset: number;
} => {
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
