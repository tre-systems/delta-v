import { describe, expect, it, vi } from 'vitest';

import { aiAstrogation, aiCombat, aiOrdnance } from '../../shared/ai';
import { processOrdnance, skipOrdnance } from '../../shared/engine/astrogation';
import { processCombat } from '../../shared/engine/combat';
import type {
  EngineEvent,
  EventEnvelope,
} from '../../shared/engine/engine-events';
import {
  createGameOrThrow,
  processAstrogation,
} from '../../shared/engine/game-engine';
import { processLogistics } from '../../shared/engine/logistics';
import { asGameId, asShipId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  appendEnvelopedEvents,
  getCheckpoint,
  getEventStream,
  getEventStreamLength,
  getEventStreamTail,
  getProjectedCurrentState,
  getProjectedCurrentStateRaw,
  getProjectedReplayTimeline,
  hasProjectionParity,
  projectReplayTimeline,
  saveCheckpoint,
  saveMatchCreatedAt,
} from './archive';
import { resolveTurnTimeoutOutcome } from './turns';

const createMockStorage = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof key === 'string') {
        data.set(key, value);
        return;
      }

      for (const [entryKey, entryValue] of Object.entries(key)) {
        data.set(entryKey, entryValue);
      }
    },
  } as unknown as DurableObjectStorage;
};

const MockStorage = function MockStorage() {
  return createMockStorage();
} as unknown as {
  new (): DurableObjectStorage;
};

const map = buildSolarSystemMap();

