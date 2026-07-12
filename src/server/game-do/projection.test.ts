import { describe, expect, it } from 'vitest';
import {
  processAstrogation,
  skipOrdnance,
} from '../../shared/engine/astrogation';
import { beginCombatPhase, processCombat } from '../../shared/engine/combat';
import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import { projectGameStateFromStream } from '../../shared/engine/event-projector';
import { asHexKey, hexKey } from '../../shared/hex';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
import {
  createTestOrdnance,
  createTestShip,
  createTestState,
  EMPTY_SOLAR_MAP,
} from '../../shared/test-helpers';
import type { SolarSystemMap } from '../../shared/types';
import { CURRENT_GAME_STATE_SCHEMA_VERSION } from '../../shared/types';
import type { GameState, Ship } from '../../shared/types/domain';
import { getProjectionParityDiff, normalizeStateForParity } from './projection';

const baseShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const baseState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('PARITY'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [baseShip()],
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

describe('normalizeStateForParity', () => {
  it('preserves pendingAsteroidHazards (projector reconstructs the queue)', () => {
    // The projector requeues hazards from shipMoved events and drains
    // them on asteroidHazard combatAttack / shipDestroyed / shipCrashed,
    // so the queue participates in parity like any other engine field.
    const live = baseState({
      pendingAsteroidHazards: [
        { shipId: asShipId('p0s0'), hex: { q: -9, r: -9 } },
      ],
    });

    const normalized = normalizeStateForParity(live);

    expect(normalized.pendingAsteroidHazards).toEqual([
      { shipId: asShipId('p0s0'), hex: { q: -9, r: -9 } },
    ]);
  });

  it('strips combatTargetedThisPhase (UI residue)', () => {
    const live = baseState();
    (live as { combatTargetedThisPhase?: unknown }).combatTargetedThisPhase = {
      p0s0: ['enemy'],
    };

    const normalized = normalizeStateForParity(live);

    expect(normalized.combatTargetedThisPhase).toBeUndefined();
  });

  it('strips combatAttackGroupsThisPhase (sequential combat residue)', () => {
    const live = baseState();
    live.combatAttackGroupsThisPhase = [
      {
        attackerIds: [],
        targetHexKey: hexKey({ q: 0, r: 0 }),
        targetType: 'ship',
        maxStrength: 2,
        allocatedStrength: 1,
      },
    ];

    const normalized = normalizeStateForParity(live);

    expect(normalized.combatAttackGroupsThisPhase).toBeUndefined();
  });

  it('strips per-player connected/ready (session residue)', () => {
    const live = baseState();

    const normalized = normalizeStateForParity(live);

    for (const player of normalized.players) {
      expect(player.connected).toBe(false);
      expect(player.ready).toBe(false);
    }
  });

  it('strips per-ship detected + firedThisPhase (sensor + UI residue)', () => {
    const live = baseState({
      ships: [
        baseShip({
          detected: true,
          firedThisPhase: true as unknown as Ship['firedThisPhase'],
        }),
      ],
    });

    const normalized = normalizeStateForParity(live);

    expect(normalized.ships[0].detected).toBe(false);
    expect(normalized.ships[0].firedThisPhase).toBeUndefined();
  });
});

describe('getProjectionParityDiff', () => {
  it('reports a diff when pendingAsteroidHazards differs', () => {
    const live = baseState({
      pendingAsteroidHazards: [
        { shipId: asShipId('p0s0'), hex: { q: -9, r: -9 } },
      ],
    });
    const projected = baseState({ pendingAsteroidHazards: [] });

    const diffs = getProjectionParityDiff(projected, live);

    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].path).toMatch(/^pendingAsteroidHazards/);
  });

  it('still reports a real divergence (ship moved)', () => {
    const live = baseState({
      ships: [baseShip({ position: { q: 5, r: 0 } })],
    });
    const projected = baseState({
      ships: [baseShip({ position: { q: 0, r: 0 } })],
    });

    const diffs = getProjectionParityDiff(projected, live);

    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].path).toMatch(/^ships\[0\]\.position/);
  });

  it('flags missing projected state with a top-level diff', () => {
    const live = baseState();

    const diffs = getProjectionParityDiff(null, live);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('');
    expect(diffs[0].projected).toBeNull();
  });
});

