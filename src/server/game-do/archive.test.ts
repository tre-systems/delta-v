import { describe, expect, it, vi } from 'vitest';

import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  createGame,
  processAstrogation,
} from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createReplayArchive } from '../../shared/replay';
import {
  appendEnvelopedEvents,
  appendProjectionMessage,
  getCheckpoint,
  getEventStream,
  getEventStreamLength,
  getProjectedCurrentState,
  getProjectedReplayArchive,
  getProjectionFrames,
  projectReplayArchive,
  saveCheckpoint,
  saveReplayArchive,
} from './archive';

class MockStorage {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
}

const map = buildSolarSystemMap();

describe('match-scoped event stream', () => {
  it('appends enveloped events with sequential seq numbers', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, 'ROOM1-m1', 0, {
      type: 'shipMoved',
      shipId: 'p0s0',
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      fuelSpent: 1,
      newVelocity: { dq: 1, dr: 0 },
    });

    await appendEnvelopedEvents(storage, 'ROOM1-m1', 1, {
      type: 'shipMoved',
      shipId: 'p1s0',
      from: { q: 10, r: 10 },
      to: { q: 9, r: 10 },
      fuelSpent: 1,
      newVelocity: { dq: -1, dr: 0 },
    });

    const stream = await getEventStream(storage, 'ROOM1-m1');
    expect(stream).toHaveLength(2);
    expect(stream[0].seq).toBe(1);
    expect(stream[1].seq).toBe(2);
    expect(stream[0].gameId).toBe('ROOM1-m1');
    expect(stream[1].gameId).toBe('ROOM1-m1');
    expect(stream[0].actor).toBe(0);
    expect(stream[1].actor).toBe(1);
  });

  it('assigns timestamps to all envelopes', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    await appendEnvelopedEvents(storage, 'TS-m1', null, {
      type: 'gameCreated',
      scenario: 'biplanetary',
      turn: 1,
      phase: 'astrogation',
    });

    const stream = await getEventStream(storage, 'TS-m1');
    expect(stream[0].ts).toBe(1700000000000);

    vi.restoreAllMocks();
  });

  it('tracks stream length via sequence counter', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    expect(await getEventStreamLength(storage, 'LEN-m1')).toBe(0);

    await appendEnvelopedEvents(storage, 'LEN-m1', 0, {
      type: 'shipMoved',
      shipId: 's1',
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      fuelSpent: 1,
      newVelocity: { dq: 1, dr: 0 },
    });

    expect(await getEventStreamLength(storage, 'LEN-m1')).toBe(1);

    await appendEnvelopedEvents(
      storage,
      'LEN-m1',
      0,
      { type: 'shipLanded', shipId: 's1' },
      { type: 'shipResupplied', shipId: 's1' },
    );

    expect(await getEventStreamLength(storage, 'LEN-m1')).toBe(3);
  });

  it('isolates event streams across rematches', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, 'ISO-m1', null, {
      type: 'gameCreated',
      scenario: 'duel',
      turn: 1,
      phase: 'astrogation',
    });

    await appendEnvelopedEvents(storage, 'ISO-m2', null, {
      type: 'gameCreated',
      scenario: 'duel',
      turn: 1,
      phase: 'astrogation',
    });

    const m1 = await getEventStream(storage, 'ISO-m1');
    const m2 = await getEventStream(storage, 'ISO-m2');

    expect(m1).toHaveLength(1);
    expect(m2).toHaveLength(1);
    expect(m1[0].gameId).toBe('ISO-m1');
    expect(m2[0].gameId).toBe('ISO-m2');
    expect(m1[0].seq).toBe(1);
    expect(m2[0].seq).toBe(1);
  });

  it('skips append for empty event arrays', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, 'EMPTY-m1', 0);

    expect(await getEventStream(storage, 'EMPTY-m1')).toEqual([]);
    expect(await getEventStreamLength(storage, 'EMPTY-m1')).toBe(0);
  });

  it('preserves system actor as null', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    await appendEnvelopedEvents(storage, 'SYS-m1', null, {
      type: 'gameOver',
      winner: 0,
      reason: 'Fleet eliminated!',
    });

    const stream = await getEventStream(storage, 'SYS-m1');
    expect(stream[0].actor).toBeNull();
  });

  it('envelope structure matches EventEnvelope interface', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;

    const event: EngineEvent = {
      type: 'combatAttack',
      attackerIds: ['p0s0'],
      targetId: 'p1s0',
      targetType: 'ship',
      attackType: 'gun',
      roll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 1,
    };

    await appendEnvelopedEvents(storage, 'SHAPE-m1', 0, event);

    const stream = await getEventStream(storage, 'SHAPE-m1');
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
    const state = createGame(SCENARIOS.biplanetary, map, 'CHK-m1', findBaseHex);

    await saveCheckpoint(storage, 'CHK-m1', state, 5);

    const checkpoint = await getCheckpoint(storage, 'CHK-m1');
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
    const state = createGame(SCENARIOS.duel, map, 'SHAPE-m1', findBaseHex);

    await saveCheckpoint(storage, 'SHAPE-m1', state, 3);

    const checkpoint = await getCheckpoint(storage, 'SHAPE-m1');
    expect(checkpoint).not.toBeNull();
    expect(Object.keys(checkpoint ?? {}).sort()).toEqual(
      ['gameId', 'phase', 'savedAt', 'seq', 'state', 'turn'].sort(),
    );
  });

  it('checkpoint state is deep-cloned from live state', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const map = buildSolarSystemMap();
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'CLONE-m1',
      findBaseHex,
    );

    await saveCheckpoint(storage, 'CLONE-m1', state, 1);

    // Mutate original state
    state.turnNumber = 999;

    const checkpoint = await getCheckpoint(storage, 'CLONE-m1');
    expect(checkpoint?.state.turnNumber).not.toBe(999);
  });

  it('returns null for non-existent checkpoint', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const result = await getCheckpoint(storage, 'NONE-m1');
    expect(result).toBeNull();
  });
});

