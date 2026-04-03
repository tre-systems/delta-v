# Deterministic RNG in Tests

## Category

Testing

## Intent

Make all random outcomes reproducible by injecting a deterministic pseudo-random number generator (PRNG) rather than using `Math.random()`. This enables snapshot-stable tests, property-based testing of combat outcomes, and bit-exact event-sourced replay.

## How It Works in Delta-V

Delta-V uses a custom `mulberry32` PRNG that produces a deterministic sequence of floats in `[0, 1)` given a 32-bit integer seed. The engine never calls `Math.random()` directly -- every function that needs randomness accepts a `rng: () => number` parameter.

The PRNG system has two layers:

1. **`mulberry32(seed)`** -- Creates a PRNG closure from a seed. Used directly in unit tests.

2. **`deriveActionRng(matchSeed, actionSeq)`** -- Derives a per-action PRNG from a match seed and the event sequence number using Knuth multiplicative hashing. Each game action gets its own fresh, deterministic stream so that replaying events N..M does not require replaying 1..N-1 first.

In tests, deterministic RNG is used in three ways:

- **Direct injection**: Tests pass `mulberry32(fixedSeed)` as the `rng` parameter to engine functions.
- **Property-based**: Combat property tests use `fc.double` to generate RNG values, then wrap them in a closure: `const rng = () => n;` or an alternating closure for multi-roll combat.
- **Snapshot pinning**: The PRNG test suite pins the first 5 values for seed 42 via `toMatchInlineSnapshot`, catching any accidental algorithm changes.

## Key Locations

- `src/shared/prng.ts` -- `mulberry32`, `deriveActionRng`
- `src/shared/prng.test.ts` -- determinism, distribution, and snapshot tests
- `src/shared/combat.property.test.ts` (lines 583-633) -- `fc.double` as RNG source
- `src/server/game-do/game-do.ts` (line 5) -- `deriveActionRng` import for production use
- `src/server/game-do/actions.ts` -- `getActionRng` dependency injection

## Code Examples

The PRNG implementation:

```typescript
// mulberry32 -- fast 32-bit PRNG with full 2^32 period.
export const mulberry32 = (seed: number): (() => number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
};

// Per-action RNG derivation for event sourcing.
const KNUTH = 0x9e3779b9;
export const deriveActionRng = (
  matchSeed: number,
  actionSeq: number,
): (() => number) => mulberry32((matchSeed ^ Math.imul(actionSeq, KNUTH)) | 0);
```

Property test injecting controlled RNG:

```typescript
it('always returns 1-6', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
      (n) => {
        const rng = () => n;
        const result = rollD6(rng);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(6);
      },
    ),
  );
});
```

Snapshot pinning to catch algorithm changes:

```typescript
it('snapshot: first 5 values for seed 42', () => {
  const rng = mulberry32(42);
  const values = Array.from({ length: 5 }, () => rng());
  expect(values).toMatchInlineSnapshot(`
    [
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
    ]
  `);
});
```

## Consistency Analysis

Deterministic RNG injection is applied consistently throughout the engine. Every function that involves randomness (combat resolution, asteroid hazard rolls, movement RNG) takes `rng: () => number` as a parameter. No function calls `Math.random()`.

The `deriveActionRng` pattern is used in production (`game-do.ts`) and the same PRNG is used in tests, ensuring test coverage of the actual random path. The `mulberry32` implementation is tested for determinism, range, distribution uniformity, and sequence stability.

## Completeness Check

- **Coverage**: All random engine paths are injectable. The PRNG tests cover determinism, value range, distribution, collision rate, and cross-seed divergence.
- **Missing: seed management tests**: There are no tests verifying that `matchSeed` is correctly persisted and restored across DO hibernation. This is implicitly covered by archive tests but could be more explicit.
- **Missing: statistical tests**: The distribution test checks the mean is near 0.5 but does not run a chi-squared or Kolmogorov-Smirnov test. For a game PRNG this is adequate, but a more rigorous statistical test would strengthen confidence.

## Related Patterns

- **52 -- Property-Based Testing**: Property tests use `fc.double` to explore the RNG input space exhaustively.
- **55 -- Mock Storage**: Both patterns are forms of dependency injection for testability.
- **48 -- Single State-Bearing Message**: Deterministic RNG enables bit-exact replay, which is what makes the event-sourced state recovery work.
