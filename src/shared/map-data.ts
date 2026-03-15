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
// Sol is center-south; Venus SW; Mercury near Sol SE; Terra NE; Mars NW;
// asteroid belt in the middle band; Jupiter and moons at top.
// Flat-top hex grid, q increases right, r increases down-right.
// Directions: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE

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
    center: { q: 4, r: 2 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#b0a090',
    renderRadius: 0.6,
    baseDirections: [0, 3], // E and W — rules: "Mercury has two [bases]"
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
    baseDirections: [0, 1, 2, 3, 4, 5], // all 6 sides — rules: "Venus have bases on all six sides"
  },
  {
    name: 'Terra',
    center: { q: 10, r: -8 },
    surfaceRadius: 1,
    gravityRings: 1,
    gravityStrength: 'full',
    destructive: false,
    color: '#4488cc',
    renderRadius: 1.2,
    baseDirections: [0, 1, 2, 3, 4, 5], // rules: "Terra ... have bases on all six sides"
  },
  {
    name: 'Luna',
    center: { q: 13, r: -9 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccccc',
    renderRadius: 0.45,
    baseDirections: [0, 1, 2, 3, 4, 5], // rules: "Luna ... have bases on all six sides"
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
    baseDirections: [0, 1, 2, 3, 4, 5], // rules: "Mars ... have bases on all six sides"
  },
  {
    name: 'Ceres',
    center: { q: -4, r: -14 },
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
    center: { q: 2, r: -24 },
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
    center: { q: 0, r: -22 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#cccc44',
    renderRadius: 0.4,
    baseDirections: [0], // E — rules: "Io [has] one base"
  },
  {
    name: 'Callisto',
    center: { q: -2, r: -23 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#998877',
    renderRadius: 0.4,
    baseDirections: [3], // W — rules: "Callisto have only one base each"
  },
  {
    name: 'Ganymede',
    center: { q: 5, r: -26 },
    surfaceRadius: 0,
    gravityRings: 1,
    gravityStrength: 'weak',
    destructive: false,
    color: '#aaa099',
    renderRadius: 0.45,
    baseDirections: [],
  },
];

// --- Asteroid belt hexes (scattered between Mars/Terra and Jupiter orbits) ---
// Positioned in the band between inner planets and Jupiter

function generateAsteroidHexes(): HexCoord[] {
  const asteroids: HexCoord[] = [];
  // Scatter asteroid hexes across the belt region (roughly r=-10 to r=-18)
  const beltHexes: HexCoord[] = [
    { q: -6, r: -11 }, { q: -4, r: -12 }, { q: -2, r: -13 }, { q: 0, r: -13 },
    { q: 2, r: -12 }, { q: 4, r: -11 }, { q: 6, r: -10 }, { q: 8, r: -10 },
    { q: -8, r: -12 }, { q: -5, r: -13 }, { q: -1, r: -14 }, { q: 1, r: -14 },
    { q: 3, r: -13 }, { q: 5, r: -12 }, { q: 7, r: -11 }, { q: 9, r: -11 },
    { q: -7, r: -13 }, { q: -3, r: -15 }, { q: 3, r: -15 }, { q: 6, r: -13 },
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
    // Rules: "One player starts with a corvette on Mars, one on Venus.
    // Each player must navigate to the other world and land.
    // The winner is the one who does it in the fewest turns."
    name: 'Bi-Planetary',
    description: '1v1 corvettes race to land on the opponent\'s world',
    players: [
      {
        ships: [{ type: 'corvette', position: { q: -9, r: -5 }, velocity: { dq: 0, dr: 0 } }],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [{ type: 'corvette', position: { q: -7, r: 7 }, velocity: { dq: 0, dr: 0 } }],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
    ],
  },
  escape: {
    // Rules: "The Pilgrims receive three transports on Terra.
    // The Enforcers receive one corvette in orbit around Terra
    // and a corsair in orbit around Venus."
    // "Mines and torpedoes are not available to either player."
    // "Only Terra, Venus, and Io have bases. All bases belong to the Enforcers.
    //  Planetary defenses are not operating."
    name: 'Escape',
    description: '3 pilgrim transports flee Terra — enforcers must stop them',
    rules: {
      allowedOrdnanceTypes: ['nuke'],
      planetaryDefenseEnabled: false,
      hiddenIdentityInspection: true,
      escapeEdge: 'north',
    },
    players: [
      {
        // Pilgrims: 3 transports at Terra, launching outward
        ships: [
          { type: 'transport', position: { q: 8, r: -6 }, velocity: { dq: -2, dr: 1 } },
          { type: 'transport', position: { q: 8, r: -6 }, velocity: { dq: -2, dr: 1 } },
          { type: 'transport', position: { q: 8, r: -6 }, velocity: { dq: -2, dr: 1 } },
        ],
        targetBody: '',
        homeBody: 'Terra',
        bases: [],
        escapeWins: true,
        hiddenIdentity: true,
      },
      {
        // Enforcers: 1 corvette orbiting Terra, 1 corsair orbiting Venus
        ships: [
          { type: 'corvette', position: { q: 12, r: -9 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
          { type: 'corsair', position: { q: -5, r: 7 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Venus',
        bases: [
          { q: 12, r: -8 }, { q: 12, r: -10 }, { q: 10, r: -10 },
          { q: 8, r: -8 }, { q: 8, r: -6 }, { q: 10, r: -6 },
          { q: -5, r: 7 }, { q: -5, r: 5 }, { q: -7, r: 5 },
          { q: -9, r: 7 }, { q: -9, r: 9 }, { q: -7, r: 9 },
          { q: 1, r: -22 },
        ],
        escapeWins: false,
      },
    ],
  },
  convoy: {
    // Custom scenario: escort a tanker through hostile space
    name: 'Convoy',
    description: 'Escort a tanker from Mars to Venus — pirates intercept',
    players: [
      {
        // Convoy: tanker + frigate escort, starting from Mars
        ships: [
          { type: 'tanker', position: { q: -9, r: -5 }, velocity: { dq: 0, dr: 0 } },
          { type: 'frigate', position: { q: -9, r: -5 }, velocity: { dq: 0, dr: 0 } },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        // Pirates: 3 corsairs positioned to intercept the Mars→Venus route
        ships: [
          { type: 'corsair', position: { q: -8, r: 0 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
          { type: 'corsair', position: { q: -6, r: -2 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
          { type: 'corsair', position: { q: -9, r: 2 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: '',
        escapeWins: false,
      },
    ],
  },
  duel: {
    // Custom combat training scenario near Mercury
    name: 'Duel',
    description: 'Frigates clash near Mercury — last ship standing wins',
    players: [
      {
        ships: [
          { type: 'frigate', position: { q: 3, r: 1 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 5, r: 2 }],
        escapeWins: false,
      },
      {
        ships: [
          { type: 'frigate', position: { q: 5, r: 3 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 3, r: 2 }],
        escapeWins: false,
      },
    ],
  },
  blockade: {
    // Custom asymmetric scenario: speed vs firepower
    name: 'Blockade Runner',
    description: 'Packet ship races past a corvette to reach Mars',
    players: [
      {
        // Runner: fast packet ship from Venus heading toward Mars
        ships: [
          { type: 'packet', position: { q: -7, r: 5 }, velocity: { dq: 0, dr: -2 }, startLanded: false },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
      {
        // Blocker: corvette patrolling between the planets (less firepower = fairer)
        ships: [
          { type: 'corvette', position: { q: -8, r: -1 }, velocity: { dq: 0, dr: 0 }, startLanded: false },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },
  interplanetaryWar: {
    // Rules: "The Terran player selects a fleet using the MegaCredit system
    // and an allowance of MCr 1600. Terran ships may be placed on – or in orbit
    // around – Terra, Luna, and Venus."
    // "The Rebel player selects a fleet using an allowance of MCr 1000.
    // Rebel ships may be placed on – or in orbit around – Callisto, Io,
    // Ganymede, and Mars."
    // Simplified: equal credits, single homeBody each
    name: 'Interplanetary War',
    description: 'Build your fleet with MegaCredits — total war across the solar system',
    startingCredits: 800,
    availableShipTypes: ['transport', 'packet', 'tanker', 'corvette', 'corsair', 'frigate', 'dreadnaught', 'torch'],
    players: [
      {
        ships: [],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: false,
      },
    ],
  },
  fleetAction: {
    // Custom fleet battle scenario with fleet building
    name: 'Fleet Action',
    description: 'Build your fleet and clash — Mars vs Venus',
    startingCredits: 400,
    availableShipTypes: ['corvette', 'corsair', 'frigate', 'dreadnaught', 'torch'],
    players: [
      {
        ships: [],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        ships: [],
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
