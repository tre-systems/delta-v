import { SHIP_STATS } from '../../shared/constants';
import { HEX_DIRECTIONS, type HexCoord, hexAdd, hexEqual, hexKey, hexToPixel, type PixelCoord } from '../../shared/hex';
import { computeCourse, predictDestination } from '../../shared/movement';
import type { GameState, SolarSystemMap } from '../../shared/types';

export interface CoursePreviewPlanningState {
  selectedShipId: string | null;
  burns: Map<string, number | null>;
  overloads: Map<string, number | null>;
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
  owner: number;
  shipType: string;
  alpha: number;
}

export interface FuelCostLabelView {
  position: PixelCoord;
  text: string;
  color: string;
}

export interface CoursePreviewView {
  shipId: string;
  linePoints: PixelCoord[];
  lineColor: string;
  lineWidth: number;
  lineDash: number[];
  gravityArrows: CourseArrowView[];
  ghostShip: GhostShipView | null;
  burnMarkers: CourseMarkerView[];
  overloadMarkers: CourseMarkerView[];
  weakGravityMarkers: WeakGravityMarkerView[];
  fuelCostLabel: FuelCostLabelView | null;
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
  const size = (isActive ? activeSize : baseSize) + (isHovered ? hoverDelta : 0);
  return {
    position,
    size,
    fillColor: isActive ? activeFill : isHovered ? hoverFill : idleFill,
    strokeColor: isActive || isHovered ? activeStroke : idleStroke,
    lineWidth: isActive || isHovered ? 2 : 1.5,
    shadowBlur: isHovered ? hoverBlur : isActive ? activeBlur : 0,
    shadowColor: isHovered || isActive ? (isHovered ? hoverShadow : activeShadow) : null,
  };
};

const buildGravityArrow = (hex: HexCoord, direction: number, hexSize: number): CourseArrowView => {
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
    color: 'rgba(255, 200, 50, 0.6)',
    lineWidth: 1.5,
  };
};

const buildWeakGravityMarker = (hex: HexCoord, ignored: boolean, hexSize: number): WeakGravityMarkerView => {
  const position = hexToPixel(hex, hexSize);
  return {
    position,
    fillColor: ignored ? 'rgba(180, 130, 255, 0.1)' : 'rgba(180, 130, 255, 0.35)',
    strokeColor: ignored ? 'rgba(180, 130, 255, 0.5)' : 'rgba(180, 130, 255, 0.8)',
    labelColor: ignored ? 'rgba(180, 130, 255, 0.4)' : 'rgba(180, 130, 255, 0.9)',
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
  if (ship.fuel <= 0) return [];
  return HEX_DIRECTIONS.map((_, direction) => {
    const targetHex = hexAdd(predictedDestination, HEX_DIRECTIONS[direction]);
    const target = hexToPixel(targetHex, hexSize);
    return buildDirectionMarker(
      target,
      burn === direction,
      hoverHex !== null && hexEqual(hoverHex, targetHex),
      8,
      10,
      2,
      'rgba(79, 195, 247, 0.8)',
      'rgba(79, 195, 247, 0.4)',
      'rgba(79, 195, 247, 0.15)',
      '#4fc3f7',
      'rgba(79, 195, 247, 0.3)',
      '#4fc3f7',
      '#4fc3f7',
      8,
      12,
    );
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
  if (!stats?.canOverload || ship.fuel < 2 || ship.overloadUsed) return [];

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

export const buildAstrogationCoursePreviewViews = (
  state: GameState,
  playerId: number,
  planning: CoursePreviewPlanningState,
  map: SolarSystemMap,
  hexSize: number,
): CoursePreviewView[] => {
  if (state.phase !== 'astrogation' || state.activePlayer !== playerId) return [];

  const previews: CoursePreviewView[] = [];
  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.destroyed) continue;
    const burn = planning.burns.get(ship.id) ?? null;
    const isSelected = ship.id === planning.selectedShipId;
    if (burn === null && !isSelected) continue;

    const overload = planning.overloads.get(ship.id) ?? null;
    const weakGravityChoices = planning.weakGravityChoices.get(ship.id) ?? {};
    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices,
      destroyedBases: state.destroyedBases,
    });
    const fromHex = ship.landed ? course.path[0] : ship.position;
    const destination = hexToPixel(course.destination, hexSize);
    const predictedDestination = ship.landed ? course.path[0] : predictDestination(ship);

    // For takeoff: show full path from base hex → launch hex → destination
    const takeoffPrefix =
      ship.landed && burn !== null && !hexEqual(ship.position, course.path[0]) ? [ship.position] : [];

    previews.push({
      shipId: ship.id,
      linePoints: [...takeoffPrefix, fromHex, ...course.path.slice(1)].map((hex) => hexToPixel(hex, hexSize)),
      lineColor: course.crashed ? '#ff4444' : '#4fc3f7',
      lineWidth: 2,
      lineDash: burn !== null ? [] : [6, 4],
      gravityArrows: course.gravityEffects
        .filter((gravity) => gravity.strength !== 'weak')
        .map((gravity) => buildGravityArrow(gravity.hex, gravity.direction, hexSize)),
      ghostShip: course.crashed
        ? null
        : {
            position: destination,
            owner: ship.owner,
            shipType: ship.type,
            alpha: 0.4,
          },
      burnMarkers: isSelected ? buildBurnMarkers(ship, burn, planning.hoverHex, predictedDestination, hexSize) : [],
      overloadMarkers: isSelected
        ? buildOverloadMarkers(ship, burn, overload, planning.hoverHex, predictedDestination, hexSize)
        : [],
      weakGravityMarkers: isSelected
        ? course.enteredGravityEffects
            .filter((gravity) => gravity.strength === 'weak')
            .map((gravity) =>
              buildWeakGravityMarker(gravity.hex, weakGravityChoices[hexKey(gravity.hex)] === true, hexSize),
            )
        : [],
      fuelCostLabel:
        burn !== null
          ? {
              position: { x: destination.x, y: destination.y - 16 },
              text: `-${course.fuelSpent}`,
              color: '#ffcc00',
            }
          : null,
    });
  }
  return previews;
};
