import { describe, expect, it } from 'vitest';
import { asHexKey } from '../hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { FleetPurchase } from '../types';
import type { EventEnvelope } from './engine-events';
import { projectMatchSetupFromStream } from './event-projector';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';

const map = buildSolarSystemMap();

describe('projectMatchSetupFromStream', () => {
  it('rebuilds fleet-building setup from setup events', () => {
    const purchases0: FleetPurchase[] = [
      { shipType: 'corvette' },
      { shipType: 'corsair' },
    ];
    const purchases1: FleetPurchase[] = [{ shipType: 'frigate' }];
    const events: EventEnvelope[] = [
      {
        gameId: 'WAR01-m1',
        seq: 1,
        ts: 1,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'Interplanetary War',
          turn: 1,
          phase: 'fleetBuilding',
          matchSeed: 0,
        },
      },
      {
        gameId: 'WAR01-m1',
        seq: 2,
        ts: 2,
        actor: 0,
        event: {
          type: 'fleetPurchased',
          playerId: 0,
          purchases: purchases0,
          shipTypes: purchases0.map((purchase) => purchase.shipType),
        },
      },
      {
        gameId: 'WAR01-m1',
        seq: 3,
        ts: 3,
        actor: 1,
        event: {
          type: 'fleetPurchased',
          playerId: 1,
          purchases: purchases1,
          shipTypes: purchases1.map((purchase) => purchase.shipType),
        },
      },
    ];

    const created = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01-m1',
      findBaseHex,
      () => 0,
    );
    const player0Ready = processFleetReady(
      created,
      0,
      purchases0,
      map,
      SCENARIOS.interplanetaryWar.availableShipTypes,
    );

    if ('error' in player0Ready) {
      throw new Error(player0Ready.error.message);
    }

    const expected = processFleetReady(
      player0Ready.state,
      1,
      purchases1,
      map,
      SCENARIOS.interplanetaryWar.availableShipTypes,
    );

    if ('error' in expected) {
      throw new Error(expected.error.message);
    }

    const projected = projectMatchSetupFromStream(events, map);

    expect(projected).toEqual({
      ok: true,
      value: expected.state,
    });
  });

  it('rebuilds deterministic fugitive designation from the stream', () => {
    const events: EventEnvelope[] = [
      {
        gameId: 'ESCAP-m1',
        seq: 1,
        ts: 1,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'Escape',
          turn: 1,
          phase: 'astrogation',
          matchSeed: 0,
        },
      },
      {
        gameId: 'ESCAP-m1',
        seq: 2,
        ts: 2,
        actor: null,
        event: {
          type: 'fugitiveDesignated',
          shipId: 'p0s0',
          playerId: 0,
        },
      },
    ];

    const projected = projectMatchSetupFromStream(events, map);

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    const fugitiveShips = projected.value.ships.filter(
      (ship) => ship.owner === 0 && ship.identity?.hasFugitives,
    );

    expect(fugitiveShips).toHaveLength(1);
    expect(fugitiveShips[0]?.id).toBe('p0s0');
  });

  it('fails explicitly on malformed event streams', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'WAR01-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Interplanetary War',
            turn: 1,
            phase: 'fleetBuilding',
            matchSeed: 0,
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'gameCreated',
            scenario: 'Interplanetary War',
            turn: 1,
            phase: 'fleetBuilding',
            matchSeed: 0,
          },
        },
      ],
      map,
    );

    expect(projected).toEqual({
      ok: false,
      error: 'duplicate gameCreated event',
    });
  });

  it('applies turn and phase metadata events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'WAR01-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Interplanetary War',
            turn: 1,
            phase: 'fleetBuilding',
            matchSeed: 0,
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 2,
          ts: 2,
          actor: 1,
          event: {
            type: 'turnAdvanced',
            turn: 2,
            activePlayer: 1,
          },
        },
        {
          gameId: 'WAR01-m1',
          seq: 3,
          ts: 3,
          actor: 1,
          event: {
            type: 'phaseChanged',
            phase: 'combat',
            turn: 2,
            activePlayer: 1,
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.turnNumber).toBe(2);
    expect(projected.value.activePlayer).toBe(1);
    expect(projected.value.phase).toBe('combat');
  });

  it('projects committed astrogation orders until movement begins', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m2',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m2',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'astrogationOrdersCommitted',
            playerId: 0,
            orders: [
              {
                shipId: 'p0s0',
                burn: 2,
                overload: null,
                weakGravityChoices: { [asHexKey('Io')]: true },
              },
            ],
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.pendingAstrogationOrders).toEqual([
      {
        shipId: 'p0s0',
        burn: 2,
        overload: null,
        weakGravityChoices: { Io: true },
      },
    ]);
  });

  it('applies movement, landing, crash, and resupply events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'shipMoved',
            shipId: 'p0s0',
            from: { q: -9, r: -4 },
            to: { q: -9, r: -4 },
            path: [{ q: -9, r: -4 }],
            fuelSpent: 0,
            fuelRemaining: 20,
            newVelocity: { dq: 0, dr: 0 },
            lifecycle: 'landed',
            overloadUsed: false,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'shipLanded',
            shipId: 'p0s0',
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'shipResupplied',
            shipId: 'p0s0',
            source: 'base',
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 5,
          ts: 5,
          actor: 1,
          event: {
            type: 'shipMoved',
            shipId: 'p1s0',
            from: { q: 10, r: -7 },
            to: { q: 9, r: -7 },
            path: [
              { q: 10, r: -7 },
              { q: 9, r: -7 },
            ],
            fuelSpent: 1,
            fuelRemaining: 19,
            newVelocity: { dq: -1, dr: 0 },
            lifecycle: 'active',
            overloadUsed: false,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 6,
          ts: 6,
          actor: 1,
          event: {
            type: 'shipCrashed',
            shipId: 'p1s0',
            hex: { q: 9, r: -7 },
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    const player0Ship = projected.value.ships.find(
      (ship) => ship.id === 'p0s0',
    );
    const player1Ship = projected.value.ships.find(
      (ship) => ship.id === 'p1s0',
    );

    expect(player0Ship?.lifecycle).toBe('landed');
    expect(player0Ship?.velocity).toEqual({ dq: 0, dr: 0 });
    expect(player0Ship?.resuppliedThisTurn).toBe(true);
    expect(player0Ship?.lastMovementPath).toEqual([{ q: -9, r: -4 }]);

    expect(player1Ship?.position).toEqual({ q: 9, r: -7 });
    expect(player1Ship?.lifecycle).toBe('destroyed');
    expect(player1Ship?.velocity).toEqual({ dq: 0, dr: 0 });
  });

  it('applies ordnance launch and expiry events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'ordnanceLaunched',
            ordnanceId: 'ord1',
            ordnanceType: 'mine',
            owner: 0,
            sourceShipId: 'p0s0',
            position: { q: -9, r: -4 },
            velocity: { dq: 0, dr: 0 },
            turnsRemaining: 5,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'ordnanceExpired',
            ordnanceId: 'ord1',
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.ordnance).toHaveLength(0);
  });

  it('projects ordnance movement and launch-side ship state', () => {
    const gravityEffect = {
      hex: { q: -8, r: -4 },
      direction: 2,
      bodyName: 'Earth',
      strength: 'weak' as const,
      ignored: false,
    };
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m3',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m3',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'astrogationOrdersCommitted',
            playerId: 0,
            orders: [{ shipId: 'p0s0', burn: 0, overload: null }],
          },
        },
        {
          gameId: 'BIPLA-m3',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'ordnanceLaunched',
            ordnanceId: 'ord1',
            ordnanceType: 'nuke',
            owner: 0,
            sourceShipId: 'p0s0',
            position: { q: -9, r: -4 },
            velocity: { dq: 1, dr: 0 },
            turnsRemaining: 5,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m3',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'ordnanceMoved',
            ordnanceId: 'ord1',
            position: { q: -8, r: -4 },
            velocity: { dq: 1, dr: 0 },
            turnsRemaining: 4,
            pendingGravityEffects: [gravityEffect],
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.pendingAstrogationOrders).toBeNull();
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.cargoUsed,
    ).toBe(20);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')
        ?.nukesLaunchedSinceResupply,
    ).toBe(1);
    expect(projected.value.ordnance).toEqual([
      {
        id: 'ord1',
        type: 'nuke',
        owner: 0,
        sourceShipId: 'p0s0',
        position: { q: -8, r: -4 },
        velocity: { dq: 1, dr: 0 },
        turnsRemaining: 4,
        lifecycle: 'active',
        pendingGravityEffects: [gravityEffect],
      },
    ]);
  });

  it('applies ordnance detonation side effects from explicit events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'movement',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'ordnanceLaunched',
            ordnanceId: 'ord1',
            ordnanceType: 'mine',
            owner: 0,
            sourceShipId: 'p0s0',
            position: { q: -9, r: -4 },
            velocity: { dq: 0, dr: 0 },
            turnsRemaining: 5,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 3,
          ts: 3,
          actor: 1,
          event: {
            type: 'ordnanceLaunched',
            ordnanceId: 'ord2',
            ordnanceType: 'torpedo',
            owner: 1,
            sourceShipId: 'p1s0',
            position: { q: -9, r: -4 },
            velocity: { dq: 1, dr: 0 },
            turnsRemaining: 4,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'ordnanceDetonated',
            ordnanceId: 'ord1',
            ordnanceType: 'mine',
            hex: { q: -9, r: -4 },
            targetShipId: 'p1s0',
            roll: 5,
            damageType: 'disabled',
            disabledTurns: 2,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 5,
          ts: 5,
          actor: 0,
          event: {
            type: 'ordnanceDestroyed',
            ordnanceId: 'ord1',
            cause: 'mine',
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 6,
          ts: 6,
          actor: 0,
          event: {
            type: 'ordnanceDestroyed',
            ordnanceId: 'ord2',
            cause: 'mine',
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 7,
          ts: 7,
          actor: 0,
          event: {
            type: 'asteroidDestroyed',
            hex: { q: 1, r: 0 },
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 8,
          ts: 8,
          actor: 0,
          event: {
            type: 'baseDestroyed',
            hex: { q: -9, r: -5 },
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.ordnance).toHaveLength(0);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p1s0')?.damage
        .disabledTurns,
    ).toBe(2);
    expect(projected.value.destroyedAsteroids).toContain('1,0');
    expect(projected.value.destroyedBases).toContain('-9,-5');
  });

  it('applies combat attack damage and explicit destruction events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'combat',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'ordnanceLaunched',
            ordnanceId: 'ord1',
            ordnanceType: 'nuke',
            owner: 1,
            sourceShipId: 'p1s0',
            position: { q: 9, r: -7 },
            velocity: { dq: -1, dr: 0 },
            turnsRemaining: 3,
            pendingGravityEffects: [],
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'combatAttack',
            attackerIds: ['p0s0'],
            targetId: 'p1s0',
            targetType: 'ship',
            attackType: 'gun',
            roll: 4,
            modifiedRoll: 4,
            damageType: 'disabled',
            disabledTurns: 1,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'combatAttack',
            attackerIds: ['p0s1'],
            targetId: 'ord1',
            targetType: 'ordnance',
            attackType: 'antiNuke',
            roll: 6,
            modifiedRoll: 5,
            damageType: 'eliminated',
            disabledTurns: 0,
          },
        },
        {
          gameId: 'BIPLA-m1',
          seq: 5,
          ts: 5,
          actor: 0,
          event: {
            type: 'ordnanceDestroyed',
            ordnanceId: 'ord1',
            cause: 'antiNuke',
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(
      projected.value.ships.find((ship) => ship.id === 'p1s0')?.damage
        .disabledTurns,
    ).toBe(1);
    expect(projected.value.ordnance).toHaveLength(0);
  });

  it('applies logistics, emplacement, and game-over events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'CONV-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Convoy',
            turn: 1,
            phase: 'logistics',
            matchSeed: 0,
          },
        },
        {
          gameId: 'CONV-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'fuelTransferred',
            fromShipId: 'p0s1',
            toShipId: 'p0s2',
            amount: 2,
          },
        },
        {
          gameId: 'CONV-m1',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'passengersTransferred',
            fromShipId: 'p0s0',
            toShipId: 'p0s2',
            amount: 5,
          },
        },
        {
          gameId: 'CONV-m1',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'shipSurrendered',
            shipId: 'p0s2',
          },
        },
        {
          gameId: 'CONV-m1',
          seq: 5,
          ts: 5,
          actor: 0,
          event: {
            type: 'baseEmplaced',
            shipId: 'ob9',
            sourceShipId: 'p0s0',
            owner: 0,
            position: { q: -9, r: -6 },
            velocity: { dq: 1, dr: 0 },
          },
        },
        {
          gameId: 'CONV-m1',
          seq: 6,
          ts: 6,
          actor: null,
          event: {
            type: 'gameOver',
            winner: 0,
            reason: 'Projected victory',
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.ships.find((ship) => ship.id === 'p0s1')?.fuel).toBe(
      48,
    );
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')
        ?.passengersAboard,
    ).toBe(115);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s2')?.control,
    ).toBe('surrendered');
    expect(projected.value.ships.find((ship) => ship.id === 'ob9')?.type).toBe(
      'orbitalBase',
    );
    expect(projected.value.outcome?.winner).toBe(0);
    expect(projected.value.phase).toBe('gameOver');
  });

  it('applies identity reveal and checkpoint progress events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'TOUR-m1',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Grand Tour',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'TOUR-m1',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'checkpointVisited',
            playerId: 0,
            body: 'Mercury',
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.players[0].visitedBodies).toContain('Mercury');

    const escapeProjected = projectMatchSetupFromStream(
      [
        {
          gameId: 'ESCAP-m2',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Escape',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'ESCAP-m2',
          seq: 2,
          ts: 2,
          actor: 1,
          event: {
            type: 'identityRevealed',
            shipId: 'p0s0',
          },
        },
      ],
      map,
    );

    expect(escapeProjected.ok).toBe(true);
    if (!escapeProjected.ok) {
      return;
    }

    expect(
      escapeProjected.value.ships.find((ship) => ship.id === 'p0s0')?.identity
        ?.revealed,
    ).toBe(true);
  });

  it('applies ramming, capture, and committed command audit events', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'ESCAP-m3',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Escape',
            turn: 1,
            phase: 'astrogation',
            matchSeed: 0,
          },
        },
        {
          gameId: 'ESCAP-m3',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'astrogationOrdersCommitted',
            playerId: 0,
            orders: [{ shipId: 'p0s0', burn: null, overload: null }],
          },
        },
        {
          gameId: 'ESCAP-m3',
          seq: 3,
          ts: 3,
          actor: 0,
          event: {
            type: 'ordnanceLaunchesCommitted',
            playerId: 0,
            launches: [
              {
                shipId: 'p0s0',
                ordnanceType: 'mine',
                torpedoAccel: null,
                torpedoAccelSteps: null,
              },
            ],
          },
        },
        {
          gameId: 'ESCAP-m3',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'ramming',
            shipId: 'p0s0',
            otherShipId: 'p1s0',
            hex: { q: 0, r: 0 },
            roll: 5,
            damageType: 'disabled',
            disabledTurns: 2,
          },
        },
        {
          gameId: 'ESCAP-m3',
          seq: 5,
          ts: 5,
          actor: 0,
          event: {
            type: 'shipCaptured',
            shipId: 'p0s0',
            capturedBy: 1,
            capturedByShipId: 'p1s0',
          },
        },
        {
          gameId: 'ESCAP-m3',
          seq: 6,
          ts: 6,
          actor: 1,
          event: {
            type: 'surrenderDeclared',
            playerId: 1,
            shipIds: ['p1s0'],
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.damage
        .disabledTurns,
    ).toBe(2);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.owner,
    ).toBe(1);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.control,
    ).toBe('captured');
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.identity
        ?.revealed,
    ).toBe(true);
  });

  it('applies turn advancement side effects for the outgoing player', () => {
    const projected = projectMatchSetupFromStream(
      [
        {
          gameId: 'BIPLA-m4',
          seq: 1,
          ts: 1,
          actor: null,
          event: {
            type: 'gameCreated',
            scenario: 'Bi-Planetary',
            turn: 1,
            phase: 'resupply',
            matchSeed: 0,
          },
        },
        {
          gameId: 'BIPLA-m4',
          seq: 2,
          ts: 2,
          actor: 0,
          event: {
            type: 'shipResupplied',
            shipId: 'p0s0',
            source: 'base',
          },
        },
        {
          gameId: 'BIPLA-m4',
          seq: 3,
          ts: 3,
          actor: 1,
          event: {
            type: 'combatAttack',
            attackerIds: ['p1s0'],
            targetId: 'p0s0',
            targetType: 'ship',
            attackType: 'gun',
            roll: 5,
            modifiedRoll: 5,
            damageType: 'disabled',
            disabledTurns: 2,
          },
        },
        {
          gameId: 'BIPLA-m4',
          seq: 4,
          ts: 4,
          actor: 0,
          event: {
            type: 'turnAdvanced',
            turn: 1,
            activePlayer: 1,
          },
        },
      ],
      map,
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      return;
    }

    expect(projected.value.activePlayer).toBe(1);
    expect(projected.value.turnNumber).toBe(1);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')
        ?.resuppliedThisTurn,
    ).toBe(false);
    expect(
      projected.value.ships.find((ship) => ship.id === 'p0s0')?.damage
        .disabledTurns,
    ).toBe(1);
  });
});
