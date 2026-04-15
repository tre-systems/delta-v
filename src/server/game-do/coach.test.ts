import { describe, expect, it, vi } from 'vitest';

import type { CoachDirective } from '../../shared/agent';
import {
  COACH_PREFIX,
  clearCoachDirectives,
  getCoachDirective,
  isMatchCoached,
  parseCoachMessage,
  setCoachDirective,
} from './coach';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

// Minimal Map-backed DurableObjectStorage for unit tests.
const fakeStorage = (): DurableObjectStorage => {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  } as unknown as DurableObjectStorage;
};

describe('parseCoachMessage', () => {
  it('returns null when prefix is missing', () => {
    expect(parseCoachMessage('hello world')).toBeNull();
    expect(parseCoachMessage('/coach2 wrong')).toBeNull();
  });

  it('returns null when body is empty', () => {
    expect(parseCoachMessage(COACH_PREFIX)).toBeNull();
    expect(parseCoachMessage(`${COACH_PREFIX}   `)).toBeNull();
  });

  it('extracts trimmed body', () => {
    const parsed = parseCoachMessage('/coach  redirect to Mars now  ');
    expect(parsed).toEqual({ text: 'redirect to Mars now' });
  });

  it('caps text at 500 chars to bound storage growth', () => {
    const long = 'x'.repeat(600);
    const parsed = parseCoachMessage(`${COACH_PREFIX}${long}`);
    expect(parsed?.text.length).toBe(500);
  });
});

describe('getCoachDirective / setCoachDirective', () => {
  it('round-trips a directive for seat 0', async () => {
    const storage = fakeStorage();
    const directive: CoachDirective = {
      text: 'burn prograde',
      turnReceived: 3,
      acknowledged: false,
    };
    await setCoachDirective(storage, 0, directive);
    const loaded = await getCoachDirective(storage, 0);
    expect(loaded).toEqual(directive);
  });

  it('sets matchCoached flag on first directive', async () => {
    const storage = fakeStorage();
    expect(await isMatchCoached(storage)).toBe(false);
    await setCoachDirective(storage, 1, {
      text: 'x',
      turnReceived: 1,
      acknowledged: false,
    });
    expect(await isMatchCoached(storage)).toBe(true);
  });

  it('replaces prior directive for the same seat', async () => {
    const storage = fakeStorage();
    await setCoachDirective(storage, 0, {
      text: 'first',
      turnReceived: 1,
      acknowledged: false,
    });
    await setCoachDirective(storage, 0, {
      text: 'second',
      turnReceived: 2,
      acknowledged: false,
    });
    const loaded = await getCoachDirective(storage, 0);
    expect(loaded?.text).toBe('second');
  });

  it('isolates directives by seat', async () => {
    const storage = fakeStorage();
    await setCoachDirective(storage, 0, {
      text: 'for zero',
      turnReceived: 1,
      acknowledged: false,
    });
    await setCoachDirective(storage, 1, {
      text: 'for one',
      turnReceived: 1,
      acknowledged: false,
    });
    expect((await getCoachDirective(storage, 0))?.text).toBe('for zero');
    expect((await getCoachDirective(storage, 1))?.text).toBe('for one');
  });

  it('returns null when no directive is stored', async () => {
    const storage = fakeStorage();
    expect(await getCoachDirective(storage, 0)).toBeNull();
    expect(await getCoachDirective(storage, 1)).toBeNull();
  });
});

describe('clearCoachDirectives', () => {
  it('removes both seats but leaves matchCoached intact', async () => {
    const storage = fakeStorage();
    await setCoachDirective(storage, 0, {
      text: 'a',
      turnReceived: 1,
      acknowledged: false,
    });
    await setCoachDirective(storage, 1, {
      text: 'b',
      turnReceived: 1,
      acknowledged: false,
    });
    expect(await isMatchCoached(storage)).toBe(true);
    await clearCoachDirectives(storage);
    expect(await getCoachDirective(storage, 0)).toBeNull();
    expect(await getCoachDirective(storage, 1)).toBeNull();
    // matchCoached stays — the match remains flagged for leaderboard purposes.
    expect(await isMatchCoached(storage)).toBe(true);
  });
});

describe('storage keys', () => {
  it('uses stable, namespaced keys that do not collide', () => {
    expect(GAME_DO_STORAGE_KEYS.coachDirectiveSeat0).toBe('coachDirective:0');
    expect(GAME_DO_STORAGE_KEYS.coachDirectiveSeat1).toBe('coachDirective:1');
    expect(GAME_DO_STORAGE_KEYS.matchCoached).toBe('matchCoached');
  });
});
