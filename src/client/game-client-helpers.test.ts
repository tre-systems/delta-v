import { describe, expect, it } from 'vitest';
import type { GameState, Ordnance, PlayerState, Ship } from '../shared/types';
import {
  buildAstrogationOrders,
  deriveHudViewModel,
  getGameOverStats,
  getScenarioBriefingLines,
} from './game-client-helpers';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'transport',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 10,
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

function createOrdnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'ord-0',
    type: 'mine',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    turnsRemaining: 5,
    destroyed: false,
    ...overrides,
  };
}

function createPlayers(): [PlayerState, PlayerState] {
  return [
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Terra',
      bases: ['0,0'],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Mars',
      bases: ['1,1'],
      escapeWins: false,
    },
  ];
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'TEST',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 3,
    phase: 'astrogation',
    activePlayer: 0,
    ships: [
      createShip({ id: 'p0s0', type: 'packet', cargoUsed: 10 }),
      createShip({ id: 'p0s1', type: 'transport', owner: 0, position: { q: 1, r: 0 } }),
      createShip({ id: 'p1s0', type: 'corsair', owner: 1, position: { q: 5, r: 0 } }),
    ],
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

describe('game client helpers', () => {
  it('builds astrogation orders for the active player only', () => {
    const state = createState();
    const planning = {
      selectedShipId: 'p0s0',
      burns: new Map([
        ['p0s0', 2],
        ['p0s1', null],
        ['p1s0', 5],
      ]),
      overloads: new Map([['p0s0', 4]]),
      weakGravityChoices: new Map([['p0s0', { '2,1': true }]]),
    };

    expect(buildAstrogationOrders(state, 0, planning)).toEqual([
      {
        shipId: 'p0s0',
        burn: 2,
        overload: 4,
        weakGravityChoices: { '2,1': true },
      },
      {
        shipId: 'p0s1',
        burn: null,
      },
    ]);
  });

  it('derives HUD state for hidden-identity escape play', () => {
    const state = createState({
      phase: 'ordnance',
      ships: [
        createShip({
          id: 'p0s0',
          type: 'frigate',
          fuel: 14,
          cargoUsed: 20,
          carryingOrbitalBase: true,
          hasFugitives: true,
        }),
        createShip({ id: 'p0s1', type: 'packet', owner: 0, destroyed: true }),
        createShip({ id: 'p1s0', type: 'corsair', owner: 1, destroyed: true }),
      ],
      ordnance: [createOrdnance({ type: 'mine' }), createOrdnance({ id: 'ord-1', type: 'nuke', owner: 1 })],
      players: [
        {
          ...createPlayers()[0],
          escapeWins: true,
        },
        createPlayers()[1],
      ],
    });
    const planning = {
      selectedShipId: 'p0s0',
      burns: new Map([['p0s0', 1]]),
      overloads: new Map(),
      weakGravityChoices: new Map(),
    };

    expect(deriveHudViewModel(state, 0, planning)).toMatchObject({
      turn: 3,
      phase: 'ordnance',
      isMyTurn: true,
      selectedId: 'p0s0',
      fuel: 14,
      maxFuel: 20,
      hasBurns: true,
      cargoFree: 20,
      cargoMax: 40,
      objective: '⬡ Escape the ★ ship',
      canOverload: true,
      canEmplaceBase: true,
      fleetStatus: '⚔ 1v0 1M/1N',
    });
  });

  it('computes game-over ship counts from the final state', () => {
    const state = createState({
      phase: 'gameOver',
      ships: [
        createShip({ id: 'p0s0', owner: 0, destroyed: false }),
        createShip({ id: 'p0s1', owner: 0, destroyed: true }),
        createShip({ id: 'p1s0', owner: 1, destroyed: true }),
      ],
    });

    expect(getGameOverStats(state, 0)).toEqual({
      turns: 3,
      myShipsAlive: 1,
      myShipsTotal: 2,
      enemyShipsAlive: 0,
      enemyShipsTotal: 1,
    });
  });

  it('builds scenario briefing lines from player perspective', () => {
    const state = createState({
      ships: [
        createShip({ id: 'p0s0', owner: 0, type: 'transport' }),
        createShip({ id: 'p0s1', owner: 0, type: 'packet' }),
        createShip({ id: 'p1s0', owner: 1, type: 'corsair' }),
      ],
      players: [
        {
          ...createPlayers()[0],
          targetBody: 'Venus',
        },
        createPlayers()[1],
      ],
    });

    expect(getScenarioBriefingLines(state, 0)).toEqual([
      'Your fleet: Transport, Packet',
      'Objective: Land on Venus',
      'Press ? for controls help',
    ]);
  });
});