// Live-engine round trips: run the engine, project the emitted events
// over the same pre-state, and require zero parity diffs. These are the
// exact reconstructions the monitored projection_parity_mismatch event
// compares after DO recovery.
describe('projection parity round-trip', () => {
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

  it('keeps parity across a nuke kill (killedBy attribution)', () => {
    const preState = createTestState({
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
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

    const liveVictim = result.state.ships.find((s) => s.id === 'victim');
    expect(liveVictim?.killedBy).toBe('ord0');

    const projected = projectOrThrow(result.engineEvents, preState);

    expect(getProjectionParityDiff(projected, result.state)).toEqual([]);
  });

  it('keeps parity across a group gun kill (strongest attacker credited)', () => {
    const preState = createTestState({
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
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

    const liveVictim = result.state.ships.find((s) => s.id === 'victim');
    expect(liveVictim?.killedBy).toBe('strong');

    const projected = projectOrThrow(result.engineEvents, preState);

    expect(getProjectionParityDiff(projected, result.state)).toEqual([]);
  });

  it('keeps parity when a base-only player commits empty orders', () => {
    const preState = createTestState({
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
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

    const resolved = skipOrdnance(
      structuredClone(committed.state),
      0,
      EMPTY_SOLAR_MAP,
      () => 0.5,
    );

    if ('error' in resolved) {
      throw new Error(resolved.error.message);
    }

    // Live nulls the committed [] at the top of resolveMovementPhase;
    // no shipMoved / ordnanceMoved / turnAdvanced fires to clear it in
    // the projector, so this is the null-vs-[] mismatch case.
    expect(resolved.state.pendingAstrogationOrders).toBeNull();

    const projected = projectOrThrow(
      [...committed.engineEvents, ...resolved.engineEvents],
      preState,
    );

    expect(projected.pendingAstrogationOrders).toBeNull();
    expect(getProjectionParityDiff(projected, resolved.state)).toEqual([]);
  });

  it('keeps parity across a hazard-heavy movement and combat sequence', () => {
    // Two ships drift through asteroid lanes: 'runner' survives its two
    // hazard rolls, 'doomed' dies on its first and live silently drops
    // its second entry inside the same drain. Parity must hold at both
    // publish points: after movement (queue populated) and after combat
    // begin (queue drained).
    const map: SolarSystemMap = {
      hexes: new Map([
        [asHexKey('1,0'), { terrain: 'asteroid' }],
        [asHexKey('2,0'), { terrain: 'asteroid' }],
        [asHexKey('1,2'), { terrain: 'asteroid' }],
        [asHexKey('2,2'), { terrain: 'asteroid' }],
      ]),
      bodies: [],
      bounds: { minQ: -20, maxQ: 20, minR: -20, maxR: 20 },
    };
    const preState = createTestState({
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
      phase: 'ordnance',
      ships: [
        createTestShip({
          id: asShipId('runner'),
          owner: 0,
          position: { q: -1, r: 0 },
          velocity: { dq: 3, dr: 0 },
        }),
        createTestShip({
          id: asShipId('doomed'),
          owner: 0,
          position: { q: -1, r: 2 },
          velocity: { dq: 3, dr: 0 },
          // One more disabled turn crosses the elimination threshold.
          damage: { disabledTurns: 5 },
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

    // Publish point 1: movement resolved, hazards queued.
    expect(moved.state.pendingAsteroidHazards).toHaveLength(4);
    expect(moved.state.phase).toBe('combat');

    const projectedMid = projectOrThrow(moved.engineEvents, preState, map);
    expect(getProjectionParityDiff(projectedMid, moved.state)).toEqual([]);

    // rng -> die roll 6: 1 disabled turn per hazard. runner survives both
    // rolls; doomed is eliminated on its first entry.
    const resolved = beginCombatPhase(
      structuredClone(moved.state),
      0,
      map,
      () => 0.99,
    );

    if ('error' in resolved) {
      throw new Error(resolved.error.message);
    }

    // Publish point 2: drain complete, including the silent drop of the
    // dead ship's second entry.
    expect(resolved.state.pendingAsteroidHazards).toEqual([]);
    expect(resolved.state.ships.find((s) => s.id === 'doomed')?.lifecycle).toBe(
      'destroyed',
    );

    const projected = projectOrThrow(
      [...moved.engineEvents, ...resolved.engineEvents],
      preState,
      map,
    );
    expect(getProjectionParityDiff(projected, resolved.state)).toEqual([]);
  });

  it('does not mask kill attribution in normalizeStateForParity', () => {
    const live = baseState({
      ships: [
        baseShip({
          lifecycle: 'destroyed',
          deathCause: 'nuke',
          killedBy: asShipId('ord0'),
        }),
      ],
    });

    const normalized = normalizeStateForParity(live);

    expect(normalized.ships[0].deathCause).toBe('nuke');
    expect(normalized.ships[0].killedBy).toBe('ord0');
  });
});
