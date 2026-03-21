import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import {
  getNearestEnemyPosition,
  getNextSelectedShip,
  getOwnFleetFocusPosition,
} from './navigation';

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

function createPlayers(): [PlayerState, PlayerState] {
  return [
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
}

function createState(ships: Ship[]): GameState {
  return {
    gameId: 'TEST',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships,
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: createPlayers(),
    winner: null,
    winReason: null,
  };
}

describe('game client navigation helpers', () => {
  it('cycles to the next available owned ship and wraps around', () => {
    const state = createState([
      createShip({ id: 'a', owner: 0 }),
      createShip({
        id: 'b',
        owner: 0,
        position: { q: 1, r: 0 },
      }),
      createShip({ id: 'c', owner: 1 }),
    ]);

    expect(getNextSelectedShip(state, 0, 'b', 1)?.id).toBe('a');
  });

  it('finds the nearest detected enemy to the camera center', () => {
    const state = createState([
      createShip({ id: 'self', owner: 0 }),
      createShip({
        id: 'far',
        owner: 1,
        position: { q: 6, r: 0 },
      }),
      createShip({
        id: 'near',
        owner: 1,
        position: { q: 1, r: 0 },
      }),
    ]);

    expect(getNearestEnemyPosition(state, 0, 0, 0, 28)).toEqual({ q: 1, r: 0 });
  });

  it('focuses the selected ship first, then falls back to the first alive ship', () => {
    const state = createState([
      createShip({
        id: 'a',
        owner: 0,
        position: { q: 3, r: 0 },
      }),
      createShip({
        id: 'b',
        owner: 0,
        position: { q: 1, r: 2 },
      }),
      createShip({ id: 'enemy', owner: 1 }),
    ]);

    expect(getOwnFleetFocusPosition(state, 0, 'b')).toEqual({ q: 1, r: 2 });

    expect(getOwnFleetFocusPosition(state, 0, null)).toEqual({ q: 3, r: 0 });
  });
});
