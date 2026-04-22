import { SHIP_STATS, type ShipType } from '../../shared/constants';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  hexAdd,
  hexEqual,
  hexKey,
  hexToPixel,
  hexVecLength,
  type PixelCoord,
} from '../../shared/hex';
import { computeCourse, predictDestination } from '../../shared/movement';
import type {
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { MOBILE_BREAKPOINT_PX } from '../ui-breakpoints';

export interface CoursePreviewPlanningState {
  selectedShipId: string | null;
  burns: Map<string, number | null>;
  overloads: Map<string, number | null>;
  landingShips?: Set<string>;
  weakGravityChoices: Map<string, Record<string, boolean>>;
  hoverHex: HexCoord | null;
}

export interface CourseMarkerView {
  position: PixelCoord;
  size: number;
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  shadowBlur: number;
  shadowColor: string | null;
  label: string | null;
  labelColor: string | null;
}

export interface CourseArrowView {
  from: PixelCoord;
  to: PixelCoord;
  headLeft: PixelCoord;
  headRight: PixelCoord;
  color: string;
  lineWidth: number;
}

export interface WeakGravityMarkerView {
  position: PixelCoord;
  fillColor: string;
  strokeColor: string;
  labelColor: string;
  strikeFrom: PixelCoord | null;
  strikeTo: PixelCoord | null;
}

export interface GhostShipView {
  position: PixelCoord;
  owner: PlayerId;
  shipType: ShipType;
  alpha: number;
  heading: number;
}

export interface FuelCostLabelView {
  position: PixelCoord;
  text: string;
  color: string;
}

export interface DriftSegment {
  points: PixelCoord[];
  color: string;
  alpha: number;
}

export interface CourseCrashMarkerView {
  position: PixelCoord;
}

export interface CoursePreviewView {
  shipId: string;
  linePoints: PixelCoord[];
  lineColor: string;
  lineWidth: number;
  lineDash: number[];
  takeoffSegment: { points: PixelCoord[] } | null;
  gravityArrows: CourseArrowView[];
  ghostShip: GhostShipView | null;
  crashMarker: CourseCrashMarkerView | null;
  burnMarkers: CourseMarkerView[];
  burnArrow: CourseArrowView | null;
  overloadMarkers: CourseMarkerView[];
  overloadArrow: CourseArrowView | null;
  weakGravityMarkers: WeakGravityMarkerView[];
  pendingGravityArrows: CourseArrowView[];
  fuelCostLabel: FuelCostLabelView | null;
  driftSegments: DriftSegment[];
}

const buildDirectionMarker = (
  position: PixelCoord,
  isActive: boolean,
  isHovered: boolean,
  baseSize: number,
  activeSize: number,
  hoverDelta: number,
  activeFill: string,
  hoverFill: string,
  idleFill: string,
  activeStroke: string,
  idleStroke: string,
  activeShadow: string,
  hoverShadow: string,
  activeBlur: number,
  hoverBlur: number,
): CourseMarkerView => {
  const size =
    (isActive ? activeSize : baseSize) + (isHovered ? hoverDelta : 0);

  return {
    position,
    size,
    fillColor: isActive ? activeFill : isHovered ? hoverFill : idleFill,
    strokeColor: isActive || isHovered ? activeStroke : idleStroke,
    lineWidth: isActive || isHovered ? 2 : 1.5,
    shadowBlur: isHovered ? hoverBlur : isActive ? activeBlur : 0,
    shadowColor:
      isHovered || isActive ? (isHovered ? hoverShadow : activeShadow) : null,
    label: null,
    labelColor: null,
  };
};

const buildGravityArrow = (
  hex: HexCoord,
  direction: number,
  hexSize: number,
  color = 'rgba(255, 200, 50, 0.6)',
): CourseArrowView => {
  const start = hexToPixel(hex, hexSize);
  const target = hexToPixel(hexAdd(hex, HEX_DIRECTIONS[direction]), hexSize);

  const angle = Math.atan2(target.y - start.y, target.x - start.x);
  const arrowLength = 7;

  const tip = {
    x: start.x + Math.cos(angle) * arrowLength,
    y: start.y + Math.sin(angle) * arrowLength,
  };

  const headLength = 4;

  return {
    from: start,
    to: tip,
    headLeft: {
      x: tip.x - headLength * Math.cos(angle - 0.5),
      y: tip.y - headLength * Math.sin(angle - 0.5),
    },
    headRight: {
      x: tip.x - headLength * Math.cos(angle + 0.5),
      y: tip.y - headLength * Math.sin(angle + 0.5),
    },
    color,
    lineWidth: 1.5,
  };
};

const buildWeakGravityMarker = (
  hex: HexCoord,
  ignored: boolean,
  hexSize: number,
): WeakGravityMarkerView => {
  const position = hexToPixel(hex, hexSize);

  return {
    position,
    fillColor: ignored
      ? 'rgba(180, 130, 255, 0.1)'
      : 'rgba(180, 130, 255, 0.35)',
    strokeColor: ignored
      ? 'rgba(180, 130, 255, 0.5)'
      : 'rgba(180, 130, 255, 0.8)',
    labelColor: ignored
      ? 'rgba(180, 130, 255, 0.4)'
      : 'rgba(180, 130, 255, 0.9)',
    strikeFrom: ignored ? { x: position.x - 6, y: position.y + 4 } : null,
    strikeTo: ignored ? { x: position.x + 6, y: position.y - 4 } : null,
  };
};

const buildDirectionArrow = (
  from: PixelCoord,
  to: PixelCoord,
  color: string,
  lineWidth: number,
  headLength: number,
  insetPx: number,
): CourseArrowView => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const tipDist = Math.max(0, dist - insetPx);
  const tip = {
    x: from.x + Math.cos(angle) * tipDist,
    y: from.y + Math.sin(angle) * tipDist,
  };

  return {
    from,
    to: tip,
    headLeft: {
      x: tip.x - headLength * Math.cos(angle - 0.5),
      y: tip.y - headLength * Math.sin(angle - 0.5),
    },
    headRight: {
      x: tip.x - headLength * Math.cos(angle + 0.5),
      y: tip.y - headLength * Math.sin(angle + 0.5),
    },
    color,
    lineWidth,
  };
};

