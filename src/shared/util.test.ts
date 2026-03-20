import { describe, expect, it } from 'vitest';

import {
  clamp,
  compact,
  cond,
  count,
  filterMap,
  groupBy,
  indexBy,
  mapValues,
  maxBy,
  minBy,
  partition,
  pickBy,
  randomChoice,
  sumBy,
  uniqueBy,
} from './util';

// --- General-purpose ---

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles min === max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('randomChoice', () => {
  it('returns the only element of a single-element array', () => {
    expect(randomChoice([42], Math.random)).toBe(42);
  });

  it('uses provided rng to select deterministically', () => {
    const arr = ['a', 'b', 'c'];

    // rng returns 0.0 -> index 0
    expect(randomChoice(arr, () => 0)).toBe('a');
    // rng returns 0.99 -> index 2
    expect(randomChoice(arr, () => 0.99)).toBe('c');
    // rng returns 0.5 -> index 1
    expect(randomChoice(arr, () => 0.5)).toBe('b');
  });
});

// --- Collection transforms ---

describe('sumBy', () => {
  it('sums by projection', () => {
    expect(sumBy([{ v: 1 }, { v: 2 }, { v: 3 }], (x) => x.v)).toBe(6);
  });

  it('returns 0 for empty array', () => {
    expect(sumBy([], () => 1)).toBe(0);
  });
});

describe('minBy', () => {
  it('returns element with smallest projected value', () => {
    const items = [
      { n: 'b', v: 5 },
      { n: 'a', v: 1 },
      { n: 'c', v: 3 },
    ];

    expect(minBy(items, (x) => x.v)).toEqual({ n: 'a', v: 1 });
  });

  it('returns undefined for empty array', () => {
    expect(minBy([], () => 0)).toBeUndefined();
  });

  it('returns first element on ties', () => {
    const items = [
      { id: 1, v: 2 },
      { id: 2, v: 2 },
    ];

    expect(minBy(items, (x) => x.v)?.id).toBe(1);
  });
});

describe('maxBy', () => {
  it('returns element with largest projected value', () => {
    const items = [
      { n: 'b', v: 5 },
      { n: 'a', v: 1 },
      { n: 'c', v: 3 },
    ];

    expect(maxBy(items, (x) => x.v)).toEqual({ n: 'b', v: 5 });
  });

  it('returns undefined for empty array', () => {
    expect(maxBy([], () => 0)).toBeUndefined();
  });
});

describe('indexBy', () => {
  it('indexes by key projection', () => {
    const items = [
      { id: 'x', v: 1 },
      { id: 'y', v: 2 },
    ];

    expect(indexBy(items, (x) => x.id)).toEqual({
      x: { id: 'x', v: 1 },
      y: { id: 'y', v: 2 },
    });
  });

  it('last writer wins on collision', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'a', v: 2 },
    ];

    expect(indexBy(items, (x) => x.id)).toEqual({ a: { id: 'a', v: 2 } });
  });

  it('returns empty object for empty array', () => {
    expect(indexBy([], () => 'k')).toEqual({});
  });
});

describe('groupBy', () => {
  it('groups by key projection', () => {
    const items = [
      { t: 'a', v: 1 },
      { t: 'b', v: 2 },
      { t: 'a', v: 3 },
    ];

    expect(groupBy(items, (x) => x.t)).toEqual({
      a: [
        { t: 'a', v: 1 },
        { t: 'a', v: 3 },
      ],
      b: [{ t: 'b', v: 2 }],
    });
  });

  it('returns empty object for empty array', () => {
    expect(groupBy([], () => 'k')).toEqual({});
  });
});

describe('pickBy', () => {
  it('filters object entries by value predicate', () => {
    const obj = { a: 1, b: 2, c: 3 };

    expect(pickBy(obj, (v) => v > 1)).toEqual({ b: 2, c: 3 });
  });

  it('passes key to predicate', () => {
    const obj = { keep: 1, drop: 2, keepToo: 3 };

    expect(pickBy(obj, (_v, k) => k.startsWith('keep'))).toEqual({
      keep: 1,
      keepToo: 3,
    });
  });

  it('returns empty object when nothing matches', () => {
    expect(pickBy({ a: 1 }, () => false)).toEqual({});
  });
});

describe('cond', () => {
  it('returns first matching result', () => {
    expect(cond([false, 'a'], [true, 'b'], [true, 'c'])).toBe('b');
  });

  it('returns undefined when nothing matches', () => {
    expect(cond([false, 'a'], [false, 'b'])).toBeUndefined();
  });

  it('works with nullish coalescing for default', () => {
    expect(cond([false, 'a']) ?? 'default').toBe('default');
  });

  it('returns undefined with no pairs', () => {
    expect(cond()).toBeUndefined();
  });
});

describe('count', () => {
  it('counts matching items', () => {
    expect(count([1, 2, 3, 4, 5], (n) => n > 3)).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(count([], () => true)).toBe(0);
  });

  it('returns 0 when nothing matches', () => {
    expect(count([1, 2, 3], () => false)).toBe(0);
  });
});

describe('compact', () => {
  it('removes null and undefined', () => {
    expect(compact([1, null, 2, undefined, 3])).toEqual([1, 2, 3]);
  });

  it('keeps falsy non-null values', () => {
    expect(compact([0, '', false, null])).toEqual([0, '', false]);
  });

  it('returns empty array for all-null input', () => {
    expect(compact([null, undefined])).toEqual([]);
  });
});

describe('filterMap', () => {
  it('maps and filters nulls in one pass', () => {
    const result = filterMap([1, 2, 3, 4], (n) =>
      n % 2 === 0 ? n * 10 : null,
    );

    expect(result).toEqual([20, 40]);
  });

  it('returns empty array when all map to null', () => {
    expect(filterMap([1, 2], () => null)).toEqual([]);
  });

  it('keeps all when none are null', () => {
    expect(filterMap([1, 2], (n) => n + 1)).toEqual([2, 3]);
  });
});

describe('uniqueBy', () => {
  it('deduplicates by key projection, first wins', () => {
    const items = [
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 1, v: 'c' },
    ];

    expect(uniqueBy(items, (x) => x.id)).toEqual([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(uniqueBy([], () => 0)).toEqual([]);
  });

  it('handles string keys', () => {
    expect(uniqueBy(['a', 'b', 'a', 'c'], (x) => x)).toEqual(['a', 'b', 'c']);
  });
});

describe('mapValues', () => {
  it('transforms values preserving keys', () => {
    expect(mapValues({ a: 1, b: 2 }, (v) => v * 10)).toEqual({ a: 10, b: 20 });
  });

  it('passes key to transform function', () => {
    expect(mapValues({ x: 1, y: 2 }, (v, k) => `${k}:${v}`)).toEqual({
      x: 'x:1',
      y: 'y:2',
    });
  });

  it('returns empty object for empty input', () => {
    expect(mapValues({}, (v) => v)).toEqual({});
  });
});

describe('partition', () => {
  it('splits array into matches and rest', () => {
    const [evens, odds] = partition([1, 2, 3, 4, 5], (n) => n % 2 === 0);

    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3, 5]);
  });

  it('returns two empty arrays for empty input', () => {
    const [yes, no] = partition([], () => true);

    expect(yes).toEqual([]);
    expect(no).toEqual([]);
  });

  it('puts everything in first group when all match', () => {
    const [yes, no] = partition([1, 2, 3], () => true);

    expect(yes).toEqual([1, 2, 3]);
    expect(no).toEqual([]);
  });
});
