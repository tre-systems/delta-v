import { SHIP_STATS, type ShipType } from '../../shared/constants';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  hexAdd,
  hexEqual,
  hexKey,
  hexToPixel,
  type PixelCoord,
} from '../../shared/hex';
import { computeCourse, predictDestination } from '../../shared/movement';
import type {
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';

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
  overloadMarkers: CourseMarkerView[];
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

const buildBurnMarkers = (
  ship: GameState['ships'][number],
  burn: number | null,
  hoverHex: HexCoord | null,
  predictedDestination: HexCoord,
  hexSize: number,
): CourseMarkerView[] => {
  if (ship.fuel <= 0 || ship.damage.disabledTurns > 0) return [];

  return HEX_DIRECTIONS.map((_, direction) => {
    const targetHex = hexAdd(predictedDestination, HEX_DIRECTIONS[direction]);
    const target = hexToPixel(targetHex, hexSize);
    const isActive = burn === direction;
    const isHovered = hoverHex !== null && hexEqual(hoverHex, targetHex);

    const marker = buildDirectionMarker(
      target,
      isActive,
      isHovered,
      12,
      14,
      2,
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

    const showLabel = typeof window === 'undefined' || window.innerWidth > 760;
    marker.label = showLabel ? String(direction + 1) : null;
    marker.labelColor =
      isActive || isHovered ? 'rgba(0, 0, 0, 0.9)' : 'rgba(79, 195, 247, 0.7)';

    return marker;
  });
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

  return HEX_DIRECTIONS.map((_, direction) => {
    const targetHex = hexAdd(burnDestination, HEX_DIRECTIONS[direction]);
    const target = hexToPixel(targetHex, hexSize);

    return buildDirectionMarker(
      target,
      overload === direction,
      hoverHex !== null && hexEqual(hoverHex, targetHex),
      6,
      8,
      1.5,
      'rgba(255, 183, 77, 0.8)',
      'rgba(255, 183, 77, 0.4)',
      'rgba(255, 183, 77, 0.1)',
      '#ffb74d',
      'rgba(255, 183, 77, 0.25)',
      '#ffb74d',
      '#ffb74d',
      4,
      8,
    );
  });
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