const buildBurnMarkers = (
  ship: GameState['ships'][number],
  burn: number | null,
  hoverHex: HexCoord | null,
  predictedDestination: HexCoord,
  hexSize: number,
): CourseMarkerView[] => {
  if (ship.fuel <= 0 || ship.damage.disabledTurns > 0) return [];

  const markers: CourseMarkerView[] = [];

  HEX_DIRECTIONS.forEach((_, direction) => {
    if (burn === direction) return;

    const targetHex = hexAdd(predictedDestination, HEX_DIRECTIONS[direction]);
    const target = hexToPixel(targetHex, hexSize);
    const isHovered = hoverHex !== null && hexEqual(hoverHex, targetHex);

    const marker = buildDirectionMarker(
      target,
      false,
      isHovered,
      16,
      20,
      3,
      'rgba(79, 195, 247, 0.8)',
      'rgba(79, 195, 247, 0.4)',
      'rgba(79, 195, 247, 0.2)',
      '#4fc3f7',
      'rgba(79, 195, 247, 0.3)',
      '#4fc3f7',
      '#4fc3f7',
      8,
      12,
    );

    const showLabel =
      typeof window === 'undefined' || window.innerWidth > MOBILE_BREAKPOINT_PX;
    marker.label = showLabel ? String(direction + 1) : null;
    marker.labelColor = isHovered
      ? 'rgba(0, 0, 0, 0.9)'
      : 'rgba(79, 195, 247, 0.7)';

    markers.push(marker);
  });

  return markers;
};