describe('projection parity: replay archive vs live state', () => {
  it('replay entries form a consistent state progression', () => {
    const map = buildSolarSystemMap();
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'PARITY-m1',
      findBaseHex,
    );

    // Run player 0 through astrogation with drift orders
    const orders = state.ships
      .filter((s) => s.owner === state.activePlayer)
      .map((s) => ({ shipId: s.id, burn: null }));

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
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'CKPT-m1',
      findBaseHex,
    );

    // Simulate a game: astrogation → ordnance skip
    const orders = state.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null }));

    const astro = processAstrogation(state, 0, orders, map, Math.random);
    if ('error' in astro) return;

    // Append events and save checkpoint
    await appendEnvelopedEvents(storage, 'CKPT-m1', 0, ...astro.engineEvents);

    const seq = await getEventStreamLength(storage, 'CKPT-m1');
    await saveCheckpoint(storage, 'CKPT-m1', astro.state, seq);

    // Verify checkpoint matches
    const checkpoint = await getCheckpoint(storage, 'CKPT-m1');
    expect(checkpoint?.seq).toBe(seq);
    expect(checkpoint?.state.turnNumber).toBe(astro.state.turnNumber);
    expect(checkpoint?.state.phase).toBe(astro.state.phase);

    // Event stream should have events up to the seq
    const stream = await getEventStream(storage, 'CKPT-m1');
    expect(stream.length).toBe(seq);
    expect(stream[stream.length - 1].seq).toBe(seq);
  });
});

