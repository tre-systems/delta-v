import { describe, expect, it } from 'vitest';

import { asHexKey, type HexKey } from '../../shared/hex';
import { asGameId, asShipId } from '../../shared/ids';
import type {
  GameState,
  MapHex,
  PlayerState,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import { deriveLandingLogEntries } from './landings';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 5,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: 'Mars',
    homeBody: 'Terra',
    bases: [asHexKey('1,0')],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Terra',
    homeBody: 'Mars',
    bases: [asHexKey('3,0')],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('LAND'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({
      id: asShipId('enemy'),
      owner: 1,
      originalOwner: 0,
      type: 'corsair',
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
  ...overrides,
});

// Build a minimal map fixture marking which hexes have bases so
// deriveLandingLogEntries can distinguish neutral vs bare-body landings.
const buildMap = (
  baseHexes: Array<{ q: number; r: number; bodyName: string }>,
): SolarSystemMap => {
  const hexes = new Map<HexKey, MapHex>();
  for (const { q, r, bodyName } of baseHexes) {
    hexes.set(asHexKey(`${q},${r}`), {
      base: { name: `${bodyName} Base`, bodyName },
    } as MapHex);
  }
  return {
    hexes,
    bodies: [],
    bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
  };
};

describe('game-client-landings', () => {
  it('records resupply text when landing at an owned base', () => {
    const map = buildMap([
      { q: 1, r: 0, bodyName: 'Mars' },
      { q: 3, r: 0, bodyName: 'Venus' },
    ]);
    const movements: ShipMovement[] = [
      {
        shipId: asShipId('ship-0'),
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Mars',
      },
    ];

    expect(deriveLandingLogEntries(createState(), movements, map)).toEqual([
      {
        destination: { q: 1, r: 0 },
        shipName: 'Packet',
        bodyName: 'Mars',
        reasonText: '  Packet resupplied: fuel + cargo restored',
        reasonClass: 'log-info',
      },
    ]);
  });

  it('classifies no-resupply reasons: enemy, neutral, bare body, destroyed', () => {
    const map = buildMap([
      // Neutral base on Venus (no player owns {2,1}).
      { q: 2, r: 1, bodyName: 'Venus' },
      // Enemy-owned base at {3,0} (see createPlayers()).
      { q: 3, r: 0, bodyName: 'Terra' },
      // Destroyed base at {4,0} — see state override below.
      { q: 4, r: 0, bodyName: 'Luna' },
    ]);
    const movements: ShipMovement[] = [
      {
        shipId: asShipId('ship-0'),
        from: { q: 2, r: 0 },
        to: { q: 2, r: 1 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Venus',
      },
      {
        shipId: asShipId('ship-0'),
        from: { q: 3, r: 1 },
        to: { q: 3, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Terra',
      },
      {
        shipId: asShipId('ship-0'),
        from: { q: 5, r: 0 },
        to: { q: 5, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Ceres',
      },
      {
        shipId: asShipId('ship-0'),
        from: { q: 4, r: 1 },
        to: { q: 4, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Luna',
      },
    ];
    const state = createState({
      destroyedBases: [asHexKey('4,0')],
    });

    const reasons = deriveLandingLogEntries(state, movements, map).map(
      (entry) => entry.reasonText,
    );

    expect(reasons).toEqual([
      '  No resupply — neutral base (not yours)',
      '  No resupply — enemy-controlled base',
      '  No resupply — no base on this body',
      '  No resupply — base destroyed',
    ]);
  });

  it('falls back to "no base" when map data is unavailable', () => {
    const movements: ShipMovement[] = [
      {
        shipId: asShipId('ship-0'),
        from: { q: 0, r: 0 },
        to: { q: 9, r: 9 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 0,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Venus',
      },
    ];

    expect(deriveLandingLogEntries(createState(), movements, null)).toEqual([
      {
        destination: { q: 9, r: 9 },
        shipName: 'Packet',
        bodyName: 'Venus',
        reasonText: '  No resupply — no base on this body',
        reasonClass: 'log-env',
      },
    ]);
  });

  it('ignores missing state, non-landings, and missing ships', () => {
    const map = buildMap([]);
    const movements: ShipMovement[] = [
      {
        shipId: asShipId('missing'),
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Mars',
      },
      {
        shipId: asShipId('ship-0'),
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'normal',
      },
    ];

    expect(deriveLandingLogEntries(null, movements, map)).toEqual([]);
    expect(deriveLandingLogEntries(createState(), movements, map)).toEqual([]);
  });
});