const diffStates = (
  actual: unknown,
  expected: unknown,
  path = '',
): Array<{ path: string; actual: unknown; expected: unknown }> => {
  if (typeof actual !== typeof expected) {
    return [{ path, actual, expected }];
  }

  if (
    actual === null ||
    expected === null ||
    typeof actual !== 'object' ||
    typeof expected !== 'object'
  ) {
    return Object.is(actual, expected) ? [] : [{ path, actual, expected }];
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return [{ path, actual, expected }];
    }

    const diffs: Array<{ path: string; actual: unknown; expected: unknown }> =
      [];
    const length = Math.max(actual.length, expected.length);

    for (let index = 0; index < length; index++) {
      diffs.push(
        ...diffStates(actual[index], expected[index], `${path}[${index}]`),
      );
    }

    return diffs;
  }

  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(actualRecord),
    ...Object.keys(expectedRecord),
  ]);
  const diffs: Array<{ path: string; actual: unknown; expected: unknown }> = [];

  for (const key of [...keys].sort()) {
    diffs.push(
      ...diffStates(
        actualRecord[key],
        expectedRecord[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }

  return diffs;
};

describe('match-scoped event stream', () => {
  it('migrates legacy unchunked event streams on read', async () => {
    const storage = createMockStorage();
    const legacyStream: EventEnvelope[] = [
      {
        gameId: asGameId('LEGACY-m1'),
        seq: 1,
        ts: 1_700_000_000_000,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'biplanetary',
          turn: 1,
          phase: 'astrogation',
          matchSeed: 0,
        },
      },
    ];

    await storage.put('events:LEGACY-m1', legacyStream);

    expect(await getEventStream(storage, asGameId('LEGACY-m1'))).toEqual(
      legacyStream,
    );
    expect(await storage.get('eventChunkCount:LEGACY-m1')).toBe(1);
    expect(await storage.get('eventSeq:LEGACY-m1')).toBe(1);
  });

  it('appends enveloped events with sequential seq numbers', async () => {
    const storage = createMockStorage();

    await appendEnvelopedEvents(storage, asGameId('ROOM1-m1'), 0, {
      type: 'shipMoved',
      shipId: asShipId('p0s0'),
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      fuelSpent: 1,
      fuelRemaining: 9,
      newVelocity: { dq: 1, dr: 0 },
      lifecycle: 'active',
      overloadUsed: false,
      pendingGravityEffects: [],
    });

    await appendEnvelopedEvents(storage, asGameId('ROOM1-m1'), 1, {
      type: 'shipMoved',
      shipId: asShipId('p1s0'),
      from: { q: 10, r: 10 },
      to: { q: 9, r: 10 },
      path: [
        { q: 10, r: 10 },
        { q: 9, r: 10 },
      ],
      fuelSpent: 1,
      fuelRemaining: 9,
      newVelocity: { dq: -1, dr: 0 },
      lifecycle: 'active',
      overloadUsed: false,
      pendingGravityEffects: [],
    });

    const stream = await getEventStream(storage, asGameId('ROOM1-m1'));
    expect(stream).toHaveLength(2);
    expect(stream[0].seq).toBe(1);
    expect(stream[1].seq).toBe(2);
    expect(stream[0].gameId).toBe('ROOM1-m1');
    expect(stream[1].gameId).toBe('ROOM1-m1');
    expect(stream[0].actor).toBe(0);
    expect(stream[1].actor).toBe(1);
  });

  it('batches append writes into a single storage put call', async () => {
    const storage = createMockStorage();
    const putSpy = vi.spyOn(storage, 'put');

    await appendEnvelopedEvents(storage, asGameId('BATCH-m1'), 0, {
      type: 'phaseChanged',
      phase: 'combat',
      turn: 2,
      activePlayer: 0,
    });

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        'events:BATCH-m1:chunk:0': expect.any(Array),
        'eventChunkCount:BATCH-m1': 1,
        'eventSeq:BATCH-m1': 1,
      }),
    );
  });

  it('assigns timestamps to all envelopes', async () => {
    const storage = createMockStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    await appendEnvelopedEvents(storage, asGameId('TS-m1'), null, {
      type: 'gameCreated',
      scenario: 'biplanetary',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });

    const stream = await getEventStream(storage, asGameId('TS-m1'));
    expect(stream[0].ts).toBe(1700000000000);

    vi.restoreAllMocks();
  });

  it('tracks stream length via sequence counter', async () => {
    const storage = createMockStorage();

    expect(await getEventStreamLength(storage, asGameId('LEN-m1'))).toBe(0);

    await appendEnvelopedEvents(storage, asGameId('LEN-m1'), 0, {
      type: 'shipMoved',
      shipId: asShipId('s1'),
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      fuelSpent: 1,
      fuelRemaining: 9,
      newVelocity: { dq: 1, dr: 0 },
      lifecycle: 'active',
      overloadUsed: false,
      pendingGravityEffects: [],
    });

    expect(await getEventStreamLength(storage, asGameId('LEN-m1'))).toBe(1);

    await appendEnvelopedEvents(
      storage,
      asGameId('LEN-m1'),
      0,
      { type: 'shipLanded', shipId: asShipId('s1') },
      { type: 'shipResupplied', shipId: asShipId('s1'), source: 'base' },
    );

    expect(await getEventStreamLength(storage, asGameId('LEN-m1'))).toBe(3);
  });

  it('isolates event streams across rematches', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, asGameId('ISO-m1'), null, {
      type: 'gameCreated',
      scenario: 'duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });

    await appendEnvelopedEvents(storage, asGameId('ISO-m2'), null, {
      type: 'gameCreated',
      scenario: 'duel',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });

    const m1 = await getEventStream(storage, asGameId('ISO-m1'));
    const m2 = await getEventStream(storage, asGameId('ISO-m2'));

    expect(m1).toHaveLength(1);
    expect(m2).toHaveLength(1);
    expect(m1[0].gameId).toBe('ISO-m1');
    expect(m2[0].gameId).toBe('ISO-m2');
    expect(m1[0].seq).toBe(1);
    expect(m2[0].seq).toBe(1);
  });

  it('skips append for empty event arrays', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, asGameId('EMPTY-m1'), 0);

    expect(await getEventStream(storage, asGameId('EMPTY-m1'))).toEqual([]);
    expect(await getEventStreamLength(storage, asGameId('EMPTY-m1'))).toBe(0);
  });

  it('preserves system actor as null', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, asGameId('SYS-m1'), null, {
      type: 'gameOver',
      winner: 0,
      reason: 'Fleet eliminated!',
    });

    const stream = await getEventStream(storage, asGameId('SYS-m1'));
    expect(stream[0].actor).toBeNull();
  });

  it('spills appends across chunk boundaries without losing sequence', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(
      storage,
      asGameId('CHUNK-m1'),
      0,
      ...Array.from({ length: 70 }, (_, index) => ({
        type: 'shipLanded' as const,
        shipId: asShipId(`s${index}`),
      })),
    );

    const stream = await getEventStream(storage, asGameId('CHUNK-m1'));

    expect(stream).toHaveLength(70);
    expect(stream[0].seq).toBe(1);
    expect(stream[63].seq).toBe(64);
    expect(stream[64].seq).toBe(65);
    expect(stream[69].seq).toBe(70);
    expect(await getEventStreamLength(storage, asGameId('CHUNK-m1'))).toBe(70);
  });

  it('reads only the requested tail from chunked storage', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(
      storage,
      asGameId('TAIL-READ-m1'),
      0,
      ...Array.from({ length: 70 }, (_, index) => ({
        type: 'shipLanded' as const,
        shipId: asShipId(`tail-${index}`),
      })),
    );

    const tail = await getEventStreamTail(
      storage,
      asGameId('TAIL-READ-m1'),
      64,
    );

    expect(tail).toHaveLength(6);
    expect(tail[0].seq).toBe(65);
    expect(tail.at(-1)?.seq).toBe(70);
  });

  it('lazily migrates legacy array-backed streams before appending', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await storage.put<EventEnvelope[]>('events:LEGACY-m1', [
      {
        gameId: asGameId('LEGACY-m1'),
        seq: 1,
        ts: 1000,
        actor: null,
        event: {
          type: 'gameCreated',
          scenario: 'duel',
          turn: 1,
          phase: 'astrogation',
          matchSeed: 0,
        },
      },
    ]);

    await appendEnvelopedEvents(storage, asGameId('LEGACY-m1'), 0, {
      type: 'shipLanded',
      shipId: asShipId('legacy-ship'),
    });

    const stream = await getEventStream(storage, asGameId('LEGACY-m1'));

    expect(stream).toHaveLength(2);
    expect(stream[0].seq).toBe(1);
    expect(stream[1].seq).toBe(2);
    expect(await getEventStreamLength(storage, asGameId('LEGACY-m1'))).toBe(2);
  });

  it('envelope structure matches EventEnvelope interface', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    const event: EngineEvent = {
      type: 'combatAttack',
      attackerIds: [asShipId('p0s0')],
      targetId: asShipId('p1s0'),
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 1,
    };

    await appendEnvelopedEvents(storage, asGameId('SHAPE-m1'), 0, event);

    const stream = await getEventStream(storage, asGameId('SHAPE-m1'));
    const envelope = stream[0];

    expect(Object.keys(envelope).sort()).toEqual(
      ['actor', 'event', 'gameId', 'seq', 'ts'].sort(),
    );
    expect(envelope.event).toEqual(event);
  });
});