describe('replay projection', () => {
  it('persists projection frames with event sequence metadata', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'FRAME-m1',
      findBaseHex,
    );

    await appendProjectionMessage(storage, 'FRAME-m1', 7, {
      type: 'gameStart',
      state,
    });

    const frames = await getProjectionFrames(storage, 'FRAME-m1');

    expect(frames).toHaveLength(1);
    expect(frames[0]?.sequence).toBe(1);
    expect(frames[0]?.eventSeq).toBe(7);
    expect(frames[0]?.message.type).toBe('gameStart');
  });

  it('derives current state from the latest projection frame', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'CURR-m1',
      findBaseHex,
    );
    state.turnNumber = 3;
    state.phase = 'combat';

    await appendProjectionMessage(storage, 'CURR-m1', 8, {
      type: 'stateUpdate',
      state,
    });

    const projectedState = await getProjectedCurrentState(
      storage,
      'CURR-m1',
      0,
    );

    expect(projectedState?.gameId).toBe('CURR-m1');
    expect(projectedState?.turnNumber).toBe(3);
    expect(projectedState?.phase).toBe('combat');
  });

  it('filters projected replay archives per viewer', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'VIEW-m1',
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

    await saveReplayArchive(
      storage,
      createReplayArchive(
        'VIEW1',
        1,
        { type: 'gameStart', state },
        1_700_000_000_000,
      ),
    );

    await appendProjectionMessage(storage, 'VIEW-m1', 1, {
      type: 'gameStart',
      state,
    });

    const projected = await getProjectedReplayArchive(storage, 'VIEW-m1', 1);

    expect(projected).not.toBeNull();
    const projectedState = projected?.entries[0]?.message.state;
    const enemyShip = projectedState?.ships.find((ship) => ship.owner === 0);

    expect(enemyShip?.identity).toBeUndefined();
  });

  it('falls back to a synthetic checkpoint replay when archive is missing', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const state = createGame(
      SCENARIOS.biplanetary,
      map,
      'CKREPLAY-m1',
      findBaseHex,
    );
    state.turnNumber = 4;
    state.phase = 'combat';

    await saveCheckpoint(storage, 'CKREPLAY-m1', state, 12);

    const projected = await getProjectedReplayArchive(
      storage,
      'CKREPLAY-m1',
      0,
    );

    expect(projected).not.toBeNull();
    expect(projected?.gameId).toBe('CKREPLAY-m1');
    expect(projected?.entries).toHaveLength(1);
    expect(projected?.entries[0]?.message.type).toBe('stateUpdate');
    expect(projected?.entries[0]?.turn).toBe(4);
    expect(projected?.entries[0]?.phase).toBe('combat');
  });

  it('returns null when neither replay archive nor checkpoint exists', () => {
    expect(projectReplayArchive(null, null, [], 0)).toBeNull();
  });

  it('projects checkpoint plus tail frames instead of replay archive snapshots', async () => {
    const storage = new MockStorage() as unknown as DurableObjectStorage;
    const checkpointState = createGame(
      SCENARIOS.biplanetary,
      map,
      'TAILS-m1',
      findBaseHex,
    );
    checkpointState.turnNumber = 2;
    checkpointState.phase = 'ordnance';

    const tailState = structuredClone(checkpointState);
    tailState.turnNumber = 3;
    tailState.phase = 'combat';

    await saveCheckpoint(storage, 'TAILS-m1', checkpointState, 4);
    await appendProjectionMessage(storage, 'TAILS-m1', 4, {
      type: 'stateUpdate',
      state: checkpointState,
    });
    await appendProjectionMessage(storage, 'TAILS-m1', 5, {
      type: 'stateUpdate',
      state: tailState,
    });

    const projected = await getProjectedReplayArchive(storage, 'TAILS-m1', 0);

    expect(projected).not.toBeNull();
    expect(projected?.entries).toHaveLength(2);
    expect(projected?.entries[0]?.turn).toBe(2);
    expect(projected?.entries[1]?.turn).toBe(3);
    expect(projected?.entries[1]?.phase).toBe('combat');
  });
});
