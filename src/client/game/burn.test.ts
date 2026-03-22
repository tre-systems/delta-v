import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveBurnChangePlan } from './burn';

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
    bases: [],
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

const createState = (ship: Ship): GameState => ({
  gameId: 'BURN',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [ship],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  winner: null,
  winReason: null,
});

describe('game-client-burn', () => {
  it('requires a selected ship before changing burns', () => {
    expect(
      deriveBurnChangePlan(createState(createShip()), null, 2, null),
    ).toEqual({
      kind: 'error',
      message: 'Select a ship first',
      level: 'info',
    });
  });

  it('ignores missing or destroyed ships', () => {
    expect(
      deriveBurnChangePlan(createState(createShip()), 'missing', 2, null),
    ).toEqual({
      kind: 'noop',
    });

    expect(
      deriveBurnChangePlan(
        createState(createShip({ lifecycle: 'destroyed' })),
        'ship-0',
        2,
        null,
      ),
    ).toEqual({
      kind: 'noop',
    });
  });

  it('rejects disabled and fuel-starved ships', () => {
    expect(
      deriveBurnChangePlan(
        createState(
          createShip({
            damage: { disabledTurns: 2 },
          }),
        ),
        'ship-0',
        2,
        null,
      ),
    ).toEqual({
      kind: 'error',
      message: 'Ship disabled for 2 more turn(s)',
      level: 'error',
    });

    expect(
      deriveBurnChangePlan(
        createState(createShip({ fuel: 0 })),
        'ship-0',
        2,
        null,
      ),
    ).toEqual({
      kind: 'error',
      message: 'No fuel remaining',
      level: 'error',
    });
  });

  it('toggles burns and clears overloads when choosing a new direction', () => {
    expect(
      deriveBurnChangePlan(createState(createShip()), 'ship-0', 2, null),
    ).toEqual({
      kind: 'update',
      shipId: 'ship-0',
      nextBurn: 2,
      clearOverload: true,
    });

    expect(
      deriveBurnChangePlan(createState(createShip()), 'ship-0', 2, 2),
    ).toEqual({
      kind: 'update',
      shipId: 'ship-0',
      nextBurn: null,
      clearOverload: false,
    });
  });
});
