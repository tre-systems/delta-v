import { describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap } from '../shared/map-data';
import type { AstrogationOrder, CombatAttack, GameState, OrdnanceLaunch, PlayerState, Ship } from '../shared/types';
import { deriveAIActionPlan } from './game-client-ai-flow';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-1',
    type: 'packet',
    owner: 1,
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
    { connected: true, ready: true, targetBody: 'Mars', homeBody: 'Terra', bases: [], escapeWins: false },
    { connected: true, ready: true, targetBody: 'Terra', homeBody: 'Mars', bases: [], escapeWins: false },
  ];
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'AI',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 2,
    phase: 'astrogation',
    activePlayer: 1,
    ships: [
      createShip({ id: 'player-ship', owner: 0, position: { q: 3, r: 0 } }),
      createShip({ id: 'ai-ship', owner: 1 }),
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

describe('game-client-ai-flow', () => {
  it('returns none when there is no active AI turn', () => {
    const map = buildSolarSystemMap();

    expect(deriveAIActionPlan(null, 0, map, 'normal')).toEqual({ kind: 'none' });
    expect(deriveAIActionPlan(createState({ activePlayer: 0 }), 0, map, 'normal')).toEqual({ kind: 'none' });
    expect(deriveAIActionPlan(createState({ phase: 'gameOver' }), 0, map, 'normal')).toEqual({ kind: 'none' });
  });

  it('derives astrogation actions from the injected generator', () => {
    const map = buildSolarSystemMap();
    const orders: AstrogationOrder[] = [{ shipId: 'ai-ship', burn: 2 }];
    const astrogation = vi.fn(() => orders);

    expect(
      deriveAIActionPlan(createState({ phase: 'astrogation' }), 0, map, 'normal', {
        astrogation,
        ordnance: vi.fn(() => []),
        combat: vi.fn(() => []),
      }),
    ).toEqual({
      kind: 'astrogation',
      aiPlayer: 1,
      orders,
      errorPrefix: 'AI astrogation error:',
    });
  });

  it('derives ordnance actions, skip behavior, and log entries', () => {
    const map = buildSolarSystemMap();
    const launches: OrdnanceLaunch[] = [{ shipId: 'ai-ship', ordnanceType: 'mine' }];

    expect(
      deriveAIActionPlan(createState({ phase: 'ordnance' }), 0, map, 'normal', {
        astrogation: vi.fn(() => []),
        ordnance: vi.fn(() => launches),
        combat: vi.fn(() => []),
      }),
    ).toEqual({
      kind: 'ordnance',
      aiPlayer: 1,
      launches,
      logEntries: ['AI: Packet launched mine'],
      skip: false,
      errorPrefix: 'AI ordnance error:',
    });

    expect(
      deriveAIActionPlan(createState({ phase: 'ordnance' }), 0, map, 'normal', {
        astrogation: vi.fn(() => []),
        ordnance: vi.fn(() => []),
        combat: vi.fn(() => []),
      }),
    ).toEqual({
      kind: 'ordnance',
      aiPlayer: 1,
      launches: [],
      logEntries: [],
      skip: true,
      errorPrefix: 'AI skip ordnance error:',
    });
  });

  it('derives combat actions, including pending-hazard start and skip paths', () => {
    const map = buildSolarSystemMap();
    const attacks: CombatAttack[] = [{ attackerIds: ['ai-ship'], targetId: 'player-ship' }];

    expect(
      deriveAIActionPlan(
        createState({
          phase: 'combat',
          pendingAsteroidHazards: [{ shipId: 'ai-ship', hex: { q: 0, r: 0 } }],
        }),
        0,
        map,
        'normal',
      ),
    ).toEqual({
      kind: 'beginCombat',
      aiPlayer: 1,
      errorPrefix: 'AI combat start error:',
    });

    expect(
      deriveAIActionPlan(createState({ phase: 'combat' }), 0, map, 'normal', {
        astrogation: vi.fn(() => []),
        ordnance: vi.fn(() => []),
        combat: vi.fn(() => attacks),
      }),
    ).toEqual({
      kind: 'combat',
      aiPlayer: 1,
      attacks,
      skip: false,
      errorPrefix: 'AI combat error:',
    });

    expect(
      deriveAIActionPlan(createState({ phase: 'combat' }), 0, map, 'normal', {
        astrogation: vi.fn(() => []),
        ordnance: vi.fn(() => []),
        combat: vi.fn(() => []),
      }),
    ).toEqual({
      kind: 'combat',
      aiPlayer: 1,
      attacks: [],
      skip: true,
      errorPrefix: 'AI skip combat error:',
    });
  });

  it('falls back to transition for non-action AI phases', () => {
    const map = buildSolarSystemMap();

    expect(deriveAIActionPlan(createState({ phase: 'resupply' }), 0, map, 'normal')).toEqual({
      kind: 'transition',
      aiPlayer: 1,
    });
  });
});
