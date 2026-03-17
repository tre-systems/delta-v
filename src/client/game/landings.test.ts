import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship, ShipMovement } from '../../shared/types';
import { deriveLandingLogEntries } from './landings';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'packet',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 5,
    cargoUsed: 0,
    nukesLaunchedSinceResupply: 0,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

function createPlayers(): [PlayerState, PlayerState] {
  return [
    { connected: true, ready: true, targetBody: 'Mars', homeBody: 'Terra', bases: ['1,0'], escapeWins: false },
    { connected: true, ready: true, targetBody: 'Terra', homeBody: 'Mars', bases: [], escapeWins: false },
  ];
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'LAND',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'movement',
    activePlayer: 0,
    ships: [createShip(), createShip({ id: 'enemy', owner: 1, type: 'corsair' })],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: createPlayers(),
    winner: null,
    winReason: null,
    ...overrides,
  };
}

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
        crashed: false,
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
        crashed: false,
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
        crashed: false,
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
        crashed: false,
        landedAt: null,
      },
    ];

    expect(deriveLandingLogEntries(null, movements)).toEqual([]);
    expect(deriveLandingLogEntries(createState(), movements)).toEqual([]);
  });
});
