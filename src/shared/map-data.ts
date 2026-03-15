import {
  type HexCoord,
  hexKey,
  hexNeighbor,
  hexRing,
  hexDistance,
  hexDirectionToward,
} from './hex';
import type { MapHex, CelestialBody, SolarSystemMap, ScenarioDefinition } from './types';

// --- Body definitions ---
// Coordinates approximate the Delta-V board layout.
// The map is oriented with Sol near center, planets spread outward.
// Flat-top hex grid, q increases right, r increases down-right.

interface BodyDefinition {
  name: string;
  center: HexCoord;
  surfaceRadius: number; // hexes covered by the body (0 = single hex)
  gravityRings: number;  // rings of gravity hexes around the surface
  gravityStrength: 'full' | 'weak';
  destructive: boolean;  // contact = destruction (Sol)
  color: string;
  renderRadius: number;  // visual radius as multiplier of hex size
  baseDirections: number[]; // which of the 6 directions have bases (on first gravity ring for multi-hex bodies)
}

const BODY_DEFS: BodyDefinition[] = [
  {
    name: 'Sol',
    center: { q: 0, r: 0 },
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
    center: { q: 7, r: -2 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#b0a090',
    renderRadius: 0.6,
    baseDirections: [0, 3], // E and W
  },
  {
    name: 'Venus',
    center: { q: -5, r: -7 },
    surfaceRadius: 1,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#e8c87a',
    renderRadius: 1.2,
    baseDirections: [0, 1, 2, 3, 4, 5], // all 6 sides
  },
  {
    name: 'Terra',
    center: { q: -12, r: 5 },
    surfaceRadius: 1,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#4488cc',
    renderRadius: 1.2,
    baseDirections: [1, 4], // NE and SW
  },
  {
    name: 'Luna',
    center: { q: -14, r: 5 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccccc',
    renderRadius: 0.45,
    baseDirections: [3], // W (facing Terra)
  },
  {
    name: 'Mars',
    center: { q: 10, r: 8 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#cc4422',
    renderRadius: 0.7,
    baseDirections: [1, 4], // NE and SW
  },
  {
    name: 'Ceres',
    center: { q: -3, r: 18 },
    surfaceRadius: 0,
    gravityRings: 0,
    gravityStrength: 'full',
    destructive: false,
    color: '#888888',
    renderRadius: 0.35,
    baseDirections: [0], // E
  },
  {
    name: 'Jupiter',
    center: { q: 8, r: -22 },
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
    center: { q: 5, r: -20 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccc44',
    renderRadius: 0.4,
    baseDirections: [0], // E
  },
  {
    name: 'Callisto',
    center: { q: 12, r: -24 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#998877',
    renderRadius: 0.4,
    baseDirections: [3], // W
  },
  {
    name: 'Ganymede',
    center: { q: 6, r: -24 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#aaa099',
    renderRadius: 0.45,
    baseDirections: [],
  },
];

// --- Asteroid belt hexes (scattered between Mars and Jupiter orbits) ---
// These are approximate positions; a full implementation would trace the belt more accurately

function generateAsteroidHexes(): HexCoord[] {
  const asteroids: HexCoord[] = [];
  // Scatter some asteroid hexes in the belt region
  const beltHexes: HexCoord[] = [
    { q: -6, r: 14 }, { q: -4, r: 15 }, { q: -2, r: 16 }, { q: 0, r: 16 },
    { q: 2, r: 15 }, { q: 4, r: 14 }, { q: 6, r: 13 }, { q: 8, r: 12 },
    { q: -8, r: 15 }, { q: -5, r: 16 }, { q: -1, r: 17 }, { q: 1, r: 17 },
    { q: 3, r: 16 }, { q: 5, r: 15 }, { q: 7, r: 14 }, { q: 9, r: 13 },
    { q: -7, r: 16 }, { q: -3, r: 17 }, { q: 3, r: 17 }, { q: 6, r: 15 },
  ];
  asteroids.push(...beltHexes);
  return asteroids;
}

// --- Map builder ---

export function buildSolarSystemMap(): SolarSystemMap {
  const hexes = new Map<string, MapHex>();
  const bodies: CelestialBody[] = [];

  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;

  function trackBounds(h: HexCoord) {
    minQ = Math.min(minQ, h.q);
    maxQ = Math.max(maxQ, h.q);
    minR = Math.min(minR, h.r);
    maxR = Math.max(maxR, h.r);
  }

  function ensureHex(coord: HexCoord): MapHex {
    const key = hexKey(coord);
    let hex = hexes.get(key);
    if (!hex) {
      hex = { terrain: 'space' };
      hexes.set(key, hex);
    }
    trackBounds(coord);
    return hex;
  }

  for (const def of BODY_DEFS) {
    const surfaceHexes: HexCoord[] = [];
    const gravityHexes: HexCoord[] = [];

    // Surface hexes (the body itself)
    if (def.surfaceRadius === 0) {
      surfaceHexes.push(def.center);
    } else {
      surfaceHexes.push(def.center);
      for (let ring = 1; ring <= def.surfaceRadius; ring++) {
        surfaceHexes.push(...hexRing(def.center, ring));
      }
    }

    // Mark surface hexes
    for (const sh of surfaceHexes) {
      const hex = ensureHex(sh);
      hex.terrain = def.destructive ? 'sunSurface' : 'planetSurface';
      hex.body = { name: def.name, destructive: def.destructive };
    }

    // Mark base hexes — always on the first gravity ring (surfaceRadius + 1 from center)
    // This ensures ships start outside the body surface and can escape gravity on takeoff
    for (const dir of def.baseDirections) {
      let baseHex = def.center;
      for (let i = 0; i < def.surfaceRadius + 1; i++) {
        baseHex = hexNeighbor(baseHex, dir);
      }
      const hex = ensureHex(baseHex);
      hex.base = { name: `${def.name} Base`, bodyName: def.name };
    }

    // Gravity hexes (rings outside the surface)
    for (let ring = def.surfaceRadius + 1; ring <= def.surfaceRadius + def.gravityRings; ring++) {
      const ringHexes = hexRing(def.center, ring);
      for (const gh of ringHexes) {
        // Don't override another body's surface
        const existing = hexes.get(hexKey(gh));
        if (existing && (existing.terrain === 'planetSurface' || existing.terrain === 'sunSurface')) {
          continue;
        }
        const hex = ensureHex(gh);
        // Direction should point toward the body center
        const dir = hexDirectionToward(gh, def.center);
        hex.gravity = {
          direction: dir,
          strength: def.gravityStrength,
          bodyName: def.name,
        };
        gravityHexes.push(gh);
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

  // Asteroid hexes
  for (const ah of generateAsteroidHexes()) {
    const hex = ensureHex(ah);
    if (hex.terrain === 'space') {
      hex.terrain = 'asteroid';
    }
  }

  return {
    hexes,
    bodies,
    bounds: { minQ, maxQ, minR, maxR },
  };
}

// --- Scenario definitions ---

export const SCENARIOS: Record<string, ScenarioDefinition> = {
  biplanetary: {
    name: 'Bi-Planetary',
    description: '1v1 corvettes race to land on the opponent\'s world',
    players: [
      {
        ships: [{ type: 'corvette', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } }],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [{ type: 'corvette', position: { q: -5, r: -7 }, velocity: { dq: 0, dr: 0 } }],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
    ],
  },
  escape: {
    name: 'Escape',
    description: '3 pilgrim transports flee Terra — enforcers must stop them',
    players: [
      {
        // Pilgrims: 3 transports at Terra, must escape the solar system
        ships: [
          { type: 'transport', position: { q: -12, r: 5 }, velocity: { dq: 0, dr: 0 } },
          { type: 'transport', position: { q: -12, r: 5 }, velocity: { dq: 0, dr: 0 } },
          { type: 'transport', position: { q: -12, r: 5 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: true,
      },
      {
        // Enforcers: corvette near Terra, corsair near Venus
        ships: [
          { type: 'corvette', position: { q: -10, r: 5 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
          { type: 'corsair', position: { q: -3, r: -7 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Venus',
        escapeWins: false,
      },
    ],
  },
  convoy: {
    name: 'Convoy',
    description: 'Escort a tanker from Mars to Venus — pirates intercept',
    players: [
      {
        // Convoy: tanker + corvette escort, starting from Mars
        ships: [
          { type: 'tanker', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } },
          { type: 'corvette', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        // Pirates: 2 corsairs lurking in the asteroid belt
        ships: [
          { type: 'corsair', position: { q: 3, r: 3 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
          { type: 'corsair', position: { q: -2, r: 5 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: '',
        escapeWins: false,
      },
    ],
  },
  duel: {
    name: 'Duel',
    description: 'Frigates clash near Mercury — last ship standing wins',
    players: [
      {
        ships: [
          { type: 'frigate', position: { q: 5, r: -3 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 8, r: -2 }],
        escapeWins: false,
      },
      {
        ships: [
          { type: 'frigate', position: { q: 9, r: -1 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 6, r: -2 }],
        escapeWins: false,
      },
    ],
  },
  blockade: {
    name: 'Blockade Runner',
    description: 'Packet ship must reach Mars — dreadnaught blocks the way',
    players: [
      {
        // Runner: fast packet ship from Venus heading to Mars
        ships: [
          { type: 'packet', position: { q: -5, r: -7 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
      {
        // Blocker: powerful dreadnaught patrolling near the asteroid belt
        ships: [
          { type: 'dreadnaught', position: { q: 3, r: 2 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },
  fleetAction: {
    name: 'Fleet Action',
    description: 'Full fleet battle — corvettes, corsairs, and frigates clash',
    players: [
      {
        // Fleet 1: based at Mars
        ships: [
          { type: 'frigate', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } },
          { type: 'corsair', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } },
          { type: 'corvette', position: { q: 10, r: 8 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        // Fleet 2: based at Venus
        ships: [
          { type: 'frigate', position: { q: -5, r: -7 }, velocity: { dq: 0, dr: 0 } },
          { type: 'corsair', position: { q: -5, r: -7 }, velocity: { dq: 0, dr: 0 } },
          { type: 'corvette', position: { q: -5, r: -7 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: '',
        homeBody: 'Venus',
        escapeWins: false,
      },
    ],
  },
};

// Singleton map instance
let _map: SolarSystemMap | null = null;

export function getSolarSystemMap(): SolarSystemMap {
  if (!_map) {
    _map = buildSolarSystemMap();
  }
  return _map;
}

export function findBaseHexes(map: SolarSystemMap, bodyName: string): HexCoord[] {
  const bases: HexCoord[] = [];
  for (const [key, hex] of map.hexes) {
    if (hex.base?.bodyName === bodyName) {
      const [q, r] = key.split(',').map(Number);
      bases.push({ q, r });
    }
  }
  return bases;
}

// Helper: find a base hex for a body (first base found)
export function findBaseHex(map: SolarSystemMap, bodyName: string): HexCoord | null {
  return findBaseHexes(map, bodyName)[0] ?? null;
}