const computeGhostHeading = (
  ship: GameState['ships'][number],
  _burn: number | null,
  hexSize: number,
): number => {
  if (
    ship.lastBurnDirection !== undefined &&
    ship.lastBurnDirection >= 0 &&
    ship.lastBurnDirection < HEX_DIRECTIONS.length
  ) {
    const dir = HEX_DIRECTIONS[ship.lastBurnDirection];
    const from = hexToPixel(ship.position, hexSize);
    const to = hexToPixel(hexAdd(ship.position, dir), hexSize);
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  const { velocity } = ship;
  if (velocity.dq === 0 && velocity.dr === 0) return 0;

  const from = hexToPixel(ship.position, hexSize);
  const to = hexToPixel(hexAdd(ship.position, velocity), hexSize);
  return Math.atan2(to.y - from.y, to.x - from.x);
};

const buildBurnArrow = (
  ship: GameState['ships'][number],
  burn: number | null,
  predictedDestination: HexCoord,
  hexSize: number,
): CourseArrowView | null => {
  if (burn === null) return null;
  if (ship.fuel <= 0 || ship.damage.disabledTurns > 0) return null;

  const targetHex = hexAdd(predictedDestination, HEX_DIRECTIONS[burn]);
  const from = hexToPixel(predictedDestination, hexSize);
  const to = hexToPixel(targetHex, hexSize);
  return buildDirectionArrow(from, to, '#4fc3f7', 2.5, 8, hexSize * 0.35);
};

const buildOverloadMarkers = (
  ship: GameState['ships'][number],
  burn: number | null,
  overload: number | null,
  hoverHex: HexCoord | null,
  predictedDestination: HexCoord,
  hexSize: number,
): CourseMarkerView[] => {
  if (burn === null) return [];

  const stats = SHIP_STATS[ship.type];

  if (
    !stats?.canOverload ||
    ship.fuel < 2 ||
    ship.overloadUsed ||
    ship.damage.disabledTurns > 0
  ) {
    return [];
  }

  const burnDestination = hexAdd(predictedDestination, HEX_DIRECTIONS[burn]);

  const markers: CourseMarkerView[] = [];

  HEX_DIRECTIONS.forEach((_, direction) => {
    if (overload === direction) return;

    const targetHex = hexAdd(burnDestination, HEX_DIRECTIONS[direction]);
    const target = hexToPixel(targetHex, hexSize);

    markers.push(
      buildDirectionMarker(
        target,
        false,
        hoverHex !== null && hexEqual(hoverHex, targetHex),
        10,
        14,
        3,
        'rgba(255, 183, 77, 0.8)',
        'rgba(255, 183, 77, 0.4)',
        'rgba(255, 183, 77, 0.1)',
        '#ffb74d',
        'rgba(255, 183, 77, 0.25)',
        '#ffb74d',
        '#ffb74d',
        4,
        8,
      ),
    );
  });

  return markers;
};

const buildOverloadArrow = (
  ship: GameState['ships'][number],
  burn: number | null,
  overload: number | null,
  predictedDestination: HexCoord,
  hexSize: number,
): CourseArrowView | null => {
  if (burn === null || overload === null) return null;

  const stats = SHIP_STATS[ship.type];
  if (
    !stats?.canOverload ||
    ship.fuel < 2 ||
    ship.overloadUsed ||
    ship.damage.disabledTurns > 0
  ) {
    return null;
  }

  const burnDestination = hexAdd(predictedDestination, HEX_DIRECTIONS[burn]);
  const overloadTarget = hexAdd(burnDestination, HEX_DIRECTIONS[overload]);
  const from = hexToPixel(burnDestination, hexSize);
  const to = hexToPixel(overloadTarget, hexSize);
  return buildDirectionArrow(from, to, '#ffb74d', 2, 7, hexSize * 0.32);
};

const DRIFT_ALPHAS = [0.25, 0.15];

const buildDriftSegments = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  map: SolarSystemMap,
  hexSize: number,
): DriftSegment[] => {
  if (course.outcome === 'crash' || course.outcome === 'landing') return [];

  const segments: DriftSegment[] = [];
  let pos = course.destination;
  let vel = course.newVelocity;
  let pending = course.enteredGravityEffects;

  for (let i = 0; i < DRIFT_ALPHAS.length; i++) {
    const synthetic: Ship = {
      ...ship,
      position: pos,
      velocity: vel,
      pendingGravityEffects: pending,
      lifecycle: 'active',
    };

    const drift = computeCourse(synthetic, null, map);

    const points = [pos, ...drift.path.slice(1)].map((hex) =>
      hexToPixel(hex, hexSize),
    );

    segments.push({
      points,
      color: drift.outcome === 'crash' ? '#ff4444' : '#4fc3f7',
      alpha: DRIFT_ALPHAS[i],
    });

    if (drift.outcome === 'crash' || drift.outcome === 'landing') break;

    pos = drift.destination;
    vel = drift.newVelocity;
    pending = drift.enteredGravityEffects;
  }

  return segments;
};

