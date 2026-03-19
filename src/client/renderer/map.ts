import { type HexCoord, hexToPixel, type PixelCoord } from '../../shared/hex';
import type { CelestialBody, GameState, PlayerState, SolarSystemMap } from '../../shared/types';

export interface BodyRippleView {
  radius: number;
  alpha: number;
}

export interface BodyView {
  center: PixelCoord;
  radius: number;
  ripples: BodyRippleView[];
  glowStops: [string, string, string];
  coreColor: string;
  edgeColor: string;
  label: string;
  labelY: number;
}

export interface BaseMarkerView {
  kind: 'destroyed' | 'friendly' | 'enemy' | 'neutral';
  fillStyle: string | null;
  strokeStyle: string;
  lineWidth: number;
}

export interface MapBorderView {
  topLeft: PixelCoord;
  width: number;
  height: number;
  strokeStyle: string;
  lineWidth: number;
  lineDash: number[];
}

export interface AsteroidDebrisView {
  center: PixelCoord;
  particles: Array<{ xOffset: number; yOffset: number; size: number }>;
}

export interface EscapeMarkerView {
  position: PixelCoord;
  text: string;
}

export type LandingObjectiveView =
  | {
      kind: 'escape';
      color: string;
      markers: EscapeMarkerView[];
    }
  | {
      kind: 'targetBody';
      center: PixelCoord;
      radius: number;
      strokeStyle: string;
      labelStyle: string;
      labelText: string;
      labelY: number;
    };

export const lightenColor = (hex: string, amount: number): string => {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
};

export const buildBodyView = (body: CelestialBody, hexSize: number, now: number): BodyView => {
  const center = hexToPixel(body.center, hexSize);
  const radius = body.renderRadius * hexSize;
  const pulse = 0.5 + 0.5 * Math.sin(now / 1500 + center.x * 0.01);
  const ripples: BodyRippleView[] = [];
  for (let i = 1; i <= 3; i++) {
    ripples.push({
      radius: radius * (1.2 + i * 0.8 + pulse * 0.2),
      alpha: (0.15 / i) * (1 - pulse * 0.3),
    });
  }
  return {
    center,
    radius,
    ripples,
    glowStops: [`${body.color}30`, `${body.color}10`, 'transparent'],
    coreColor: lightenColor(body.color, 30),
    edgeColor: body.color,
    label: body.name.toUpperCase(),
    labelY: center.y + radius + 18,
  };
};

export const buildBaseMarkerView = (baseKey: string, state: GameState | null, playerId: number): BaseMarkerView => {
  const destroyed = new Set(state?.destroyedBases ?? []);
  if (destroyed.has(baseKey)) {
    return {
      kind: 'destroyed',
      fillStyle: null,
      strokeStyle: 'rgba(255, 90, 90, 0.8)',
      lineWidth: 1.5,
    };
  }

  const myBases = state && playerId >= 0 ? new Set(state.players[playerId]?.bases ?? []) : new Set<string>();
  const enemyBases = state && playerId >= 0 ? new Set(state.players[1 - playerId]?.bases ?? []) : new Set<string>();
  if (myBases.has(baseKey)) {
    return { kind: 'friendly', fillStyle: '#4fc3f7', strokeStyle: '#2196f3', lineWidth: 1 };
  }
  if (enemyBases.has(baseKey)) {
    return { kind: 'enemy', fillStyle: '#ff8a65', strokeStyle: '#e64a19', lineWidth: 1 };
  }
  return { kind: 'neutral', fillStyle: '#66bb6a', strokeStyle: '#388e3c', lineWidth: 1 };
};

export const buildMapBorderView = (
  bounds: SolarSystemMap['bounds'],
  isEscape: boolean,
  now: number,
  hexSize: number,
): MapBorderView => {
  const margin = 3;
  const topLeft = hexToPixel({ q: bounds.minQ - margin, r: bounds.minR - margin }, hexSize);
  const bottomRight = hexToPixel({ q: bounds.maxQ + margin, r: bounds.maxR + margin }, hexSize);
  if (isEscape) {
    const pulse = 0.15 + 0.1 * Math.sin(now / 1000);
    return {
      topLeft,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      strokeStyle: `rgba(100, 255, 100, ${pulse})`,
      lineWidth: 2,
      lineDash: [8, 6],
    };
  }
  return {
    topLeft,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
    strokeStyle: 'rgba(255, 255, 255, 0.04)',
    lineWidth: 1,
    lineDash: [],
  };
};

export const buildAsteroidDebrisView = (coord: HexCoord, hexSize: number): AsteroidDebrisView => {
  const center = hexToPixel(coord, hexSize);
  const seed = Math.abs(coord.q * 7 + coord.r * 13);
  const count = 4 + (seed % 5);
  const particles = Array.from({ length: count }, (_, index) => {
    const factor = index + 1;
    return {
      xOffset: (((seed * factor * 17) % 21) - 10) * 1.2,
      yOffset: (((seed * factor * 23) % 21) - 10) * 1.2,
      size: 1.2 + ((seed * factor * 31) % 9) * 0.45,
    };
  });
  return { center, particles };
};

const buildEscapeObjectiveView = (
  bounds: SolarSystemMap['bounds'],
  now: number,
  hexSize: number,
): LandingObjectiveView => {
  const midR = Math.floor((bounds.minR + bounds.maxR) / 2);
  const midQ = Math.floor((bounds.minQ + bounds.maxQ) / 2);
  return {
    kind: 'escape',
    color: `rgba(100, 255, 100, ${0.3 + 0.2 * Math.sin(now / 600)})`,
    markers: [
      { position: hexToPixel({ q: bounds.maxQ + 2, r: midR }, hexSize), text: '→ ESCAPE' },
      { position: hexToPixel({ q: bounds.minQ - 2, r: midR }, hexSize), text: '← ESCAPE' },
      { position: hexToPixel({ q: midQ, r: bounds.maxR + 2 }, hexSize), text: '↓ ESCAPE' },
      { position: hexToPixel({ q: midQ, r: bounds.minR - 2 }, hexSize), text: '↑ ESCAPE' },
    ],
  };
};

export const buildLandingObjectiveView = (
  player: PlayerState | undefined,
  map: SolarSystemMap,
  now: number,
  hexSize: number,
): LandingObjectiveView | null => {
  if (!player) return null;
  if (player.escapeWins) return buildEscapeObjectiveView(map.bounds, now, hexSize);
  if (!player.targetBody) return null;

  const body = map.bodies.find((candidate) => candidate.name === player.targetBody);
  if (!body) return null;

  const center = hexToPixel(body.center, hexSize);
  const radius = body.renderRadius * hexSize;
  const pulse = 0.4 + 0.3 * Math.sin(now / 800);
  return {
    kind: 'targetBody',
    center,
    radius: radius + 8,
    strokeStyle: `rgba(100, 255, 100, ${pulse})`,
    labelStyle: `rgba(100, 255, 100, ${0.5 + pulse * 0.3})`,
    labelText: '▼ TARGET',
    labelY: center.y + radius + 24,
  };
};
