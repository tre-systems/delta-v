import { SHIP_STATS } from '../shared/constants';
import {
  hexAdd,
  hexKey,
  hexToPixel,
  hexVecLength,
  type HexCoord,
  type HexVec,
} from '../shared/hex';
import type { GameState, Ship } from '../shared/types';

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

export type ShipIdentityMarker = 'friendlyFugitive' | 'enemyFugitive' | 'enemyDecoy';

export interface OrdnanceLifetimeView {
  text: string;
  color: string;
}

export interface DetonatedOrdnanceOverlay {
  kind: 'diamond' | 'flash';
  size: number;
  color: string;
  alpha: number;
}

export function getVisibleShips(state: GameState, playerId: number, isAnimating: boolean): Ship[] {
  return state.ships.filter((ship) => {
    if (ship.destroyed && !isAnimating) return false;
    if (ship.owner === playerId) return true;
    return ship.detected;
  });
}

export function getShipStackOffsets(ships: Ship[]): Map<string, ShipStackOffset> {
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
}

export function getShipHeading(position: HexCoord, velocity: HexVec, hexSize: number): number {
  if (hexVecLength(velocity) === 0) return 0;
  const from = hexToPixel(position, hexSize);
  const to = hexToPixel(hexAdd(position, velocity), hexSize);
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function getShipIconAlpha(ship: Ship): number {
  return ship.damage.disabledTurns > 0 ? 0.5 : 1;
}

export function getDisabledShipLabel(ship: Ship, isAnimating: boolean): string | null {
  if (isAnimating || ship.damage.disabledTurns <= 0) return null;
  return `DISABLED: ${ship.damage.disabledTurns}T`;
}

export function getShipIdentityMarker(
  ship: Ship,
  playerId: number,
  hiddenIdentityInspection: boolean,
  isAnimating: boolean,
): ShipIdentityMarker | null {
  if (isAnimating) return null;
  if (ship.hasFugitives && ship.owner === playerId) return 'friendlyFugitive';
  if (hiddenIdentityInspection && ship.owner !== playerId && ship.identityRevealed) {
    return ship.hasFugitives ? 'enemyFugitive' : 'enemyDecoy';
  }
  return null;
}

export function shouldShowOrbitIndicator(ship: Ship, inGravity: boolean, isAnimating: boolean): boolean {
  if (ship.landed || ship.destroyed || isAnimating) return false;
  return hexVecLength(ship.velocity) === 1 && inGravity;
}

export function shouldShowLandedIndicator(ship: Ship, isAnimating: boolean): boolean {
  return ship.landed && !isAnimating;
}

export function buildShipLabelView(
  ship: Ship,
  playerId: number,
  inGravity: boolean,
  isAnimating: boolean,
): ShipLabelView | null {
  if (isAnimating) return null;

  const typeName = SHIP_STATS[ship.type]?.name ?? 'Unknown';
  if (ship.owner === playerId) {
    const orbiting = hexVecLength(ship.velocity) === 1 && inGravity;
    const statusTag = ship.landed ? 'Landed' : orbiting ? 'Orbit' : null;
    return {
      typeName,
      typeColor: 'rgba(255, 255, 255, 0.7)',
      typeFont: '600 9px Inter, sans-serif',
      statusTag,
      statusColor: ship.landed
        ? 'rgba(149, 214, 135, 0.5)'
        : statusTag
          ? 'rgba(255, 255, 255, 0.35)'
          : null,
      statusFont: statusTag ? '7px monospace' : null,
    };
  }

  if (!ship.detected) return null;
  return {
    typeName,
    typeColor: 'rgba(255, 171, 145, 0.5)',
    typeFont: '500 9px Inter, sans-serif',
    statusTag: null,
    statusColor: null,
    statusFont: null,
  };
}

export function getOrdnanceColor(owner: number, playerId: number): string {
  return owner === playerId ? '#4fc3f7' : '#ff9800';
}

export function getOrdnancePulse(now: number): number {
  return 0.6 + 0.3 * Math.sin(now / 400);
}

export function getOrdnanceHeading(position: HexCoord, velocity: HexVec, hexSize: number): number {
  const from = hexToPixel(position, hexSize);
  const to = hexToPixel(hexAdd(position, velocity), hexSize);
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function getOrdnanceLifetimeView(turnsRemaining: number, isAnimating: boolean): OrdnanceLifetimeView | null {
  if (isAnimating || turnsRemaining > 2) return null;
  return {
    text: `${turnsRemaining}`,
    color: turnsRemaining <= 1 ? 'rgba(255, 80, 80, 0.9)' : 'rgba(255, 200, 50, 0.7)',
  };
}

export function getDetonatedOrdnanceOverlay(progress: number): DetonatedOrdnanceOverlay | null {
  if (progress < 0.9) {
    return { kind: 'diamond', size: 4, color: '#ff4444', alpha: 0.7 };
  }
  if (progress <= 1) {
    return {
      kind: 'flash',
      size: 12 * (1 - (progress - 0.9) / 0.1),
      color: '#ffaa00',
      alpha: 0.8,
    };
  }
  return null;
}
