import { describe, expect, it, vi } from 'vitest';

import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  appendEnvelopedEvents,
  getEventStream,
  getEventStreamLength,
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
