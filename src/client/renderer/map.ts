import {
  type HexCoord,
  type HexKey,
  hexToPixel,
  type PixelCoord,
} from '../../shared/hex';
import type {
  CelestialBody,
  GameState,
  PlayerId,
  PlayerState,
  SolarSystemMap,
} from '../../shared/types/domain';

export interface BodyRippleView {
  radius: number;
  alpha: number;
}

export interface BodyView {
  center: PixelCoord;
  radius: number;
  ripples: BodyRippleView[];
  // Neutral cool-grey tone so red-hued bodies (Mars, Sol) do not read
  // as a base-defense threat ring. The ripples are purely decorative;
  // combat and checkpoint signals have their own explicit overlays.
  rippleColor: string;
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

export interface CheckpointMarkerView {
  bodyName: string;
  center: PixelCoord;
  radius: number;
  visited: boolean;
  strokeStyle: string;
  lineWidth: number;
  lineDash: number[];
  pipCenter: PixelCoord;
  pipRadius: number;
  pipFill: string;
}

export const lightenColor = (hex: string, amount: number): string => {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
};

export const buildBodyView = (
  body: CelestialBody,
  hexSize: number,
  now: number,
): BodyView => {
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
    rippleColor: 'rgba(180, 196, 220, 1)',
    glowStops: [`${body.color}30`, `${body.color}10`, 'transparent'],
    coreColor: lightenColor(body.color, 30),
    edgeColor: body.color,
    label: body.name.toUpperCase(),
    labelY: center.y + radius + 18,
  };
};

export const buildBaseMarkerView = (
  baseKey: HexKey,
  state: GameState | null,
  playerId: PlayerId,
): BaseMarkerView => {
  const destroyed = new Set(state?.destroyedBases ?? []);

  if (destroyed.has(baseKey)) {
    return {
      kind: 'destroyed',
      fillStyle: null,
      strokeStyle: 'rgba(255, 90, 90, 0.8)',
      lineWidth: 1.5,
    };
  }

  const myBases =
    state && playerId >= 0
      ? new Set(state.players[playerId]?.bases ?? [])
      : new Set<HexKey>();
  const enemyBases =
    state && playerId >= 0
      ? new Set(state.players[1 - playerId]?.bases ?? [])
      : new Set<HexKey>();

  if (myBases.has(baseKey)) {
    return {
      kind: 'friendly',
      fillStyle: '#4fc3f7',
      strokeStyle: '#2196f3',
      lineWidth: 1,
    };
  }

  if (enemyBases.has(baseKey)) {
    return {
      kind: 'enemy',
      fillStyle: '#ff8a65',
      strokeStyle: '#e64a19',
      lineWidth: 1,
    };
  }
  return {
    kind: 'neutral',
    fillStyle: '#66bb6a',
    strokeStyle: '#388e3c',
    lineWidth: 1,
  };
};

export const buildMapBorderView = (
  bounds: SolarSystemMap['bounds'],
  isEscape: boolean,
  now: number,
  hexSize: number,
): MapBorderView => {
  const margin = 3;
  const topLeft = hexToPixel(
    { q: bounds.minQ - margin, r: bounds.minR - margin },
    hexSize,
  );
  const bottomRight = hexToPixel(
    { q: bounds.maxQ + margin, r: bounds.maxR + margin },
    hexSize,
  );

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

export const buildAsteroidDebrisView = (
  coord: HexCoord,
  hexSize: number,
): AsteroidDebrisView => {
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
      {
        position: hexToPixel({ q: bounds.maxQ + 2, r: midR }, hexSize),
        text: '→ ESCAPE',
      },
      {
        position: hexToPixel({ q: bounds.minQ - 2, r: midR }, hexSize),
        text: '← ESCAPE',
      },
      {
        position: hexToPixel({ q: midQ, r: bounds.maxR + 2 }, hexSize),
        text: '↓ ESCAPE',
      },
      {
        position: hexToPixel({ q: midQ, r: bounds.minR - 2 }, hexSize),
        text: '↑ ESCAPE',
      },
    ],
  };
};

// Race scenarios (e.g. Grand Tour) track flyby checkpoints in
// `scenarioRules.checkpointBodies` and per-player `visitedBodies`.
// Neither was previously rendered, so players had no way to tell which
// bodies counted or how many they'd ticked off. This builder returns a
// subtle ring + pip per checkpoint so visited vs pending reads at a
// glance against the existing body decoration. Home body uses a green
// tone when all checkpoints are done to cue the final-leg return leg.
export const buildCheckpointMarkerViews = (
  state: GameState,
  playerId: PlayerId | -1,
  map: SolarSystemMap,
  hexSize: number,
): CheckpointMarkerView[] => {
  const checkpoints = state.scenarioRules.checkpointBodies;
  if (!checkpoints || checkpoints.length === 0) return [];

  const player =
    playerId >= 0 ? (state.players[playerId as PlayerId] ?? null) : null;
  const visited = new Set(player?.visitedBodies ?? []);
  const homeBody = player?.homeBody ?? null;
  const allVisited = visited.size >= checkpoints.length;

  const views: CheckpointMarkerView[] = [];
  for (const name of checkpoints) {
    const body = map.bodies.find((candidate) => candidate.name === name);
    if (!body) continue;

    const center = hexToPixel(body.center, hexSize);
    const bodyRadius = body.renderRadius * hexSize;
    const ringRadius = bodyRadius + 12;
    const wasVisited = visited.has(name);
    const isHomeReturn = allVisited && homeBody === name;

    views.push({
      bodyName: name,
      center,
      radius: ringRadius,
      visited: wasVisited,
      strokeStyle: wasVisited
        ? 'rgba(122, 215, 255, 0.55)'
        : 'rgba(226, 232, 244, 0.28)',
      lineWidth: wasVisited ? 1.5 : 1,
      lineDash: wasVisited ? [] : [3, 5],
      pipCenter: {
        x: center.x + bodyRadius + 14,
        y: center.y - bodyRadius - 8,
      },
      pipRadius: 3.5,
      pipFill: isHomeReturn
        ? 'rgba(100, 255, 140, 0.95)'
        : wasVisited
          ? 'rgba(122, 215, 255, 0.9)'
          : 'rgba(180, 196, 220, 0.35)',
    });
  }
  return views;
};

export const buildLandingObjectiveView = (
  player: PlayerState | undefined,
  map: SolarSystemMap,
  now: number,
  hexSize: number,
): LandingObjectiveView | null => {
  if (!player) return null;

  if (player.escapeWins)
    return buildEscapeObjectiveView(map.bounds, now, hexSize);

  if (!player.targetBody) return null;

  const body = map.bodies.find(
    (candidate) => candidate.name === player.targetBody,
  );

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