describe('checkpoint persistence', () => {
  it('saves and retrieves a checkpoint', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CHK-m1'),
      findBaseHex,
    );

    await saveCheckpoint(storage, asGameId('CHK-m1'), state, 5);

    const checkpoint = await getCheckpoint(storage, asGameId('CHK-m1'));
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.gameId).toBe('CHK-m1');
    expect(checkpoint?.seq).toBe(5);
    expect(checkpoint?.turn).toBe(state.turnNumber);
    expect(checkpoint?.phase).toBe(state.phase);
    expect(checkpoint?.state.gameId).toBe('CHK-m1');
  });

  it('checkpoint structure has expected fields', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('SHAPE-m1'),
      findBaseHex,
    );

    await saveCheckpoint(storage, asGameId('SHAPE-m1'), state, 3);

    const checkpoint = await getCheckpoint(storage, asGameId('SHAPE-m1'));
    expect(checkpoint).not.toBeNull();
    expect(Object.keys(checkpoint ?? {}).sort()).toEqual(
      ['gameId', 'phase', 'savedAt', 'seq', 'state', 'turn'].sort(),
    );
  });

  it('checkpoint state is deep-cloned from live state', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CLONE-m1'),
      findBaseHex,
    );

    await saveCheckpoint(storage, asGameId('CLONE-m1'), state, 1);

    // Mutate original state
    state.turnNumber = 999;

    const checkpoint = await getCheckpoint(storage, asGameId('CLONE-m1'));
    expect(checkpoint?.state.turnNumber).not.toBe(999);
  });

  it('returns null for non-existent checkpoint', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const result = await getCheckpoint(storage, asGameId('NONE-m1'));
    expect(result).toBeNull();
  });
});

