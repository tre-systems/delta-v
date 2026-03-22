import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveGameOverPlan } from './endgame';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
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
    targetBody: '',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'END',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 7,
  phase: 'gameOver',
  activePlayer: 0,
  ships: [
    createShip({ id: 'p0a', owner: 0 }),
    createShip({
      id: 'p0b',
      owner: 0,
      lifecycle: 'destroyed',
    }),
    createShip({ id: 'p1a', owner: 1 }),
    createShip({
      id: 'p1b',
      owner: 1,
      lifecycle: 'destroyed',
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  winner: 0,
  winReason: 'Fleet eliminated!',
  ...overrides,
});

describe('game-client-endgame', () => {
  it('derives victory presentation with surviving loser ships for animation', () => {
    expect(
      deriveGameOverPlan(createState(), 0, true, 'Fleet eliminated!'),
    ).toEqual({
      stats: {
        turns: 7,
        myShipsAlive: 1,
        myShipsTotal: 2,
        enemyShipsAlive: 1,
        enemyShipsTotal: 2,
      },
      logText: 'VICTORY: Fleet eliminated!',
      logClass: 'log-landed',
      loserShipIds: ['p1a'],
      resultSound: 'victory',
    });
  });

  it('derives defeat presentation and falls back cleanly with no state', () => {
    expect(
      deriveGameOverPlan(createState(), 0, false, 'Transport destroyed'),
    ).toMatchObject({
      logText: 'DEFEAT: Transport destroyed',
      logClass: 'log-eliminated',
      loserShipIds: ['p0a'],
      resultSound: 'defeat',
    });

    expect(deriveGameOverPlan(null, 0, true, 'Disconnected')).toEqual({
      stats: undefined,
      logText: 'VICTORY: Disconnected',
      logClass: 'log-landed',
      loserShipIds: [],
      resultSound: 'victory',
    });
  });
});
