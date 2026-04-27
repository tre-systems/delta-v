import { SHIP_STATS } from '../../shared/constants';
import {
  HEX_DIRECTIONS,
  type HexCoord,
  type HexVec,
  hexAdd,
  hexKey,
  hexToPixel,
  hexVecLength,
} from '../../shared/hex';
import type {
  GameState,
  OrdnanceType,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import { isOwnShipForViewer, SPECTATOR_PLAYER_ID } from './colours';

const isShipDetectedForViewer = (
  ship: Pick<Ship, 'owner' | 'detected'>,
  playerId: PlayerId,
): boolean =>
  (playerId as number) === SPECTATOR_PLAYER_ID ||
  ship.owner === playerId ||
  ship.detected === true;

export interface ShipStackOffset {
  xOffset: number;
  labelYOffset: number;
}

export interface ShipLabelView {
  typeName: string;
  typeColor: string;
  typeFont: string;
  statusTag: string | null;
  statusColor: string | null;
  statusFont: string | null;
}

export type ShipIdentityMarker =
  | 'friendlyFugitive'
  | 'enemyFugitive'
  | 'enemyDecoy';

export interface OrdnanceLifetimeView {
  text: string;
  color: string;
}

export interface DetonatedOrdnanceOverlay {
  kind: 'diamond' | 'flash' | 'ring' | 'debris';
  size: number;
  color: string;
  alpha: number;
  lineWidth?: number;
  count?: number;
}

export const getVisibleShips = (
  state: GameState,
  playerId: PlayerId,
  isAnimating: boolean,
): Ship[] => {
  return state.ships.filter((ship) => {
    if (ship.lifecycle === 'destroyed' && !isAnimating) return false;

    return isShipDetectedForViewer(ship, playerId);
  });
};

export const getShipStackOffsets = (
  ships: Ship[],
): Map<string, ShipStackOffset> => {
  const hexCounts = new Map<string, number>();

  for (const ship of ships) {
    const key = hexKey(ship.position);
    hexCounts.set(key, (hexCounts.get(key) ?? 0) + 1);
  }

  const hexIndices = new Map<string, number>();
  const offsets = new Map<string, ShipStackOffset>();

  for (const ship of ships) {
    const key = hexKey(ship.position);
    const count = hexCounts.get(key) ?? 1;
    const index = hexIndices.get(key) ?? 0;

    hexIndices.set(key, index + 1);

    offsets.set(ship.id, {
      xOffset: count > 1 ? (index - (count - 1) / 2) * 16 : 0,
      labelYOffset: count > 1 ? 24 + index * 11 : 24,
    });
  }

  return offsets;
};

export const getShipHeading = (
  position: HexCoord,
  velocity: HexVec,
  hexSize: number,
  lastBurnDirection?: number,
): number => {
  if (
    lastBurnDirection !== undefined &&
    lastBurnDirection >= 0 &&
    lastBurnDirection < HEX_DIRECTIONS.length
  ) {
    const dir = HEX_DIRECTIONS[lastBurnDirection];
    const from = hexToPixel(position, hexSize);
    const to = hexToPixel(hexAdd(position, dir), hexSize);
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  if (hexVecLength(velocity) === 0) return 0;

  const from = hexToPixel(position, hexSize);
  const to = hexToPixel(hexAdd(position, velocity), hexSize);

  return Math.atan2(to.y - from.y, to.x - from.x);
};

export const getShipIconAlpha = (ship: Ship): number => {
  return ship.damage.disabledTurns > 0 ? 0.5 : 1;
};

export const getDisabledShipLabel = (
  ship: Ship,
  isAnimating: boolean,
): string | null => {
  if (isAnimating || ship.damage.disabledTurns <= 0) {
    return null;
  }

  return `DISABLED: ${ship.damage.disabledTurns}T`;
};

export const getShipIdentityMarker = (
  ship: Ship,
  playerId: PlayerId,
  hiddenIdentityInspection: boolean,
  isAnimating: boolean,
): ShipIdentityMarker | null => {
  if (isAnimating) return null;

  const isOwn = isOwnShipForViewer(ship.owner, playerId);

  if (ship.identity?.hasFugitives && isOwn) {
    return 'friendlyFugitive';
  }

  if (hiddenIdentityInspection && !isOwn && ship.identity?.revealed) {
    return ship.identity.hasFugitives ? 'enemyFugitive' : 'enemyDecoy';
  }

  return null;
};

export const shouldShowOrbitIndicator = (
  ship: Ship,
  inGravity: boolean,
  isAnimating: boolean,
): boolean => {
  if (ship.lifecycle !== 'active' || isAnimating) {
    return false;
  }

  return hexVecLength(ship.velocity) === 1 && inGravity;
};

export const shouldShowLandedIndicator = (
  ship: Ship,
  isAnimating: boolean,
): boolean => {
  return ship.lifecycle === 'landed' && !isAnimating;
};

export const buildShipLabelView = (
  ship: Ship,
  playerId: PlayerId,
  inGravity: boolean,
  _isAnimating: boolean,
): ShipLabelView | null => {
  const typeName = SHIP_STATS[ship.type]?.name ?? 'Unknown';

  if (isOwnShipForViewer(ship.owner, playerId)) {
    const orbiting = hexVecLength(ship.velocity) === 1 && inGravity;

    const isLanded = ship.lifecycle === 'landed';
    const statusTag = isLanded ? 'Landed' : orbiting ? 'Orbit' : null;

    return {
      typeName,
      typeColor: 'rgba(255, 255, 255, 0.7)',
      typeFont: '600 11px Inter, sans-serif',
      statusTag,
      statusColor: isLanded
        ? 'rgba(149, 214, 135, 0.5)'
        : statusTag
          ? 'rgba(255, 255, 255, 0.35)'
          : null,
      statusFont: statusTag ? '9px monospace' : null,
    };
  }

  if (!isShipDetectedForViewer(ship, playerId)) return null;

  return {
    typeName: `Enemy ${typeName}`,
    typeColor: 'rgba(255, 140, 100, 0.7)',
    typeFont: '600 11px Inter, sans-serif',
    statusTag: null,
    statusColor: null,
    statusFont: null,
  };
};

export const getOrdnanceColor = (
  owner: PlayerId,
  playerId: PlayerId,
): string => {
  return isOwnShipForViewer(owner, playerId) ? '#4fc3f7' : '#ff9800';
};

export const getOrdnancePulse = (now: number): number => {
  return 0.6 + 0.3 * Math.sin(now / 400);
};

export const getOrdnanceHeading = (
  position: HexCoord,
  velocity: HexVec,
  hexSize: number,
): number => {
  const from = hexToPixel(position, hexSize);
  const to = hexToPixel(hexAdd(position, velocity), hexSize);

  return Math.atan2(to.y - from.y, to.x - from.x);
};

export const getOrdnanceLifetimeView = (
  turnsRemaining: number,
  isAnimating: boolean,
): OrdnanceLifetimeView | null => {
  if (isAnimating || turnsRemaining > 2) return null;

  return {
    text: `${turnsRemaining}`,
    color:
      turnsRemaining <= 1
        ? 'rgba(255, 80, 80, 0.9)'
        : 'rgba(255, 200, 50, 0.7)',
  };
};

export const getDetonatedOrdnanceOverlay = (
  progress: number,
  ordnanceType: OrdnanceType = 'mine',
): DetonatedOrdnanceOverlay | null => {
  if (progress < 0.86) {
    return {
      kind: 'diamond',
      size: ordnanceType === 'nuke' ? 6 : 4,
      color: ordnanceType === 'nuke' ? '#ffb347' : '#ff4444',
      alpha: ordnanceType === 'nuke' ? 0.9 : 0.7,
    };
  }

  if (ordnanceType === 'nuke') {
    const blastProgress = Math.min((progress - 0.86) / 0.14, 1);
    if (blastProgress < 0.36) {
      return {
        kind: 'flash',
        size: 34 * (1 - blastProgress * 0.45),
        color: '#fff5bf',
        alpha: 0.88,
      };
    }
    if (blastProgress < 0.72) {
      return {
        kind: 'ring',
        size: 72 * blastProgress,
        color: '#ff8a22',
        alpha: (1 - blastProgress) * 0.9,
        lineWidth: 5 * (1 - blastProgress),
      };
    }
    return {
      kind: 'debris',
      size: 52 * blastProgress,
      color: '#ffd166',
      alpha: (1 - blastProgress) * 0.7,
      count: 12,
    };
  }

  if (progress <= 1) {
    const blastProgress = (progress - 0.86) / 0.14;
    const isMine = ordnanceType === 'mine';
    return {
      kind: isMine ? 'flash' : 'ring',
      size: (isMine ? 14 : 24) * (1 - blastProgress * 0.55),
      color: isMine ? '#ffaa00' : '#66d9ff',
      alpha: isMine ? 0.82 : 0.7,
      lineWidth: isMine ? undefined : 3 * (1 - blastProgress),
    };
  }

  return null;
};
