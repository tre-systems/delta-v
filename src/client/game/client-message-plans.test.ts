import { describe, expect, it } from 'vitest';

import {
  asGameId,
  asPlayerToken,
  asRoomCode,
  asShipId,
} from '../../shared/ids';
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
import { deriveClientMessagePlan } from './client-message-plans';
import type { ClientState } from './phase';

const roomCode = (value = 'ABCDE') => asRoomCode(value);
const playerToken = (value = 'player-token') => asPlayerToken(value);

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

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('MSG'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 4,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: asShipId('enemy'), owner: 1 })],
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

describe('game-client-message-plans', () => {
  it('derives welcome handling from reconnect and current state', () => {
    expect(
      derive({
        type: 'welcome',
        playerId: 1,
        code: roomCode(),
        playerToken: playerToken(),
      }),
    ).toEqual({
      kind: 'welcome',
      playerId: 1,
      code: roomCode(),
      playerToken: playerToken(),
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });
  });

  it('derives spectator welcome handling from reconnect and current state', () => {
    expect(
      derive({
        type: 'spectatorWelcome',
        code: roomCode(),
      }),
    ).toEqual({
      kind: 'spectatorWelcome',
      code: roomCode(),
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });
  });

  it('derives game start, movement, combat, and state update plans', () => {
    const movementState = createState();

    const movements: ShipMovement[] = [
      {
        shipId: asShipId('ship-0'),
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [],
        newVelocity: { dq: 1, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'normal',
      },
    ];
    const ordnanceMovements: OrdnanceMovement[] = [];
    const events: MovementEvent[] = [];

    const results: CombatResult[] = [
      {
        attackerIds: [asShipId('ship-0')],
        targetId: asShipId('enemy'),
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
              fromShipId: asShipId('a'),
              toShipId: asShipId('b'),
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
      derive({
        type: 'gameOver',
        winner: 0,
        reason: 'Fleet eliminated!',
      }),
    ).toEqual({
      kind: 'gameOver',
      won: true,
      reason: 'Fleet eliminated!',
    });

    expect(derive({ type: 'rematchPending' })).toEqual({
      kind: 'rematchPending',
    });

    expect(
      derive({
        type: 'opponentStatus',
        status: 'disconnected',
        graceDeadlineMs: 12345,
      }),
    ).toEqual({
      kind: 'opponentStatus',
      status: 'disconnected',
      graceDeadlineMs: 12345,
    });

    expect(
      derive({
        type: 'error',
        message: 'Boom',
        code: 'INVALID_INPUT' as ErrorCode,
      }),
    ).toEqual({
      kind: 'error',
      message: 'Boom',
      code: 'INVALID_INPUT',
    });

    expect(
      derive({
        type: 'pong',
        t: 4900,
      }),
    ).toEqual({
      kind: 'pong',
      latencyMs: 100,
    });
  });

  it('derives a structured actionRejected plan', () => {
    const state = createState({ turnNumber: 5, phase: 'ordnance' });
    expect(
      derive({
        type: 'actionRejected',
        reason: 'stalePhase',
        message: 'expected phase astrogation but server is in ordnance',
        expected: { turn: 4, phase: 'astrogation' },
        actual: {
          turn: 5,
          phase: 'ordnance',
          activePlayer: 0,
        },
        state,
      }),
    ).toEqual({
      kind: 'actionRejected',
      reason: 'stalePhase',
      message: 'expected phase astrogation but server is in ordnance',
      expected: { turn: 4, phase: 'astrogation' },
      actual: {
        turn: 5,
        phase: 'ordnance',
        activePlayer: 0,
      },
    });
  });
});