describe('projection parity: replay timeline vs live state', () => {
  it('replay entries form a consistent state progression', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('PARITY-m1'),
      findBaseHex,
    );

    // Run player 0 through astrogation with drift orders
    const orders = state.ships
      .filter((s) => s.owner === state.activePlayer)
      .map((s) => ({
        shipId: s.id,
        burn: null,
        overload: null as number | null,
      }));

    const result = processAstrogation(
      state,
      state.activePlayer,
      orders,
      map,
      Math.random,
    );

    if ('error' in result) return;

    // The result state should have progressed
    expect(result.state.gameId).toBe('PARITY-m1');
    expect(result.engineEvents.length).toBeGreaterThan(0);

    // State should be consistent: same gameId, ships present
    expect(result.state.ships.length).toBe(state.ships.length);
    expect(result.state.gameId).toBe(state.gameId);
  });

  it('checkpoint matches state at the sequenced point', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CKPT-m1'),
      findBaseHex,
    );

    // Simulate a game: astrogation → ordnance skip
    const orders = state.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({
        shipId: s.id,
        burn: null,
        overload: null as number | null,
      }));

    const astro = processAstrogation(state, 0, orders, map, Math.random);
    if ('error' in astro) return;

    // Append events and save checkpoint
    await appendEnvelopedEvents(
      storage,
      asGameId('CKPT-m1'),
      0,
      ...astro.engineEvents,
    );

    const seq = await getEventStreamLength(storage, asGameId('CKPT-m1'));
    await saveCheckpoint(storage, asGameId('CKPT-m1'), astro.state, seq);

    // Verify checkpoint matches
    const checkpoint = await getCheckpoint(storage, asGameId('CKPT-m1'));
    expect(checkpoint?.seq).toBe(seq);
    expect(checkpoint?.state.turnNumber).toBe(astro.state.turnNumber);
    expect(checkpoint?.state.phase).toBe(astro.state.phase);

    // Event stream should have events up to the seq
    const stream = await getEventStream(storage, asGameId('CKPT-m1'));
    expect(stream.length).toBe(seq);
    expect(stream[stream.length - 1].seq).toBe(seq);
  });
});

