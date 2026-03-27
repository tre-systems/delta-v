import { describe, expect, it } from 'vitest';

import { asHexKey } from '../../shared/hex';
import type {
  GameState,
  PlayerState,
  Ship,
  ShipMovement,
} from '../../shared/types/domain';
import { deriveLandingLogEntries } from './landings';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
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
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'LAND',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'movement',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({
      id: 'enemy',
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

describe('game-client-landings', () => {
  it('builds landing log entries and resupply text from completed landings', () => {
    const movements: ShipMovement[] = [
      {
        shipId: 'ship-0',
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
        shipId: 'enemy',
        from: { q: 2, r: 0 },
        to: { q: 2, r: 1 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'landing',
        landedAt: 'Venus',
      },
    ];

    expect(deriveLandingLogEntries(createState(), movements)).toEqual([
      {
        destination: { q: 1, r: 0 },
        shipName: 'Packet',
        bodyName: 'Mars',
        resupplyText: '  Packet resupplied: fuel + cargo restored',
      },
      {
        destination: { q: 2, r: 1 },
        shipName: 'Corsair',
        bodyName: 'Venus',
        resupplyText: null,
      },
    ]);
  });

  it('ignores missing state, non-landings, and missing ships', () => {
    const movements: ShipMovement[] = [
      {
        shipId: 'missing',
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
        shipId: 'ship-0',
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 0, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'normal',
      },
    ];

    expect(deriveLandingLogEntries(null, movements)).toEqual([]);

    expect(deriveLandingLogEntries(createState(), movements)).toEqual([]);
  });
});
