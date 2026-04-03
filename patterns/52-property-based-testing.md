# Property-Based Testing

## Category

Testing

## Intent

Verify invariants that must hold for all valid inputs rather than just specific examples. Property-based testing with `fast-check` generates hundreds of random inputs and checks that mathematical properties, roundtrip conversions, and domain invariants are never violated. This catches edge cases that hand-written examples miss.

## How It Works in Delta-V

Delta-V uses the `fast-check` library (`fc`) with Vitest. Property-based test files use the `*.property.test.ts` suffix and are co-located with their production modules. Three modules have property-based test suites:

1. **Hex grid** (`hex.property.test.ts`) -- Tests algebraic properties of hex arithmetic: addition/subtraction identity, key serialisation roundtrip, distance metric axioms (non-negativity, symmetry, triangle inequality), line drawing invariants, ring size formula, and pixel conversion roundtrips.

2. **Combat** (`combat.property.test.ts`) -- Tests that odds computation is monotonic, damage results are monotonically severe with higher rolls, combat strength is additive for healthy ships, and that destroyed/disabled/landed/surrendered/captured ships cannot attack.

3. **Movement** (`movement.property.test.ts`) -- Tests that fuel spent is never negative, course computation produces connected paths, and drift (null burn) preserves velocity.

Each suite defines **custom arbitraries** that constrain generated values to the game's domain. For example, hex coordinates are bounded to `[-50, 50]` to avoid overflow, and ship types are drawn from the actual `SHIP_STATS` keys.

## Key Locations

- `src/shared/hex.property.test.ts` -- 11 properties across 7 describe blocks
- `src/shared/combat.property.test.ts` -- 20+ properties across 7 describe blocks
- `src/shared/movement.property.test.ts` -- movement invariant properties
- `src/client/reactive.test.ts` -- also uses `fast-check` for signal glitch-freedom

## Code Examples

Custom arbitraries scoped to the domain:

```typescript
const arbCoord = (): fc.Arbitrary<HexCoord> =>
  fc.record({
    q: fc.integer({ min: -50, max: 50 }),
    r: fc.integer({ min: -50, max: 50 }),
  });

const arbShipType = () =>
  fc.constantFrom(...(Object.keys(SHIP_STATS) as ShipType[]));

const arbOddsRatio = (): fc.Arbitrary<OddsRatio> =>
  fc.constantFrom('1:4', '1:2', '1:1', '2:1', '3:1', '4:1');
```

Mathematical properties as tests:

```typescript
it('distance is symmetric', () => {
  fc.assert(
    fc.property(arbCoord(), arbCoord(), (a, b) => {
      expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    }),
  );
});

it('triangle inequality holds', () => {
  fc.assert(
    fc.property(arbCoord(), arbCoord(), arbCoord(), (a, b, c) => {
      expect(hexDistance(a, c)).toBeLessThanOrEqual(
        hexDistance(a, b) + hexDistance(b, c),
      );
    }),
  );
});

it('higher attack strength never produces worse odds', () => {
  const oddsOrder = ['1:4', '1:2', '1:1', '2:1', '3:1', '4:1'];
  fc.assert(
    fc.property(
      arbPositiveInt(), arbPositiveInt(), arbPositiveInt(),
      (a, bonus, defend) => {
        const oddsLow = computeOdds(a, defend);
        const oddsHigh = computeOdds(a + bonus, defend);
        expect(oddsOrder.indexOf(oddsHigh)).toBeGreaterThanOrEqual(
          oddsOrder.indexOf(oddsLow),
        );
      },
    ),
  );
});
```

## Consistency Analysis

Property-based testing is consistently applied to the core mathematical modules (hex, combat, movement) where invariants are well-defined. The pattern of defining per-domain arbitraries and asserting mathematical properties is uniform across all three suites.

The `fc.assert(fc.property(...))` pattern is used throughout (no raw `fc.check` calls). Default run counts are used except in `resolveCombat` properties where `{ numRuns: 50 }` is specified to keep integration-heavy properties fast.

The reactive layer also uses `fast-check` in its test suite, extending the pattern beyond the shared engine into the client layer.

## Completeness Check

- **Missing property suites**: The ordnance/logistics engine functions do not have property tests. Ordnance launch validity and logistics transfer constraints would benefit from invariant checking.
- **Shrinking**: fast-check's automatic shrinking is used implicitly (no custom shrinkers). This works well for the simple domain types but could produce confusing minimal examples for complex game states.
- **Snapshot pinning**: The PRNG test suite pins first-5-values via `toMatchInlineSnapshot`, which is an example-based complement to property-based distribution tests.

## Related Patterns

- **51 -- Co-Located Tests**: Property tests use `*.property.test.ts` suffix, co-located with their module.
- **56 -- Deterministic RNG in Tests**: Combat property tests inject `fc.double` values as RNG sources.
- **53 -- Data-Driven Tests**: Property tests and data-driven tests both aim to cover input space broadly but use different mechanisms (generation vs. enumeration).