describe('replay projection', () => {
  it('builds replay entries from persisted event stream state changes', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    await appendEnvelopedEvents(
      storage,
      asGameId('FRAME-m1'),
      null,
      {
        type: 'gameCreated',
        scenario: 'Bi-Planetary',
        turn: 1,
        phase: 'astrogation',
        matchSeed: 0,
      },
      {
        type: 'turnAdvanced',
        turn: 2,
        activePlayer: 1,
      },
    );

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('FRAME-m1'),
      0,
    );

    expect(projected?.entries).toHaveLength(2);
    expect(projected?.entries[0]?.message.type).toBe('gameStart');
    expect(projected?.entries[1]?.message.type).toBe('stateUpdate');
  });

  it('derives current state from checkpoint plus event tail', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const checkpointState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CURR-m1'),
      findBaseHex,
    );
    await saveCheckpoint(storage, asGameId('CURR-m1'), checkpointState, 1);
    await appendEnvelopedEvents(
      storage,
      asGameId('CURR-m1'),
      0,
      {
        type: 'turnAdvanced',
        turn: 3,
        activePlayer: 0,
      },
      {
        type: 'phaseChanged',
        phase: 'combat',
        turn: 3,
        activePlayer: 0,
      },
    );

    const projectedState = await getProjectedCurrentState(
      storage,
      asGameId('CURR-m1'),
      0,
    );

    expect(projectedState?.gameId).toBe('CURR-m1');
    expect(projectedState?.turnNumber).toBe(3);
    expect(projectedState?.phase).toBe('combat');
  });

  it('derives raw current state for parity checks', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('RAW-m1'),
      findBaseHex,
    );
    state.turnNumber = 5;
    state.phase = 'combat';

    await saveCheckpoint(storage, asGameId('RAW-m1'), state, 11);

    const projectedState = await getProjectedCurrentStateRaw(
      storage,
      asGameId('RAW-m1'),
    );

    expect(projectedState).toEqual(state);
  });

  it('migrates legacy checkpoints without a schema version', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('LEGACY-SCHEMA-m1'),
      findBaseHex,
    );
    state.schemaVersion = undefined;

    await saveCheckpoint(storage, asGameId('LEGACY-SCHEMA-m1'), state, 11);

    const checkpoint = await getCheckpoint(
      storage,
      asGameId('LEGACY-SCHEMA-m1'),
    );
    const projectedState = await getProjectedCurrentStateRaw(
      storage,
      asGameId('LEGACY-SCHEMA-m1'),
    );

    expect(checkpoint?.state.schemaVersion).toBe(1);
    expect(projectedState?.schemaVersion).toBe(1);
  });

  it('filters projected replay timelines per viewer', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('VIEW-m1'),
      findBaseHex,
    );
    state.ships[0].identity = {
      hasFugitives: true,
      revealed: false,
    };
    state.scenarioRules = {
      ...state.scenarioRules,
      hiddenIdentityInspection: true,
    };

    await saveCheckpoint(storage, asGameId('VIEW-m1'), state, 1);

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('VIEW-m1'),
      1,
    );

    expect(projected).not.toBeNull();
    const projectedState = projected?.entries[0]?.message.state;
    const enemyShip = projectedState?.ships.find((ship) => ship.owner === 0);

    expect(enemyShip?.identity).toBeUndefined();
  });

  it('derives replay metadata from match identity and event stream', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    await saveMatchCreatedAt(storage, asGameId('META1-m1'), 1234);
    await appendEnvelopedEvents(storage, asGameId('META1-m1'), null, {
      type: 'gameCreated',
      scenario: 'Bi-Planetary',
      turn: 1,
      phase: 'astrogation',
      matchSeed: 0,
    });

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('META1-m1'),
      0,
    );

    expect(projected?.roomCode).toBe('META1');
    expect(projected?.matchNumber).toBe(1);
    expect(projected?.scenario).toBe('Bi-Planetary');
    expect(projected?.createdAt).toBe(1234);
  });

  it('falls back to a synthetic checkpoint replay when archive is missing', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CKREPLAY-m1'),
      findBaseHex,
    );
    state.turnNumber = 4;
    state.phase = 'combat';

    await saveCheckpoint(storage, asGameId('CKREPLAY-m1'), state, 12);

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('CKREPLAY-m1'),
      0,
    );

    expect(projected).not.toBeNull();
    expect(projected?.gameId).toBe('CKREPLAY-m1');
    expect(projected?.entries).toHaveLength(1);
    expect(projected?.entries[0]?.message.type).toBe('stateUpdate');
    expect(projected?.entries[0]?.turn).toBe(4);
    expect(projected?.entries[0]?.phase).toBe('combat');
  });

  it('returns null when neither replay timeline nor checkpoint exists', () => {
    expect(projectReplayTimeline(null, [], 0)).toBeNull();
  });

  it('projects checkpoint plus tail events into a replay timeline', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const checkpointState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TAILS-m1'),
      findBaseHex,
    );
    checkpointState.turnNumber = 2;
    checkpointState.phase = 'ordnance';
    await saveCheckpoint(storage, asGameId('TAILS-m1'), checkpointState, 0);
    await appendEnvelopedEvents(
      storage,
      asGameId('TAILS-m1'),
      0,
      {
        type: 'turnAdvanced',
        turn: 3,
        activePlayer: 0,
      },
      {
        type: 'phaseChanged',
        phase: 'combat',
        turn: 3,
        activePlayer: 0,
      },
    );

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('TAILS-m1'),
      0,
    );

    expect(projected).not.toBeNull();
    expect(projected?.entries).toHaveLength(3);
    expect(projected?.entries[0]?.turn).toBe(2);
    expect(projected?.entries[1]?.turn).toBe(3);
    expect(projected?.entries[1]?.phase).toBe('ordnance');
    expect(projected?.entries[2]?.turn).toBe(3);
    expect(projected?.entries[2]?.phase).toBe('combat');
  });

  it('preserves replay history that predates a later checkpoint', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(
      storage,
      asGameId('HISTORY-m1'),
      null,
      {
        type: 'gameCreated',
        scenario: 'Bi-Planetary',
        turn: 1,
        phase: 'astrogation',
        matchSeed: 0,
      },
      {
        type: 'turnAdvanced',
        turn: 2,
        activePlayer: 1,
      },
    );

    const checkpointState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('HISTORY-m1'),
      findBaseHex,
    );
    checkpointState.turnNumber = 2;
    checkpointState.activePlayer = 1;

    await saveCheckpoint(storage, asGameId('HISTORY-m1'), checkpointState, 2);
    await appendEnvelopedEvents(storage, asGameId('HISTORY-m1'), 1, {
      type: 'phaseChanged',
      phase: 'combat',
      turn: 2,
      activePlayer: 1,
    });

    const projected = await getProjectedReplayTimeline(
      storage,
      asGameId('HISTORY-m1'),
      0,
    );

    expect(projected?.entries).toHaveLength(3);
    expect(projected?.entries[0]?.message.type).toBe('gameStart');
    expect(projected?.entries[0]?.turn).toBe(1);
    expect(projected?.entries[1]?.turn).toBe(2);
    expect(projected?.entries[1]?.phase).toBe('astrogation');
    expect(projected?.entries[2]?.turn).toBe(2);
    expect(projected?.entries[2]?.phase).toBe('combat');
  });

  it('prefers newer event-tail state over older checkpoint state', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const checkpointState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('STALE-m1'),
      findBaseHex,
    );
    checkpointState.turnNumber = 1;

    await saveCheckpoint(storage, asGameId('STALE-m1'), checkpointState, 1);
    await appendEnvelopedEvents(
      storage,
      asGameId('STALE-m1'),
      0,
      {
        type: 'turnAdvanced',
        turn: 4,
        activePlayer: 0,
      },
      {
        type: 'phaseChanged',
        phase: 'combat',
        turn: 4,
        activePlayer: 0,
      },
    );
    const projectedState = await getProjectedCurrentStateRaw(
      storage,
      asGameId('STALE-m1'),
    );
    const projectedTimeline = await getProjectedReplayTimeline(
      storage,
      asGameId('STALE-m1'),
      0,
    );

    expect(projectedState?.turnNumber).toBe(4);
    expect(projectedTimeline?.entries.at(-1)?.turn).toBe(4);
  });

  it('reports parity when live state matches persisted checkpoint state', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const liveState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('PARITY2-m1'),
      findBaseHex,
    );
    liveState.turnNumber = 2;
    liveState.phase = 'ordnance';

    await saveCheckpoint(storage, asGameId('PARITY2-m1'), liveState, 4);

    expect(
      await hasProjectionParity(storage, asGameId('PARITY2-m1'), liveState),
    ).toBe(true);
  });

  it('ignores transient connection state in parity checks', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const projectedState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('PARITY-CONN-m1'),
      findBaseHex,
    );
    const liveState = structuredClone(projectedState);
    liveState.players[0].connected = true;
    liveState.players[1].connected = true;

    await saveCheckpoint(
      storage,
      asGameId('PARITY-CONN-m1'),
      projectedState,
      1,
    );

    expect(
      await hasProjectionParity(storage, asGameId('PARITY-CONN-m1'), liveState),
    ).toBe(true);
  });

  it('maintains projection parity through a complete duel flow', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    let liveState = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('PARITY4-m1'),
      findBaseHex,
    );

    await appendEnvelopedEvents(storage, asGameId('PARITY4-m1'), null, {
      type: 'gameCreated',
      scenario: liveState.scenario,
      turn: liveState.turnNumber,
      phase: liveState.phase,
      matchSeed: 0,
    });

    for (let step = 0; step < 30 && liveState.phase !== 'gameOver'; step++) {
      const actor = liveState.activePlayer;
      const outcome =
        liveState.phase === 'astrogation'
          ? processAstrogation(
              liveState,
              actor,
              aiAstrogation(liveState, actor, map, 'normal'),
              map,
              () => 0.5,
            )
          : liveState.phase === 'ordnance'
            ? (() => {
                const launches = aiOrdnance(liveState, actor, map, 'normal');

                return launches.length > 0
                  ? processOrdnance(liveState, actor, launches, map, () => 0.5)
                  : skipOrdnance(liveState, actor, map, () => 0.5);
              })()
            : liveState.phase === 'combat'
              ? (() => {
                  const attacks = aiCombat(liveState, actor, map, 'normal');

                  return attacks.length > 0
                    ? processCombat(liveState, actor, attacks, map, () => 0.5)
                    : resolveTurnTimeoutOutcome(liveState, map, () => 0.5);
                })()
              : liveState.phase === 'logistics'
                ? processLogistics(liveState, actor, [], map)
                : resolveTurnTimeoutOutcome(liveState, map, () => 0.5);

      expect(outcome).not.toBeNull();
      expect(outcome && 'error' in outcome).toBe(false);

      if (!outcome || 'error' in outcome) {
        return;
      }

      const events =
        'engineEvents' in outcome ? outcome.engineEvents : outcome.events;

      await appendEnvelopedEvents(storage, liveState.gameId, actor, ...events);
      liveState = outcome.state;

      const projectedState = await getProjectedCurrentStateRaw(
        storage,
        liveState.gameId,
      );
      const diffs = diffStates(liveState, projectedState).filter(
        (diff) =>
          !diff.path.endsWith('.connected') &&
          !diff.path.endsWith('.ready') &&
          !diff.path.endsWith('.detected'),
      );

      expect(diffs).toEqual([]);
    }
  });

  it('detects parity mismatch when live state diverges from projection', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const projectedState = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('PARITY3-m1'),
      findBaseHex,
    );
    const liveState = structuredClone(projectedState);
    liveState.turnNumber = projectedState.turnNumber + 1;

    await appendEnvelopedEvents(storage, asGameId('PARITY3-m1'), null, {
      type: 'gameCreated',
      scenario: projectedState.scenario,
      turn: projectedState.turnNumber,
      phase: projectedState.phase,
      matchSeed: 0,
    });

    expect(
      await hasProjectionParity(storage, asGameId('PARITY3-m1'), liveState),
    ).toBe(false);
  });
});
