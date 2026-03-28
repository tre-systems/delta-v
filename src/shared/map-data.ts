import {
  type HexCoord,
  type HexKey,
  hexDirectionToward,
  hexKey,
  hexNeighbor,
  hexRing,
  parseHexKey,
} from './hex';
import type {
  CelestialBody,
  MapHex,
  ScenarioDefinition,
  SolarSystemMap,
} from './types';

// --- Body definitions ---
// Sol is center-south; Venus SW; Mercury near Sol SE;
// Terra NE; Mars NW; asteroid belt in the middle band;
// Jupiter and moons at top.
// Flat-top hex grid, q increases right, r increases
// down-right.
// Directions: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE

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
    center: { q: 10, r: -8 },
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
    center: { q: 14, r: -10 },
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
    center: { q: -4, r: -14 },
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
    baseDirections: [0],
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
    baseDirections: [3],
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

// --- Asteroid belt hexes ---
// Scattered between Mars/Terra and Jupiter orbits,
// positioned in the band between inner planets and
// Jupiter.

const generateAsteroidHexes = (): HexCoord[] => [
  { q: -6, r: -11 },
  { q: -4, r: -12 },
  { q: -2, r: -13 },
  { q: 0, r: -13 },
  { q: 2, r: -12 },
  { q: 4, r: -11 },
  { q: 6, r: -10 },
  { q: 8, r: -10 },
  { q: -8, r: -12 },
  { q: -5, r: -13 },
  { q: -1, r: -14 },
  { q: 1, r: -14 },
  { q: 3, r: -13 },
  { q: 5, r: -12 },
  { q: 7, r: -11 },
  { q: 9, r: -11 },
  { q: -7, r: -13 },
  { q: -3, r: -15 },
  { q: 3, r: -15 },
  { q: 6, r: -13 },
];

// --- Map builder ---

