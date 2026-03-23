// Small utility helpers: functional collection transforms
// and general-purpose functions.
//
// These replace common imperative patterns
// (reduce-to-sum, loop-to-find-min, build-a-lookup-map)
// with intent-revealing one-liners. No external deps.

// --- General-purpose ---

// Clamp a number to [min, max].
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// Pick a random element from a non-empty array.
export const randomChoice = <T>(arr: readonly T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length)];

// --- Collection transforms ---

// Sum an array by a numeric projection.
export const sumBy = <T>(arr: readonly T[], fn: (item: T) => number): number =>
  arr.reduce((sum, item) => sum + fn(item), 0);

// Return the element with the smallest projected value.
export const minBy = <T>(
  arr: readonly T[],
  fn: (item: T) => number,
): T | undefined =>
  arr.reduce<T | undefined>(
    (best, item) => (best === undefined || fn(item) < fn(best) ? item : best),
    undefined,
  );

// Return the element with the largest projected value.
export const maxBy = <T>(
  arr: readonly T[],
  fn: (item: T) => number,
): T | undefined =>
  arr.reduce<T | undefined>(
    (best, item) => (best === undefined || fn(item) > fn(best) ? item : best),
    undefined,
  );

// Index an array into a Record keyed by a string
// projection. Last writer wins on collisions.
export const indexBy = <T>(
  arr: readonly T[],
  fn: (item: T) => string,
): Record<string, T> => Object.fromEntries(arr.map((item) => [fn(item), item]));

// Group an array into a Record of arrays keyed by
// a string projection.
export const groupBy = <T>(
  arr: readonly T[],
  fn: (item: T) => string,
): Record<string, T[]> =>
  arr.reduce<Record<string, T[]>>((acc, item) => {
    const key = fn(item);

    if (!acc[key]) acc[key] = [];
    acc[key].push(item);

    return acc;
  }, {});

// Filter an object's entries by a predicate on value
// (and optionally key).
export const pickBy = <V>(
  obj: Readonly<Record<string, V>>,
  fn: (value: V, key: string) => boolean,
): Record<string, V> =>
  Object.fromEntries(Object.entries(obj).filter(([k, v]) => fn(v, k)));

// Clojure-style cond: evaluate predicate/result pairs
// and return the first match. Falls through to undefined
// if no predicate matches.
//
//   cond(
//     [ship.lifecycle === 'destroyed', 'skip'],
//     [ship.lifecycle === 'landed' && !isNuke, 'immune'],
//     [distance <= range, 'in-range'],
//   ) ?? 'out-of-range'
export const cond = <T>(...pairs: readonly [boolean, T][]): T | undefined =>
  pairs.find(([pred]) => pred)?.[1];

// Count items matching a predicate, without allocating
// an intermediate array.
export const count = <T>(arr: readonly T[], fn: (item: T) => boolean): number =>
  arr.reduce((n, item) => (fn(item) ? n + 1 : n), 0);

// Filter out null and undefined values, narrowing
// the type.
export const compact = <T>(arr: readonly (T | null | undefined)[]): T[] =>
  arr.filter((x): x is T => x != null);

// Map and filter in one pass. The projection returns
// T | null | undefined; nullish results are dropped.
//
//   filterMap(ships, s =>
//     s.lifecycle === 'destroyed' ? null : s.position
//   )
export const filterMap = <T, U>(
  arr: readonly T[],
  fn: (item: T) => U | null | undefined,
): U[] =>
  arr.reduce<U[]>((acc, item) => {
    const result = fn(item);

    if (result != null) acc.push(result);

    return acc;
  }, []);

// Deduplicate an array by a key projection.
// First occurrence wins.
export const uniqueBy = <T>(
  arr: readonly T[],
  fn: (item: T) => string | number,
): T[] => {
  const seen = new Set<string | number>();

  return arr.filter((item) => {
    const key = fn(item);

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
};

// Transform every value in a record, preserving keys.
export const mapValues = <V, U>(
  obj: Readonly<Record<string, V>>,
  fn: (value: V, key: string) => U,
): Record<string, U> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]));

// Split an array into two groups: items that match
// the predicate and items that don't.
// Returns [matches, rest].
export const partition = <T>(
  arr: readonly T[],
  fn: (item: T) => boolean,
): [T[], T[]] =>
  arr.reduce<[T[], T[]]>(
    ([yes, no], item) => {
      (fn(item) ? yes : no).push(item);

      return [yes, no];
    },
    [[], []],
  );
