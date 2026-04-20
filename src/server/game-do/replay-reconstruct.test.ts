import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '../../shared/engine/engine-events';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
import type { GameState } from '../../shared/types/domain';
import { buildReplayMessageFromEvents } from './replay-reconstruct';

const blankState = (): GameState =>
  ({
    gameId: asGameId('TEST-m1'),
    scenario: 'duel',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships: [],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [],
    outcome: null,
  }) as unknown as GameState;

describe('buildReplayMessageFromEvents', () => {
  it('emits gameStart for the first entry', () => {
    const message = buildReplayMessageFromEvents([], blankState(), null, true);
    expect(message.type).toBe('gameStart');
  });

  it('maps shipMoved + shipLanded into a movementResult with landing outcome', () => {
    const events: EngineEvent[] = [
      {
        type: 'shipMoved',
        shipId: asShipId('p0s0'),
        from: { q: 0, r: 0 },
        to: { q: 2, r: -1 },
        path: [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
          { q: 2, r: -1 },
        ],
        fuelSpent: 1,
        fuelRemaining: 19,
        newVelocity: { dq: 1, dr: -1 },
        lifecycle: 'landed',
        overloadUsed: false,
        pendingGravityEffects: [],
      },
      {
        type: 'shipLanded',
        shipId: asShipId('p0s0'),
        landedAt: 'Mars',
      },
    ];

    const message = buildReplayMessageFromEvents(
      events,
      blankState(),
      null,
      false,
    );

    expect(message.type).toBe('movementResult');
    if (message.type !== 'movementResult') return;
    expect(message.movements).toHaveLength(1);
    expect(message.movements[0].outcome).toBe('landing');
    if (message.movements[0].outcome === 'landing') {
      expect(message.movements[0].landedAt).toBe('Mars');
    }
  });

  it('maps shipMoved + shipCrashed into a crash movement and emits a crash MovementEvent', () => {
    const events: EngineEvent[] = [
      {
        type: 'shipMoved',
        shipId: asShipId('p0s0'),
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        fuelSpent: 0,
        fuelRemaining: 20,
        newVelocity: { dq: 1, dr: 0 },
        lifecycle: 'destroyed',
        overloadUsed: false,
        pendingGravityEffects: [],
      },
      {
        type: 'shipCrashed',
        shipId: asShipId('p0s0'),
        hex: { q: 1, r: 0 },
      },
    ];

    const message = buildReplayMessageFromEvents(
      events,
      blankState(),
      null,
      false,
    );

    expect(message.type).toBe('movementResult');
    if (message.type !== 'movementResult') return;
    expect(message.movements[0].outcome).toBe('crash');
    expect(message.events).toEqual([
      expect.objectContaining({ type: 'crash', shipId: 'p0s0' }),
    ]);
  });

  it('maps combatAttack batches into a combatResult', () => {
    const events: EngineEvent[] = [
      {
        type: 'combatAttack',
        attackerIds: [asShipId('p0s0')],
        targetId: asShipId('p1s0'),
        targetType: 'ship',
        attackType: 'gun',
        roll: 5,
        modifiedRoll: 4,
        damageType: 'disabled',
        disabledTurns: 2,
      },
    ];

    const message = buildReplayMessageFromEvents(
      events,
      blankState(),
      null,
      false,
    );

    expect(message.type).toBe('combatResult');
    if (message.type !== 'combatResult') return;
    expect(message.results).toHaveLength(1);
    expect(message.results[0]).toMatchObject({
      attackerIds: ['p0s0'],
      targetId: 'p1s0',
      dieRoll: 5,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 2,
    });
  });

  it('reads ordnanceMovement origin from the previous state', () => {
    const previousState = {
      ...blankState(),
      ordnance: [
        {
          id: asOrdnanceId('ord-1'),
          owner: 0,
          type: 'torpedo',
          position: { q: 0, r: 0 },
          velocity: { dq: 1, dr: 0 },
          turnsRemaining: 4,
          lifecycle: 'active',
        },
      ],
    } as unknown as GameState;

    const events: EngineEvent[] = [
      {
        type: 'ordnanceMoved',
        ordnanceId: asOrdnanceId('ord-1'),
        position: { q: 1, r: 0 },
        velocity: { dq: 1, dr: 0 },
        turnsRemaining: 3,
        pendingGravityEffects: [],
      },
    ];

    const message = buildReplayMessageFromEvents(
      events,
      blankState(),
      previousState,
      false,
    );

    expect(message.type).toBe('movementResult');
    if (message.type !== 'movementResult') return;
    expect(message.ordnanceMovements).toHaveLength(1);
    expect(message.ordnanceMovements[0]).toMatchObject({
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      ordnanceType: 'torpedo',
      owner: 0,
      detonated: false,
    });
  });

  it('falls back to stateUpdate for non-movement/combat event batches', () => {
    const events: EngineEvent[] = [
      { type: 'turnAdvanced', turn: 2, activePlayer: 0 },
    ];
    const message = buildReplayMessageFromEvents(
      events,
      blankState(),
      null,
      false,
    );
    expect(message.type).toBe('stateUpdate');
  });
});
