// Round-trip tests for projector kill attribution and astrogation-order
// clearing: run the live engine, project the emitted events over the same
// pre-state, and require the projection to reconstruct the live state's
// killedBy / deathCause / pendingAstrogationOrders exactly.

import { describe, expect, it } from 'vitest';
import { asHexKey } from '../../hex';
import { asGameId, asOrdnanceId, asShipId } from '../../ids';
import {
  createTestOrdnance,
  createTestShip,
  createTestState,
  EMPTY_SOLAR_MAP,
} from '../../test-helpers';
import type { SolarSystemMap } from '../../types';
import type { GameState, Ship } from '../../types/domain';
import { processAstrogation, skipOrdnance } from '../astrogation';
import { beginCombatPhase, endCombat, processCombat } from '../combat';
import type { EngineEvent, EventEnvelope } from '../engine-events';
import { projectGameStateFromStream } from '../event-projector';

const toEnvelopes = (events: EngineEvent[]): EventEnvelope[] =>
  events.map((event, index) => ({
    gameId: asGameId('TEST'),
    seq: index + 1,
    ts: 1,
    actor: 0,
    event,
  }));

const projectOrThrow = (
  events: EngineEvent[],
  preState: GameState,
  map: SolarSystemMap = EMPTY_SOLAR_MAP,
): GameState => {
  const projected = projectGameStateFromStream(
    toEnvelopes(events),
    map,
    preState,
  );

  if (!projected.ok) {
    throw new Error(projected.error);
  }

  return projected.value;
};

const shipOrThrow = (state: GameState, id: string): Ship => {
  const ship = state.ships.find((candidate) => candidate.id === id);

  if (!ship) {
    throw new Error(`ship not found: ${id}`);
  }

  return ship;
};