// Readout that exposes the burn planning as vector math — `v + Δv = v'`
// — so a pilot can read the next-turn speed and composition off the
// map instead of counting hexes in their head. Rendered only for the
// currently-selected own ship during the astrogation phase. Contains
// up to three vectors (current velocity, burn delta, resulting
// velocity) and matching pill labels. Each vector stops short of its
// target hex so the arrowhead stays clear of surrounding burn /
// overload markers; the readout also draws above those markers, so
// even if inset geometry overlaps the arrowhead wins the z-order.
export interface VectorReadoutArrowView {
  from: PixelCoord;
  to: PixelCoord;
  headLeft: PixelCoord;
  headRight: PixelCoord;
  color: string;
  lineWidth: number;
  lineDash: number[];
}

export interface VectorReadoutLabelView {
  position: PixelCoord;
  text: string;
  color: string;
}

export interface AstrogationVectorReadoutView {
  currentVelocityArrow: VectorReadoutArrowView | null;
  burnArrow: VectorReadoutArrowView | null;
  resultVelocityArrow: VectorReadoutArrowView | null;
  labels: VectorReadoutLabelView[];
}

const midPoint = (a: PixelCoord, b: PixelCoord): PixelCoord => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const buildVectorArrow = (
  from: PixelCoord,
  to: PixelCoord,
  color: string,
  lineWidth: number,
  lineDash: number[],
  insetPx: number,
  headLength: number,
): VectorReadoutArrowView | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;
  const angle = Math.atan2(dy, dx);
  const tipDist = Math.max(0, dist - insetPx);
  const tip = {
    x: from.x + Math.cos(angle) * tipDist,
    y: from.y + Math.sin(angle) * tipDist,
  };
  return {
    from,
    to: tip,
    headLeft: {
      x: tip.x - headLength * Math.cos(angle - 0.5),
      y: tip.y - headLength * Math.sin(angle - 0.5),
    },
    headRight: {
      x: tip.x - headLength * Math.cos(angle + 0.5),
      y: tip.y - headLength * Math.sin(angle + 0.5),
    },
    color,
    lineWidth,
    lineDash,
  };
};

// Shift a label off the arrow line along the arrow's perpendicular so
// the pill does not sit on top of the stroke. `side` = +1 pushes the
// label to the right of the arrow direction, -1 to the left.
const offsetAlongPerpendicular = (
  from: PixelCoord,
  to: PixelCoord,
  distance: number,
  side: 1 | -1,
): PixelCoord => {
  const mid = midPoint(from, to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return mid;
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x: mid.x + nx * distance * side,
    y: mid.y + ny * distance * side,
  };
};

