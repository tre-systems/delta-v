import { hexKey, hexToPixel, type PixelCoord } from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { AnimationState } from './animation';
import { drawShipIcon, drawThrustTrail, interpolatePath } from './draw';
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
import { scaledFont } from './text';
import { minScreenScale, screenDash, screenLineWidth } from './visibility';

export type DrawShipsLayerInput = {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  map: SolarSystemMap | null;
  now: number;
  playerId: PlayerId;
  planningSelectedShipId: string | null;
  planningSelectedShipIds?: ReadonlySet<string>;
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
  planningSelectedShipIds?: ReadonlySet<string>;
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
  planningSelectedShipIds,
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
      planningSelectedShipIds,
      hexSize,
      animState,
      stackOffsets,
      zoom,
    });
  }

  // Stack-count badges: a small numeral on any own hex holding more than
  // one ship, so overlapping ships read as a countable group at a glance.
  if (!animState) {
    drawOwnStackBadges(ctx, visibleShips, playerId, hexSize, zoom);
  }
};

const drawOwnStackBadges = (
  ctx: CanvasRenderingContext2D,
  ships: GameState['ships'],
  playerId: PlayerId,
  hexSize: number,
  zoom: number,
): void => {
  const counts = new Map<string, { count: number; pos: PixelCoord }>();

  for (const ship of ships) {
    if (ship.owner !== playerId || ship.lifecycle === 'destroyed') continue;
    const key = hexKey(ship.position);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { count: 1, pos: hexToPixel(ship.position, hexSize) });
    }
  }

  for (const { count, pos } of counts.values()) {
    if (count < 2) continue;

    // The camera transform already scales world coordinates by `zoom`.
    // Use inverse-scaled metrics so this UI badge remains a readable,
    // stable screen size instead of being scaled twice.
    const inverseZoom = 1 / zoom;
    const r = 8 * inverseZoom;
    const x = pos.x + 15 * inverseZoom;
    const y = pos.y - 15 * inverseZoom;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 22, 40, 0.92)';
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
    ctx.lineWidth = screenLineWidth(1.5, zoom);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dcefff';
    ctx.font = scaledFont('bold 11px system-ui, sans-serif', zoom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), x, y + 0.5 * inverseZoom);
    ctx.restore();
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
  planningSelectedShipIds,
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
  drawFleetGroupRingIfNeeded(
    ctx,
    ship.id,
    planningSelectedShipId,
    planningSelectedShipIds,
    pos,
    zoom,
  );
  drawShipIcon({
    ctx,
    x: pos.x,
    y: pos.y,
    owner: ship.owner,
    playerId,
    alpha: getShipIconAlpha(ship),
    heading,
    disabledTurns: ship.damage.disabledTurns,
    shipType: ship.type,
    zoom,
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
    zoom,
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
      pos = interpolatePath(movement.path, progress, hexSize);
      velocity = movement.newVelocity;
      maybeDrawThrustDuringMove(ctx, ship, movement, pos, progress, hexSize);
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

// Flame should always emit from the rear of the ship icon, regardless
// of the direction of travel — gravity-assist arcs and sideways drift
// made the old "flip the travel vector" heuristic look wrong because
// the ship icon is oriented by its heading, not its velocity. Anchor
// the exhaust to the rear of the ship body so the visual always reads
// as "thrust out the back."
const maybeDrawThrustDuringMove = (
  ctx: CanvasRenderingContext2D,
  ship: GameState['ships'][number],
  movement: AnimationState['movements'][number],
  pos: PixelCoord,
  progress: number,
  hexSize: number,
): void => {
  if (movement.fuelSpent <= 0 || progress >= 0.8) return;

  // Use the same heading the ship icon is rendered with so the flame
  // is guaranteed to line up with the back of the hull.
  const heading = getShipHeading(
    ship.position,
    movement.newVelocity,
    hexSize,
    ship.lastBurnDirection,
  );
  // Rear-of-hull offset. The arrow sprite's back edge sits at roughly
  // -0.6 * size along the local +x axis (see drawShipIcon). Use the
  // midpoint of that range so the flame emerges just past the rear
  // edge without leaving a visible gap for stubby corvette sprites.
  const rearOffsetPx = 7;
  const rearDirectionAngle = heading + Math.PI;
  const originX = pos.x + Math.cos(rearDirectionAngle) * rearOffsetPx;
  const originY = pos.y + Math.sin(rearDirectionAngle) * rearOffsetPx;

  drawThrustTrail(ctx, originX, originY, rearDirectionAngle, progress);
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

// Dimmer, non-pulsing ring for fleet-group members other than the primary
// (which already gets the bright selection ring), so a multi-ship steer
// group reads as a set without competing with the focused ship.
const drawFleetGroupRingIfNeeded = (
  ctx: CanvasRenderingContext2D,
  shipId: string,
  selectedId: string | null,
  groupIds: ReadonlySet<string> | undefined,
  pos: PixelCoord,
  zoom: number,
): void => {
  if (!groupIds || groupIds.size < 2) return;
  if (shipId === selectedId || !groupIds.has(shipId)) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.55)';
  ctx.lineWidth = screenLineWidth(2, zoom);
  ctx.setLineDash(screenDash([4, 3], zoom));
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 15 * minScreenScale(zoom), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};