describe('projector kill attribution round-trip', () => {
  it('reconstructs killedBy and deathCause for a nuke kill', () => {
    const preState = createTestState({
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('a0'),
          owner: 0,
          position: { q: 10, r: 10 },
        }),
        createTestShip({
          id: asShipId('victim'),
          owner: 1,
          position: { q: 2, r: 0 },
        }),
        createTestShip({
          id: asShipId('bystander'),
          owner: 1,
          position: { q: 20, r: 20 },
        }),
      ],
      ordnance: [
        createTestOrdnance({
          id: asOrdnanceId('ord0'),
          type: 'nuke',
          owner: 0,
          position: { q: 1, r: 0 },
          velocity: { dq: 1, dr: 0 },
          turnsRemaining: 5,
          pendingGravityEffects: [],
        }),
      ],
    });

    const result = skipOrdnance(
      structuredClone(preState),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.5,
    );

    if ('error' in result) {
      throw new Error(result.error.message);
    }

    const liveVictim = shipOrThrow(result.state, 'victim');
    expect(liveVictim.lifecycle).toBe('destroyed');
    expect(liveVictim.deathCause).toBe('nuke');
    expect(liveVictim.killedBy).toBe('ord0');

    const projectedVictim = shipOrThrow(
      projectOrThrow(result.engineEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe(liveVictim.deathCause);
    expect(projectedVictim.killedBy).toBe(liveVictim.killedBy);
  });

  it('credits the strongest attacker of a group gun kill, not attackerIds[0]', () => {
    const preState = createTestState({
      phase: 'combat',
      ships: [
        createTestShip({
          id: asShipId('weak'),
          type: 'corvette',
          owner: 0,
          position: { q: 1, r: 0 },
        }),
        createTestShip({
          id: asShipId('strong'),
          type: 'frigate',
          owner: 0,
          position: { q: 0, r: 1 },
        }),
        createTestShip({
          id: asShipId('victim'),
          owner: 1,
          position: { q: 0, r: 0 },
        }),
        createTestShip({
          id: asShipId('bystander'),
          owner: 1,
          position: { q: 30, r: 0 },
        }),
      ],
    });

    // rng -> die roll 6; 10 vs 2 strength is 4:1 odds, so the group
    // attack eliminates the target even after the range modifier.
    const result = processCombat(
      structuredClone(preState),
      0,
      [
        {
          attackerIds: [asShipId('weak'), asShipId('strong')],
          targetId: asShipId('victim'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      EMPTY_SOLAR_MAP,
      () => 0.99,
    );

    if ('error' in result) {
      throw new Error(result.error.message);
    }

    const liveVictim = shipOrThrow(result.state, 'victim');
    expect(liveVictim.lifecycle).toBe('destroyed');
    expect(liveVictim.deathCause).toBe('gun');
    // Live credit goes to the strongest attacker, which is deliberately
    // NOT first in attackerIds here.
    expect(liveVictim.killedBy).toBe('strong');

    const projectedVictim = shipOrThrow(
      projectOrThrow(result.engineEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe(liveVictim.deathCause);
    expect(projectedVictim.killedBy).toBe(liveVictim.killedBy);
  });

  it('reconstructs the exact asteroid deathCause for a hazard kill', () => {
    const preState = createTestState({
      phase: 'combat',
      ships: [
        createTestShip({
          id: asShipId('victim'),
          owner: 0,
          position: { q: 0, r: 0 },
          // One more disabled turn crosses the elimination threshold.
          damage: { disabledTurns: 5 },
        }),
        createTestShip({
          id: asShipId('a1'),
          owner: 0,
          position: { q: 5, r: 5 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 30, r: 0 },
        }),
      ],
      pendingAsteroidHazards: [
        { shipId: asShipId('victim'), hex: { q: 0, r: 0 } },
      ],
    });

    // rng -> die roll 6: asteroid table deals 1 disabled turn.
    const result = beginCombatPhase(
      structuredClone(preState),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.99,
    );

    if ('error' in result) {
      throw new Error(result.error.message);
    }

    const liveVictim = shipOrThrow(result.state, 'victim');
    expect(liveVictim.lifecycle).toBe('destroyed');
    // Live uses 'asteroid'; the combatAttack event's attackType is
    // 'asteroidHazard'.
    expect(liveVictim.deathCause).toBe('asteroid');
    expect(liveVictim.killedBy).toBeNull();

    const projectedVictim = shipOrThrow(
      projectOrThrow(result.engineEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe('asteroid');
    expect(projectedVictim.killedBy).toBeNull();
  });

  it('reconstructs a hazard kill resolved by endCombat', () => {
    const preState = createTestState({
      phase: 'combat',
      ships: [
        createTestShip({
          id: asShipId('victim'),
          owner: 0,
          position: { q: 0, r: 0 },
          // One more disabled turn crosses the elimination threshold.
          damage: { disabledTurns: 5 },
        }),
        createTestShip({
          id: asShipId('a1'),
          owner: 0,
          position: { q: 5, r: 5 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 30, r: 0 },
        }),
      ],
      pendingAsteroidHazards: [
        { shipId: asShipId('victim'), hex: { q: 0, r: 0 } },
      ],
    });

    // rng -> die roll 6: asteroid table deals 1 disabled turn.
    const result = endCombat(
      structuredClone(preState),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.99,
    );

    if ('error' in result) {
      throw new Error(result.error.message);
    }

    const liveVictim = shipOrThrow(result.state, 'victim');
    expect(liveVictim.lifecycle).toBe('destroyed');
    expect(liveVictim.deathCause).toBe('asteroid');
    expect(liveVictim.killedBy).toBeNull();
    expect(result.state.pendingAsteroidHazards).toHaveLength(0);

    const projectedVictim = shipOrThrow(
      projectOrThrow(result.engineEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe('asteroid');
    expect(projectedVictim.killedBy).toBeNull();
  });

  it('keeps legacy behavior for old streams without attribution fields', () => {
    const preState = createTestState({
      phase: 'combat',
      ships: [
        createTestShip({
          id: asShipId('weak'),
          type: 'corvette',
          owner: 0,
          position: { q: 1, r: 0 },
        }),
        createTestShip({
          id: asShipId('strong'),
          type: 'frigate',
          owner: 0,
          position: { q: 0, r: 1 },
        }),
        createTestShip({
          id: asShipId('victim'),
          owner: 1,
          position: { q: 0, r: 0 },
        }),
      ],
    });

    // Archived stream shape before deathCause/killedBy existed.
    const legacyEvents: EngineEvent[] = [
      {
        type: 'combatAttack',
        attackerIds: [asShipId('weak'), asShipId('strong')],
        targetId: asShipId('victim'),
        targetType: 'ship',
        attackType: 'gun',
        roll: 6,
        modifiedRoll: 5,
        damageType: 'eliminated',
        disabledTurns: 0,
      },
      {
        type: 'shipDestroyed',
        shipId: asShipId('victim'),
        cause: 'gun',
      },
    ];

    const projectedVictim = shipOrThrow(
      projectOrThrow(legacyEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe('gun');
    // Legacy fallback: first attacker guess, unchanged for old streams.
    expect(projectedVictim.killedBy).toBe('weak');
  });

  it('leaves killedBy unset for an old-stream nuke kill', () => {
    const preState = createTestState({
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('victim'),
          owner: 1,
          position: { q: 2, r: 0 },
        }),
      ],
      ordnance: [
        createTestOrdnance({
          id: asOrdnanceId('ord0'),
          type: 'nuke',
          owner: 0,
          position: { q: 1, r: 0 },
          velocity: { dq: 1, dr: 0 },
        }),
      ],
    });

    const legacyEvents: EngineEvent[] = [
      {
        type: 'ordnanceDetonated',
        ordnanceId: asOrdnanceId('ord0'),
        ordnanceType: 'nuke',
        hex: { q: 2, r: 0 },
        targetShipId: asShipId('victim'),
        roll: 0,
        damageType: 'eliminated',
        disabledTurns: 0,
      },
      {
        type: 'ordnanceDestroyed',
        ordnanceId: asOrdnanceId('ord0'),
        cause: 'nuke',
      },
      {
        type: 'shipDestroyed',
        shipId: asShipId('victim'),
        cause: 'nuke',
      },
    ];

    const projectedVictim = shipOrThrow(
      projectOrThrow(legacyEvents, preState),
      'victim',
    );
    expect(projectedVictim.lifecycle).toBe('destroyed');
    expect(projectedVictim.deathCause).toBe('nuke');
    expect(projectedVictim.killedBy).toBeUndefined();
  });
});

describe('projector pendingAstrogationOrders round-trip', () => {
  it('clears committed empty orders when a base-only player resolves movement', () => {
    // Player 0's only unit is an emplaced orbital base: movement
    // resolution emits no shipMoved/ordnanceMoved, so the phase change
    // out of movement must clear the committed [] (live nulls it at the
    // top of resolveMovementPhase).
    const preState = createTestState({
      phase: 'astrogation',
      ships: [
        createTestShip({
          id: asShipId('base0'),
          type: 'orbitalBase',
          owner: 0,
          baseStatus: 'emplaced',
          position: { q: 0, r: 0 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 5, r: 0 },
        }),
      ],
    });

    const committed = processAstrogation(
      structuredClone(preState),
      0,
      [],
      EMPTY_SOLAR_MAP,
      () => 0.5,
    );

    if ('error' in committed) {
      throw new Error(committed.error.message);
    }

    // The orbital base can still launch torpedoes, so the commit parks
    // in the ordnance phase with the empty orders pending live.
    expect(committed.state.phase).toBe('ordnance');
    expect(committed.state.pendingAstrogationOrders).toEqual([]);

    const projectedMid = projectOrThrow(committed.engineEvents, preState);
    expect(projectedMid.pendingAstrogationOrders).toEqual([]);

    const resolved = skipOrdnance(
      structuredClone(committed.state),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.5,
    );

    if ('error' in resolved) {
      throw new Error(resolved.error.message);
    }

    // Movement resolution ends in the combat phase (the base has a gun
    // target), never emitting shipMoved / ordnanceMoved / turnAdvanced.
    expect(resolved.state.phase).toBe('combat');
    expect(resolved.state.pendingAstrogationOrders).toBeNull();

    const projected = projectOrThrow(
      [...committed.engineEvents, ...resolved.engineEvents],
      preState,
    );
    expect(projected.pendingAstrogationOrders).toBeNull();
  });
});

describe('projector pendingAsteroidHazards round-trip', () => {
  // Two asteroid hexes on the q-axis lane a drifting ship crosses.
  const asteroidLaneMap = (): SolarSystemMap => ({
    hexes: new Map([
      [asHexKey('1,0'), { terrain: 'asteroid' }],
      [asHexKey('2,0'), { terrain: 'asteroid' }],
    ]),
    bodies: [],
    bounds: { minQ: -20, maxQ: 20, minR: -20, maxR: 20 },
  });

  it('requeues hazards on movement and drains them at combat begin', () => {
    const map = asteroidLaneMap();
    const preState = createTestState({
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('runner'),
          owner: 0,
          position: { q: -1, r: 0 },
          velocity: { dq: 3, dr: 0 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 15, r: 15 },
        }),
      ],
    });

    const moved = skipOrdnance(structuredClone(preState), 0, map, () => 0.5);

    if ('error' in moved) {
      throw new Error(moved.error.message);
    }

    // Both asteroid hexes on the drift line queue an entry.
    expect(moved.state.pendingAsteroidHazards).toEqual([
      { shipId: asShipId('runner'), hex: { q: 1, r: 0 } },
      { shipId: asShipId('runner'), hex: { q: 2, r: 0 } },
    ]);
    expect(moved.state.phase).toBe('combat');

    const projectedMid = projectOrThrow(moved.engineEvents, preState, map);
    expect(projectedMid.pendingAsteroidHazards).toEqual(
      moved.state.pendingAsteroidHazards,
    );

    // rng -> die roll 4: asteroid table deals no damage, both entries
    // still resolve (and drain) with a combatAttack each.
    const resolved = beginCombatPhase(
      structuredClone(moved.state),
      0,
      map,
      () => 0.5,
    );

    if ('error' in resolved) {
      throw new Error(resolved.error.message);
    }

    expect(resolved.state.pendingAsteroidHazards).toEqual([]);

    const projected = projectOrThrow(
      [...moved.engineEvents, ...resolved.engineEvents],
      preState,
      map,
    );
    expect(projected.pendingAsteroidHazards).toEqual([]);
  });

  it('never retains hazards for a ship destroyed out of bounds mid-move', () => {
    // Bounds tight enough that the drift ends past the destruction
    // margin: live destroys the ship before the queue step, so nothing
    // queues; the projector requeues on shipMoved and must prune on the
    // shipDestroyed that follows.
    const map: SolarSystemMap = {
      hexes: new Map([[asHexKey('1,0'), { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const preState = createTestState({
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('leaver'),
          owner: 0,
          position: { q: -1, r: 0 },
          velocity: { dq: 10, dr: 0 },
        }),
        createTestShip({
          id: asShipId('a1'),
          owner: 0,
          position: { q: -4, r: 3 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 4, r: -4 },
        }),
      ],
    });

    const moved = skipOrdnance(structuredClone(preState), 0, map, () => 0.5);

    if ('error' in moved) {
      throw new Error(moved.error.message);
    }

    const liveLeaver = shipOrThrow(moved.state, 'leaver');
    expect(liveLeaver.lifecycle).toBe('destroyed');
    expect(moved.state.pendingAsteroidHazards).toEqual([]);

    const projected = projectOrThrow(moved.engineEvents, preState, map);
    expect(projected.pendingAsteroidHazards).toEqual([]);
  });

  it('drops hazards when ramming destroys the mover in the same resolution', () => {
    // The mover crosses the asteroid lane (queuing hazards) and ends its
    // move in an enemy-held hex; the ram roll eliminates it. Live drops
    // its queued entries at the end of the same resolution, the projector
    // on the shipDestroyed event — both sides agree at the publish point.
    const map = asteroidLaneMap();
    const preState = createTestState({
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('rammer'),
          owner: 0,
          position: { q: -1, r: 0 },
          velocity: { dq: 3, dr: 0 },
          // +5 from the ram roll of 6 crosses the elimination threshold.
          damage: { disabledTurns: 1 },
        }),
        createTestShip({
          id: asShipId('a1'),
          owner: 0,
          position: { q: -10, r: 3 },
        }),
        createTestShip({
          id: asShipId('wall'),
          owner: 1,
          position: { q: 2, r: 0 },
        }),
      ],
    });

    // rng -> die roll 6 for both ram rolls.
    const moved = skipOrdnance(structuredClone(preState), 0, map, () => 0.99);

    if ('error' in moved) {
      throw new Error(moved.error.message);
    }

    const liveRammer = shipOrThrow(moved.state, 'rammer');
    expect(liveRammer.lifecycle).toBe('destroyed');
    expect(liveRammer.deathCause).toBe('ramming');
    expect(moved.state.pendingAsteroidHazards).toEqual([]);

    const projected = projectOrThrow(moved.engineEvents, preState, map);
    expect(projected.pendingAsteroidHazards).toEqual([]);
  });

  it('drops the remaining entries when a hazard roll destroys the ship', () => {
    // Two queued entries for one ship: the first roll eliminates it and
    // live silently discards the second inside the same drain. The
    // projector mirrors that via the shipDestroyed event.
    const preState = createTestState({
      phase: 'combat',
      ships: [
        createTestShip({
          id: asShipId('victim'),
          owner: 0,
          position: { q: 2, r: 0 },
          damage: { disabledTurns: 5 },
        }),
        createTestShip({
          id: asShipId('a1'),
          owner: 0,
          position: { q: 5, r: 5 },
        }),
        createTestShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 30, r: 0 },
        }),
      ],
      pendingAsteroidHazards: [
        { shipId: asShipId('victim'), hex: { q: 1, r: 0 } },
        { shipId: asShipId('victim'), hex: { q: 2, r: 0 } },
      ],
    });

    // rng -> die roll 6: 1 disabled turn crosses the threshold.
    const resolved = beginCombatPhase(
      structuredClone(preState),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.99,
    );

    if ('error' in resolved) {
      throw new Error(resolved.error.message);
    }

    expect(shipOrThrow(resolved.state, 'victim').lifecycle).toBe('destroyed');
    expect(resolved.state.pendingAsteroidHazards).toEqual([]);

    const projected = projectOrThrow(resolved.engineEvents, preState);
    expect(projected.pendingAsteroidHazards).toEqual([]);
  });
});