export const buildAstrogationVectorReadout = (
  state: GameState,
  playerId: PlayerId,
  planning: CoursePreviewPlanningState,
  hexSize: number,
): AstrogationVectorReadoutView | null => {
  if (state.phase !== 'astrogation' || state.activePlayer !== playerId) {
    return null;
  }
  const shipId = planning.selectedShipId;
  if (!shipId) return null;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.owner !== playerId) return null;
  if (ship.lifecycle !== 'active') return null;

  const burn = planning.burns.get(shipId) ?? null;
  const isDisabled = ship.damage.disabledTurns > 0;
  const hasUsableBurn = burn !== null && !isDisabled && ship.fuel > 0;

  const driftHex = predictDestination(ship);
  const newVelocity = hasUsableBurn
    ? {
        dq: ship.velocity.dq + HEX_DIRECTIONS[burn as number].dq,
        dr: ship.velocity.dr + HEX_DIRECTIONS[burn as number].dr,
      }
    : ship.velocity;
  const nextHex = hasUsableBurn
    ? hexAdd(driftHex, HEX_DIRECTIONS[burn as number])
    : driftHex;

  const origin = hexToPixel(ship.position, hexSize);
  const driftPoint = hexToPixel(driftHex, hexSize);
  const nextPoint = hexToPixel(nextHex, hexSize);

  const currentSpeed = hexVecLength(ship.velocity);
  const nextSpeed = hexVecLength(newVelocity);

  // Color roles:
  // - Current velocity (v) — muted cyan, dashed, so it reads as a
  //   "where you'd end up without burning" baseline.
  // - Burn (Δv) — amber, solid, standard "user-controlled input" hue.
  // - Resulting velocity (v') — bright cyan, solid, the emphasis line
  //   so pilots track the net outcome at a glance.
  const V_COLOR = 'rgba(132, 176, 210, 0.62)';
  const DV_COLOR = 'rgba(255, 183, 77, 0.92)';
  const V_PRIME_COLOR = 'rgba(122, 215, 255, 0.98)';

  // Inset on arrow tips keeps arrowheads out of the hex-center markers
  // (ghost ship, burn direction rings). Shorter for v' so its terminus
  // matches the result hex visually while still staying clear of the
  // ghost ship icon.
  const VECTOR_INSET = hexSize * 0.45;
  const HEAD_LEN = 9;

  const currentVelocityArrow =
    currentSpeed > 0
      ? buildVectorArrow(
          origin,
          driftPoint,
          V_COLOR,
          1.5,
          [4, 4],
          VECTOR_INSET,
          HEAD_LEN - 2,
        )
      : null;

  const burnArrow = hasUsableBurn
    ? buildVectorArrow(
        driftPoint,
        nextPoint,
        DV_COLOR,
        2.5,
        [],
        VECTOR_INSET,
        HEAD_LEN,
      )
    : null;

  // Only draw v' when it differs from v — otherwise it overlaps exactly
  // and just doubles the stroke. When there's no burn queued, the
  // current-velocity arrow already represents the next-turn trajectory,
  // so a separate v' would be redundant.
  const showResultArrow =
    hasUsableBurn && (nextHex.q !== driftHex.q || nextHex.r !== driftHex.r);
  const resultVelocityArrow = showResultArrow
    ? buildVectorArrow(
        origin,
        nextPoint,
        V_PRIME_COLOR,
        2.5,
        [],
        VECTOR_INSET,
        HEAD_LEN,
      )
    : null;

  const labels: VectorReadoutLabelView[] = [];

  // Offset distances from label to arrow line — large enough to clear
  // stroke + head geometry.
  const LABEL_OFFSET = hexSize * 0.4;

  if (currentSpeed > 0) {
    labels.push({
      position: offsetAlongPerpendicular(origin, driftPoint, LABEL_OFFSET, -1),
      text: `v=${Math.round(currentSpeed)}`,
      color: V_COLOR,
    });
  } else {
    // At rest: single label near the ship to anchor the readout.
    labels.push({
      position: { x: origin.x, y: origin.y - hexSize * 0.9 },
      text: 'v=0',
      color: V_COLOR,
    });
  }

  if (hasUsableBurn) {
    labels.push({
      position: offsetAlongPerpendicular(
        driftPoint,
        nextPoint,
        LABEL_OFFSET * 0.85,
        1,
      ),
      text: 'Δv',
      color: DV_COLOR,
    });

    if (showResultArrow) {
      labels.push({
        position: offsetAlongPerpendicular(origin, nextPoint, LABEL_OFFSET, 1),
        text: `v'=${Math.round(nextSpeed)}`,
        color: V_PRIME_COLOR,
      });
    } else {
      // Burn exists but v' = v in magnitude/position — e.g. burning to
      // stop a drift and staying put. Still emit a terminal label so
      // the readout shows the final speed without drawing an overlapping
      // arrow.
      labels.push({
        position: { x: nextPoint.x, y: nextPoint.y + hexSize * 0.75 },
        text: `v'=${Math.round(nextSpeed)}`,
        color: V_PRIME_COLOR,
      });
    }
  }

  return {
    currentVelocityArrow,
    burnArrow,
    resultVelocityArrow,
    labels,
  };
};

