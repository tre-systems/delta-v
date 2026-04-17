import {
  type HexCoord,
  type HexKey,
  hexDirectionToward,
  hexKey,
  hexNeighbor,
  hexRing,
  parseHexKey,
} from './hex';
import type { CelestialBody, MapHex, SolarSystemMap } from './types';

interface BodyDefinition {
  name: string;
  center: HexCoord;
  surfaceRadius: number;
  gravityRings: number;
  gravityStrength: 'full' | 'weak';
  destructive: boolean;
  color: string;
  renderRadius: number;
  baseDirections: number[];
}

const BODY_DEFS: BodyDefinition[] = [
  {
    name: 'Sol',
    center: { q: -2, r: 2 },
    surfaceRadius: 2,
    gravityRings: 2,
    gravityStrength: 'full',
    destructive: true,
    color: '#ffcc00',
    renderRadius: 2.5,
    baseDirections: [],
  },
  {
    name: 'Mercury',
    center: { q: 1, r: 3 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#b0a090',
    renderRadius: 0.6,
    baseDirections: [0, 3],
  },
  {
    name: 'Venus',
    center: { q: -7, r: 7 },
    surfaceRadius: 1,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#e8c87a',
    renderRadius: 1.2,
    baseDirections: [0, 1, 2, 3, 4, 5],
  },
  {
    name: 'Terra',
    center: { q: 5, r: -5 },
    surfaceRadius: 1,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#4488cc',
    renderRadius: 1.2,
    baseDirections: [1, 4, 0, 2, 3, 5],
  },
  {
    name: 'Luna',
    center: { q: 9, r: -7 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccccc',
    renderRadius: 0.45,
    baseDirections: [0, 1, 2, 3, 4, 5],
  },
  {
    name: 'Mars',
    center: { q: -9, r: -5 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#cc4422',
    renderRadius: 0.7,
    baseDirections: [1, 4, 0, 2, 3, 5],
  },
  {
    name: 'Ceres',
    center: { q: -7, r: -10 },
    surfaceRadius: 0,
    gravityRings: 0,
    gravityStrength: 'full',
    destructive: false,
    color: '#888888',
    renderRadius: 0.35,
    baseDirections: [0],
  },
  {
    name: 'Jupiter',
    center: { q: -1, r: -18 },
    surfaceRadius: 2,
    gravityRings: 2,
    gravityStrength: 'full',
    destructive: false,
    color: '#cc9966',
    renderRadius: 2.8,
    baseDirections: [],
  },
  {
    name: 'Io',
    center: { q: -1, r: -15 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccc44',
    renderRadius: 0.4,
    baseDirections: [0],
  },
  {
    name: 'Callisto',
    center: { q: -4, r: -16 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#998877',
    renderRadius: 0.4,
    baseDirections: [3],
  },
  {
    name: 'Ganymede',
    center: { q: 3, r: -21 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#aaa099',
    renderRadius: 0.45,
    baseDirections: [],
  },
];

const ASTEROID_BELT_HEXES: HexCoord[] = [
  { q: -14, r: -13 },
  { q: -14, r: -12 },
  { q: -13, r: -12 },
  { q: -14, r: -11 },
  { q: -13, r: -11 },
  { q: -12, r: -11 },
  { q: -14, r: -10 },
  { q: -13, r: -10 },
  { q: -9, r: -11 },
  { q: -8, r: -10 },
  { q: -6, r: -11 },
  { q: -5, r: -11 },
  { q: -4, r: -11 },
  { q: -3, r: -11 },
  { q: -2, r: -11 },
  { q: -5, r: -10 },
  { q: -4, r: -10 },
  { q: -3, r: -10 },
  { q: -2, r: -10 },
  { q: -1, r: -10 },
  { q: -5, r: -9 },
  { q: -4, r: -9 },
  { q: -3, r: -9 },
  { q: -2, r: -9 },
  { q: -1, r: -9 },
  { q: -4, r: -8 },
  { q: -3, r: -8 },
  { q: 0, r: -12 },
  { q: 1, r: -12 },
  { q: 2, r: -12 },
  { q: 3, r: -12 },
  { q: 0, r: -11 },
  { q: 1, r: -11 },
  { q: 2, r: -11 },
  { q: 3, r: -11 },
  { q: 1, r: -10 },
  { q: 2, r: -10 },
  { q: 3, r: -10 },
  { q: 1, r: -9 },
  { q: 2, r: -9 },
  { q: 2, r: -13 },
  { q: 3, r: -13 },
  { q: 4, r: -13 },
  { q: 2, r: -14 },
  { q: 3, r: -14 },
  { q: 4, r: -14 },
  { q: 5, r: -14 },
  { q: 4, r: -15 },
  { q: 8, r: -17 },
  { q: 8, r: -15 },
  { q: 9, r: -16 },
  { q: 10, r: -17 },
  { q: 10, r: -16 },
  { q: 11, r: -19 },
  { q: 11, r: -17 },
  { q: 12, r: -18 },
];

const CLANDESTINE_BASE_HEX: HexCoord = { q: 6, r: -16 };

const CLANDESTINE_CLUSTER_HEXES: HexCoord[] = [
  { q: 5, r: -17 },
  { q: 6, r: -17 },
  { q: 7, r: -17 },
  { q: 5, r: -16 },
  { q: 6, r: -16 },
  { q: 7, r: -16 },
  { q: 5, r: -15 },
  { q: 6, r: -15 },
  { q: 7, r: -15 },
];

const generateAsteroidHexes = (): HexCoord[] => [
  ...ASTEROID_BELT_HEXES,
  ...CLANDESTINE_CLUSTER_HEXES,
];

const BODY_DEF_BY_NAME = Object.fromEntries(
  BODY_DEFS.map((def) => [def.name, def] as const),
) as Record<string, BodyDefinition>;

const computeBodyBaseHexes = (bodyName: string): HexCoord[] => {
  const def = BODY_DEF_BY_NAME[bodyName];

  if (!def) {
    return [];
  }

  return def.baseDirections.map((dir) => {
    let baseHex = def.center;

    for (let i = 0; i < def.surfaceRadius + 1; i++) {
      baseHex = hexNeighbor(baseHex, dir);
    }

    return baseHex;
  });
};

export const getBodyOffset = (
  bodyName: string,
  dq: number,
  dr: number,
): HexCoord => {
  const def = BODY_DEF_BY_NAME[bodyName];

  if (!def) {
    throw new Error(`Unknown body in map-data helper: ${bodyName}`);
  }

  return {
    q: def.center.q + dq,
    r: def.center.r + dr,
  };
};

export const getControlledBaseHexes = (...bodyNames: string[]): HexCoord[] =>
  bodyNames.flatMap((bodyName) => computeBodyBaseHexes(bodyName));

export const buildSolarSystemMap = (): SolarSystemMap => {
  const hexes = new Map<HexKey, MapHex>();
  const bodies: CelestialBody[] = [];
  const gravityBodies = new Set<string>();

  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;

  const trackBounds = (hex: HexCoord) => {
    minQ = Math.min(minQ, hex.q);
    maxQ = Math.max(maxQ, hex.q);
    minR = Math.min(minR, hex.r);
    maxR = Math.max(maxR, hex.r);
  };

  const ensureHex = (coord: HexCoord): MapHex => {
    const key = hexKey(coord);
    let hex = hexes.get(key);

    if (!hex) {
      hex = { terrain: 'space' };
      hexes.set(key, hex);
    }

    trackBounds(coord);

    return hex;
  };

  for (const def of BODY_DEFS) {
    const surfaceHexes: HexCoord[] = [];

    if (def.surfaceRadius === 0) {
      surfaceHexes.push(def.center);
    } else {
      surfaceHexes.push(def.center);

      for (let ring = 1; ring <= def.surfaceRadius; ring++) {
        surfaceHexes.push(...hexRing(def.center, ring));
      }
    }

    for (const surfaceHex of surfaceHexes) {
      const hex = ensureHex(surfaceHex);
      hex.terrain = def.destructive ? 'sunSurface' : 'planetSurface';
      hex.body = {
        name: def.name,
        destructive: def.destructive,
      };
    }

    for (const dir of def.baseDirections) {
      let baseHex = def.center;

      for (let i = 0; i < def.surfaceRadius + 1; i++) {
        baseHex = hexNeighbor(baseHex, dir);
      }

      const hex = ensureHex(baseHex);
      hex.base = {
        name: `${def.name} Base`,
        bodyName: def.name,
      };
    }

    for (
      let ring = def.surfaceRadius + 1;
      ring <= def.surfaceRadius + def.gravityRings;
      ring++
    ) {
      const ringHexes = hexRing(def.center, ring);

      for (const gravityHex of ringHexes) {
        const existing = hexes.get(hexKey(gravityHex));

        if (
          existing &&
          (existing.terrain === 'planetSurface' ||
            existing.terrain === 'sunSurface')
        ) {
          continue;
        }

        const hex = ensureHex(gravityHex);
        const dir = hexDirectionToward(gravityHex, def.center);
        hex.gravity = {
          direction: dir,
          strength: def.gravityStrength,
          bodyName: def.name,
        };
        gravityBodies.add(def.name);
      }
    }

    bodies.push({
      name: def.name,
      center: def.center,
      surfaceRadius: def.surfaceRadius,
      color: def.color,
      renderRadius: def.renderRadius,
    });
  }

  for (const asteroidHex of generateAsteroidHexes()) {
    const hex = ensureHex(asteroidHex);

    if (hex.terrain === 'space') {
      hex.terrain = 'asteroid';
    }
  }

  const clandestineHex = ensureHex(CLANDESTINE_BASE_HEX);
  if (clandestineHex.terrain === 'space') {
    clandestineHex.terrain = 'asteroid';
  }
  clandestineHex.base = {
    name: 'Clandestine Base',
    bodyName: 'Clandestine',
  };

  return {
    hexes,
    bodies,
    gravityBodies,
    bounds: {
      minQ: -16, // 7 hexes left of Mars (q=-9)
      maxQ: 16, // 7 hexes right of Luna (q=9)
      minR: -25, // 7 hexes above Jupiter (r=-18)
      maxR: 10, // 3 hexes below Venus gravity (r=9)
    },
  };
};

export const findBaseHexes = (
  map: SolarSystemMap,
  bodyName: string,
): HexCoord[] =>
  [...map.hexes.entries()]
    .filter(([, hex]) => hex.base?.bodyName === bodyName)
    .map(([key]) => parseHexKey(key));

export const findBaseHex = (
  map: SolarSystemMap,
  bodyName: string,
): HexCoord | null => findBaseHexes(map, bodyName)[0] ?? null;

export const bodyHasGravity = (
  bodyName: string,
  map: SolarSystemMap,
): boolean =>
  map.gravityBodies?.has(bodyName) ??
  [...map.hexes.values()].some((hex) => hex.gravity?.bodyName === bodyName);
