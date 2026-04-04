import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveGameOverPlan } from './endgame';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
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
  gameId: asGameId('END'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 7,
  phase: 'gameOver',
  activePlayer: 0,
  ships: [
    createShip({ id: asShipId('p0a'), owner: 0 }),
    createShip({
      id: asShipId('p0b'),
      owner: 0,
      lifecycle: 'destroyed',
    }),
    createShip({ id: asShipId('p1a'), owner: 1 }),
    createShip({
      id: asShipId('p1b'),
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
  outcome: { winner: 0, reason: 'Fleet eliminated!' },
  ...overrides,
});

describe('game-client-endgame', () => {
  it('derives victory presentation with stats', () => {
    const plan = deriveGameOverPlan(
      createState(),
      0,
      true,
      'Fleet eliminated!',
    );

    expect(plan.logText).toBe('VICTORY: Fleet eliminated!');
    expect(plan.logClass).toBe('log-landed');
    expect(plan.resultSound).toBe('victory');
    expect(plan.stats).toMatchObject({
      turns: 7,
      myShipsAlive: 1,
      myShipsTotal: 2,
      enemyShipsAlive: 1,
      enemyShipsTotal: 2,
      myShipsDestroyed: 1,
      enemyShipsDestroyed: 1,
    });
  });

  it('derives defeat presentation and falls back cleanly with no state', () => {
    const defeatPlan = deriveGameOverPlan(
      createState(),
      0,
      false,
      'Transport destroyed',
    );
    expect(defeatPlan.logText).toBe('DEFEAT: Transport destroyed');
    expect(defeatPlan.logClass).toBe('log-eliminated');
    expect(defeatPlan.resultSound).toBe('defeat');

    const nullPlan = deriveGameOverPlan(null, 0, true, 'Disconnected');
    expect(nullPlan.stats).toBeUndefined();
    expect(nullPlan.logText).toBe('VICTORY: Disconnected');
    expect(nullPlan.resultSound).toBe('victory');
  });

  it('uses neutral spectator copy when playerId is negative', () => {
    const plan = deriveGameOverPlan(
      createState(),
      -1,
      false,
      'Fleet eliminated!',
    );

    expect(plan.logText).toBe('GAME OVER: Fleet eliminated!');
    expect(plan.stats).toMatchObject({
      playerId: -1,
      turns: 7,
      myShipsAlive: 1,
      enemyShipsAlive: 1,
    });
    expect(plan.resultSound).toBe('defeat');
  });
});