export const buildSolarSystemMap = (): SolarSystemMap => {
  const hexes = new Map<HexKey, MapHex>();
  const bodies: CelestialBody[] = [];
  const gravityBodies = new Set<string>();

  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;

  const trackBounds = (h: HexCoord) => {
    minQ = Math.min(minQ, h.q);
    maxQ = Math.max(maxQ, h.q);
    minR = Math.min(minR, h.r);
    maxR = Math.max(maxR, h.r);
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
      hex.body = {
        name: def.name,
        destructive: def.destructive,
      };
    }

    // Mark base hexes — always on the first gravity
    // ring (surfaceRadius + 1 from center). This
    // ensures ships start outside the body surface
    // and can escape gravity on takeoff.
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

    // Gravity hexes (rings outside the surface)
    for (
      let ring = def.surfaceRadius + 1;
      ring <= def.surfaceRadius + def.gravityRings;
      ring++
    ) {
      const ringHexes = hexRing(def.center, ring);

      for (const gh of ringHexes) {
        // Don't override another body's surface
        const existing = hexes.get(hexKey(gh));

        if (
          existing &&
          (existing.terrain === 'planetSurface' ||
            existing.terrain === 'sunSurface')
        ) {
          continue;
        }

        const hex = ensureHex(gh);
        // Direction should point toward the body
        // center
        const dir = hexDirectionToward(gh, def.center);
        hex.gravity = {
          direction: dir,
          strength: def.gravityStrength,
          bodyName: def.name,
        };
        gravityBodies.add(def.name);
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
    gravityBodies,
    bounds: {
      minQ: minQ - 5,
      maxQ: maxQ + 5,
      minR: minR - 3,
      maxR: maxR + 5,
    },
  };
};

// --- Scenario definitions ---

export const SCENARIOS: Record<string, ScenarioDefinition> = {
  biplanetary: {
    name: 'Bi-Planetary',
    tags: ['Beginner'],
    description: '1v1 corvettes race to land on the ' + "opponent's world",
    players: [
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        bases: [
          { q: -9, r: -6 },
          { q: -8, r: -6 },
          { q: -10, r: -4 },
          { q: -8, r: -5 },
          { q: -10, r: -5 },
          { q: -9, r: -4 },
        ],
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -7, r: 7 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        bases: [
          { q: -9, r: 7 },
          { q: -5, r: 7 },
          { q: -5, r: 5 },
          { q: -7, r: 5 },
          { q: -9, r: 9 },
          { q: -7, r: 9 },
        ],
        escapeWins: false,
      },
    ],
  },

  escape: {
    name: 'Escape',
    tags: ['Asymmetric'],
    description:
      '3 pilgrim transports flee Terra ' + '— enforcers must stop them',
    rules: {
      allowedOrdnanceTypes: ['nuke'],
      planetaryDefenseEnabled: false,
      hiddenIdentityInspection: true,
      escapeEdge: 'north',
    },
    players: [
      {
        // Pilgrims: 3 transports at Terra
        ships: [
          {
            type: 'transport',
            position: { q: 8, r: -6 },
            velocity: { dq: -2, dr: 1 },
          },
          {
            type: 'transport',
            position: { q: 8, r: -6 },
            velocity: { dq: -2, dr: 1 },
          },
          {
            type: 'transport',
            position: { q: 8, r: -6 },
            velocity: { dq: -2, dr: 1 },
          },
        ],
        targetBody: '',
        homeBody: 'Terra',
        bases: [],
        escapeWins: true,
        hiddenIdentity: true,
      },
      {
        // Enforcers: 1 corvette orbiting Terra,
        // 1 corsair orbiting Venus
        ships: [
          {
            type: 'corvette',
            position: { q: 8, r: -7 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corsair',
            position: { q: -5, r: 5 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Venus',
        bases: [
          { q: 12, r: -10 },
          { q: 12, r: -8 },
          { q: 10, r: -10 },
          { q: 8, r: -8 },
          { q: 8, r: -6 },
          { q: 10, r: -6 },
          { q: -5, r: 7 },
          { q: -5, r: 5 },
          { q: -7, r: 5 },
          { q: -9, r: 7 },
          { q: -9, r: 9 },
          { q: -7, r: 9 },
          { q: 1, r: -22 },
        ],
        escapeWins: false,
      },
    ],
  },

  evacuation: {
    name: 'Lunar Evacuation',
    tags: ['Escort'],
    description:
      'A crowded transport flees Luna for Terra with a corvette escort ' +
      '— win only by landing survivors; a corsair tries to cut you off',
    rules: {
      logisticsEnabled: true,
      passengerRescueEnabled: true,
      targetWinRequiresPassengers: true,
    },
    players: [
      {
        ships: [
          {
            type: 'transport',
            position: { q: 13, r: -10 },
            velocity: { dq: -2, dr: 1 },
            startLanded: false,
            initialPassengers: 40,
          },
          {
            type: 'corvette',
            position: { q: 13, r: -10 },
            velocity: { dq: -2, dr: 1 },
            startLanded: false,
          },
        ],
        targetBody: 'Terra',
        homeBody: 'Luna',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corsair',
            position: { q: 11, r: -9 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: false,
      },
    ],
  },

  convoy: {
    name: 'Convoy',
    tags: ['Escort'],
    description:
      'Escort a liner with colonists (and tanker) from Mars to Venus ' +
      '— transfer passengers to safety; pirates intercept',
    rules: {
      logisticsEnabled: true,
      passengerRescueEnabled: true,
      targetWinRequiresPassengers: true,
    },
    players: [
      {
        // Convoy: colonist liner + tanker + frigate from Mars
        ships: [
          {
            type: 'liner',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
            initialPassengers: 120,
          },
          {
            type: 'tanker',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
          {
            type: 'frigate',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        escapeWins: false,
      },
      {
        // Pirates: two corsairs and a corvette
        // positioned to intercept
        ships: [
          {
            type: 'corsair',
            position: { q: -9, r: 2 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corsair',
            position: { q: -6, r: -1 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
          {
            type: 'corvette',
            position: { q: -7, r: -3 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: '',
        escapeWins: false,
      },
    ],
  },

  duel: {
    name: 'Duel',
    tags: ['Combat'],
    description: 'Frigates clash near Mercury ' + '— last ship standing wins',
    startingPlayer: 1,
    players: [
      {
        ships: [
          {
            type: 'frigate',
            position: { q: 3, r: 1 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 5, r: 2 }],
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'frigate',
            position: { q: 5, r: 3 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mercury',
        bases: [{ q: 3, r: 2 }],
        escapeWins: false,
      },
    ],
  },

  blockade: {
    name: 'Blockade Runner',
    tags: ['Speed'],
    description: 'Packet ship races past a corvette ' + 'to reach Mars',
    startingPlayer: 1,
    players: [
      {
        // Runner: fast packet ship from Venus with
        // a head start toward Mars
        ships: [
          {
            type: 'packet',
            position: { q: -7, r: 3 },
            velocity: { dq: 0, dr: -2 },
            startLanded: false,
          },
        ],
        targetBody: 'Mars',
        homeBody: 'Venus',
        escapeWins: false,
      },
      {
        // Blocker: corvette patrolling between
        // the planets
        ships: [
          {
            type: 'corvette',
            position: { q: -8, r: 1 },
            velocity: { dq: 0, dr: 0 },
            startLanded: false,
          },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },

  interplanetaryWar: {
    name: 'Interplanetary War',
    tags: ['Epic'],
    description:
      'Build your fleet with MegaCredits ' +
      '— total war across the solar system',
    rules: { logisticsEnabled: true },
    startingPlayer: 1,
    startingCredits: 850,
    availableShipTypes: [
      'transport',
      'packet',
      'tanker',
      'corvette',
      'corsair',
      'frigate',
      'dreadnaught',
      'torch',
      'orbitalBase',
    ],
    players: [
      {
        ships: [],
        targetBody: '',
        homeBody: 'Terra',
        escapeWins: false,
      },
      {
        ships: [],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },

  fleetAction: {
    name: 'Fleet Action',
    tags: ['Fleet'],
    description: 'Build your fleet and clash ' + '— Mars vs Venus',
    rules: { logisticsEnabled: true },
    startingPlayer: 1,
    startingCredits: 400,
    availableShipTypes: [
      'corvette',
      'corsair',
      'frigate',
      'dreadnaught',
      'torch',
    ],
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

  grandTour: {
    name: 'Grand Tour',
    tags: ['Race'],
    description:
      'Race past every major body in the solar ' + 'system and return home',
    rules: {
      combatDisabled: true,
      checkpointBodies: [
        'Sol',
        'Mercury',
        'Venus',
        'Terra',
        'Mars',
        'Jupiter',
        'Io',
        'Callisto',
      ],
      sharedBases: ['Terra', 'Venus', 'Mars', 'Callisto'],
    },
    players: [
      {
        ships: [
          {
            type: 'corvette',
            position: { q: 14, r: -10 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: '',
        homeBody: 'Luna',
        escapeWins: false,
      },
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: '',
        homeBody: 'Mars',
        escapeWins: false,
      },
    ],
  },
};

export const findBaseHexes = (
  map: SolarSystemMap,
  bodyName: string,
): HexCoord[] =>
  [...map.hexes.entries()]
    .filter(([, hex]) => hex.base?.bodyName === bodyName)
    .map(([key]) => parseHexKey(key));

// Helper: find a base hex for a body (first base found)
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