export const buildAstrogationCoursePreviewViews = (
  state: GameState,
  playerId: PlayerId,
  planning: CoursePreviewPlanningState,
  map: SolarSystemMap,
  hexSize: number,
): CoursePreviewView[] => {
  if (state.phase !== 'astrogation' || state.activePlayer !== playerId) {
    return [];
  }

  const previews: CoursePreviewView[] = [];

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle === 'destroyed') {
      continue;
    }

    const burn = planning.burns.get(ship.id) ?? null;
    const isSelected = ship.id === planning.selectedShipId;
    const isDisabled = ship.damage.disabledTurns > 0;

    if (burn === null && !isSelected) continue;
    if (isDisabled && !isSelected) continue;

    const overload = planning.overloads.get(ship.id) ?? null;
    const weakGravityChoices = planning.weakGravityChoices.get(ship.id) ?? {};

    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices,
      destroyedBases: state.destroyedBases,
      land: planning.landingShips?.has(ship.id),
    });

    const destination = hexToPixel(course.destination, hexSize);
    const predictedDestination = predictDestination(ship);

    const takeoffSegment = null;
    const mainPath = course.path;

    previews.push({
      shipId: ship.id,
      linePoints: mainPath.map((hex) => hexToPixel(hex, hexSize)),
      lineColor: course.outcome === 'crash' ? '#ff4444' : '#4fc3f7',
      lineWidth: 2,
      lineDash: burn !== null ? [] : [6, 4],
      takeoffSegment,

      gravityArrows: course.gravityEffects
        .filter((gravity) => gravity.strength !== 'weak')
        .map((gravity) =>
          buildGravityArrow(gravity.hex, gravity.direction, hexSize),
        ),

      ghostShip:
        course.outcome === 'crash'
          ? null
          : {
              position: destination,
              owner: ship.owner,
              shipType: ship.type,
              alpha: 0.4,
              heading: computeGhostHeading(ship, burn, hexSize),
            },

      crashMarker:
        course.outcome === 'crash'
          ? { position: hexToPixel(course.crashHex, hexSize) }
          : null,

      burnMarkers:
        isSelected && !isDisabled
          ? buildBurnMarkers(
              ship,
              burn,
              planning.hoverHex,
              predictedDestination,
              hexSize,
            )
          : [],

      burnArrow:
        isSelected && !isDisabled
          ? buildBurnArrow(ship, burn, predictedDestination, hexSize)
          : null,

      overloadMarkers:
        isSelected && !isDisabled
          ? buildOverloadMarkers(
              ship,
              burn,
              overload,
              planning.hoverHex,
              predictedDestination,
              hexSize,
            )
          : [],

      overloadArrow:
        isSelected && !isDisabled
          ? buildOverloadArrow(
              ship,
              burn,
              overload,
              predictedDestination,
              hexSize,
            )
          : null,

      weakGravityMarkers:
        isSelected && !isDisabled
          ? course.enteredGravityEffects
              .filter((gravity) => gravity.strength === 'weak')
              .map((gravity) =>
                buildWeakGravityMarker(
                  gravity.hex,
                  weakGravityChoices[hexKey(gravity.hex)] === true,
                  hexSize,
                ),
              )
          : [],

      pendingGravityArrows:
        isSelected && !isDisabled
          ? course.enteredGravityEffects
              .filter((gravity) => gravity.strength === 'full')
              .map((gravity) =>
                buildGravityArrow(
                  gravity.hex,
                  gravity.direction,
                  hexSize,
                  'rgba(100, 220, 220, 0.5)',
                ),
              )
          : [],

      fuelCostLabel: null,

      driftSegments: isSelected
        ? buildDriftSegments(ship, course, map, hexSize)
        : [],
    });
  }

  return previews;
};
