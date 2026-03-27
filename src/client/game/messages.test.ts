import { describe, expect, it } from 'vitest';

import type {
  CombatResult,
  ErrorCode,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  Ship,
  ShipMovement,
} from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { deriveClientMessagePlan } from './messages';
import type { ClientState } from './phase';

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

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'MSG',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 4,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'enemy', owner: 1 })],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
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
  ],
  outcome: null,
  ...overrides,
});

const derive = (msg: S2C, currentState: ClientState = 'connecting') =>
  deriveClientMessagePlan(currentState, 2, 0, 5_000, msg);

describe('game-client-messages', () => {
  it('derives welcome handling from reconnect and current state', () => {
    expect(
      derive({
        type: 'welcome',
        playerId: 1,
        code: 'ABCDE',
        playerToken: 'player-token',
      }),
    ).toEqual({
      kind: 'welcome',
      playerId: 1,
      code: 'ABCDE',
      playerToken: 'player-token',
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });
  });

  it('derives spectator welcome handling from reconnect and current state', () => {
    expect(
      derive({
        type: 'spectatorWelcome',
        code: 'ABCDE',
      }),
    ).toEqual({
      kind: 'spectatorWelcome',
      code: 'ABCDE',
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });
  });

  it('derives game start, movement, combat, and state update plans', () => {
    const movementState = createState();

    const movements: ShipMovement[] = [
      {
        shipId: 'ship-0',
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 1, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        crashed: false,
        landedAt: null,
      },
    ];
    const ordnanceMovements: OrdnanceMovement[] = [];
    const events: MovementEvent[] = [];

    const results: CombatResult[] = [
      {
        attackerIds: ['ship-0'],
        targetId: 'enemy',
        targetType: 'ship',
        attackType: 'gun',
        odds: '1-1',
        attackStrength: 1,
        defendStrength: 1,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 3,
        modifiedRoll: 3,
        damageType: 'disabled',
        disabledTurns: 1,
        counterattack: null,
      },
    ];

    expect(
      derive(
        {
          type: 'gameStart',
          state: createState({ phase: 'fleetBuilding' }),
        },
        'waitingForOpponent',
      ),
    ).toEqual({
      kind: 'gameStart',
      state: createState({ phase: 'fleetBuilding' }),
      nextState: 'playing_fleetBuilding',
    });

    expect(
      derive(
        {
          type: 'movementResult',
          state: movementState,
          movements,
          ordnanceMovements,
          events,
        },
        'playing_astrogation',
      ),
    ).toEqual({
      kind: 'movementResult',
      state: movementState,
      movements,
      ordnanceMovements,
      events,
    });

    expect(
      derive(
        {
          type: 'combatResult',
          state: movementState,
          results,
        },
        'playing_combat',
      ),
    ).toEqual({
      kind: 'combatResult',
      state: movementState,
      results,
      shouldTransition: true,
    });

    expect(
      derive(
        {
          type: 'stateUpdate',
          state: movementState,
        },
        'playing_movementAnim',
      ),
    ).toEqual({
      kind: 'stateUpdate',
      state: movementState,
      shouldTransition: false,
    });

    expect(
      derive(
        {
          type: 'stateUpdate',
          state: movementState,
          transferEvents: [
            {
              type: 'fuelTransferred',
              fromShipId: 'a',
              toShipId: 'b',
              amount: 2,
            },
          ],
        },
        'playing_logistics',
      ),
    ).toEqual({
      kind: 'stateUpdate',
      state: movementState,
      shouldTransition: true,
      transferEvents: [
        {
          type: 'fuelTransferred',
          fromShipId: 'a',
          toShipId: 'b',
          amount: 2,
        },
      ],
    });
  });

  it('derives endgame, rematch, disconnect, error, and pong plans', () => {
    expect(
      derive(
        {
          type: 'gameOver',
          winner: 1,
          reason: 'Lost all ships',
        },
        'playing_combat',
      ),
    ).toEqual({
      kind: 'gameOver',
      won: false,
      reason: 'Lost all ships',
    });

    expect(derive({ type: 'rematchPending' }, 'gameOver')).toEqual({
      kind: 'rematchPending',
    });

    expect(
      derive(
        {
          type: 'error',
          message: 'Bad request',
          code: 'INVALID_INPUT' as ErrorCode,
        },
        'playing_astrogation',
      ),
    ).toEqual({
      kind: 'error',
      message: 'Bad request',
      code: 'INVALID_INPUT' as ErrorCode,
    });

    expect(derive({ type: 'pong', t: 4_000 }, 'playing_astrogation')).toEqual({
      kind: 'pong',
      latencyMs: 1_000,
    });

    expect(derive({ type: 'pong', t: 0 }, 'playing_astrogation')).toEqual({
      kind: 'pong',
      latencyMs: null,
    });
  });

  it('marks match found as a phase-change notification', () => {
    expect(derive({ type: 'matchFound' }, 'waitingForOpponent')).toEqual({
      kind: 'matchFound',
    });
  });
});
