# Co-Located Tests

## Category

Testing

## Intent

Place test files immediately beside the source files they exercise, using a `*.test.ts` naming convention. This removes the cognitive overhead of navigating between a `src/` tree and a parallel `tests/` tree, makes it trivial to spot untested modules, and ensures that moving or renaming a module automatically moves its tests.

## How It Works in Delta-V

Every test file lives in the same directory as its production module and follows the naming pattern `<module>.test.ts` (or `<module>.property.test.ts` for property-based tests). Vitest discovers them via the glob `src/**/*.test.ts` configured in `vitest.config.ts`.

Examples of the co-location:

```
src/shared/
  hex.ts
  hex.test.ts
  hex.property.test.ts
  combat.ts
  combat.test.ts
  combat.property.test.ts
  prng.ts
  prng.test.ts
  protocol.ts
  protocol.test.ts
src/server/game-do/
  session.ts
  session.test.ts
  archive.ts
  archive.test.ts
  ws.ts
  ws.test.ts
src/client/
  reactive.ts
  reactive.test.ts
  renderer/camera.ts
  renderer/camera.test.ts
```

The `e2e/` directory is excluded from the main test glob so that end-to-end tests can have a different runner configuration without polluting unit test runs.

## Key Locations

- `vitest.config.ts` (line 4) -- `include: ['src/**/*.test.ts']`
- `src/shared/` -- shared engine tests
- `src/server/game-do/` -- server DO tests
- `src/client/` -- client tests

## Code Examples

Vitest configuration:

```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**'],
    // ...
  },
});
```

A co-located test importing its sibling module:

```typescript
// src/shared/prng.test.ts
import { describe, expect, it } from 'vitest';
import { deriveActionRng, mulberry32 } from './prng';

describe('mulberry32', () => {
  it('produces deterministic output for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const valuesA = Array.from({ length: 100 }, () => a());
    const valuesB = Array.from({ length: 100 }, () => b());
    expect(valuesA).toEqual(valuesB);
  });
});
```

## Consistency Analysis

Co-location is applied consistently. Every `*.test.ts` file in the repository sits next to its production module. There are no test files in a separate `test/` or `__tests__/` directory (the `__fixtures__/` directories contain data files, not test files).

Property-based tests use a distinct suffix (`*.property.test.ts`) but are still co-located. This makes it easy to distinguish example-based from property-based tests in file listings while keeping both next to the code they test.

## Completeness Check

- **Coverage gaps**: Not every module has a co-located test file. Renderer modules and some UI modules may lack tests (the coverage threshold pattern helps track this). Co-location makes the gap visible -- you can scan a directory and see which `.ts` files lack a `.test.ts` sibling.
- **Integration tests**: Some test files (like `archive.test.ts`) are more integration-level, testing multiple modules together. They are still co-located with their primary module, which is a pragmatic choice.
- **No test barrel files**: There are no `index.test.ts` barrel files, which is correct -- tests should target specific modules, not re-export hierarchies.

## Related Patterns

- **52 -- Property-Based Testing**: Property tests use the `*.property.test.ts` suffix and are co-located.
- **57 -- Coverage Thresholds**: Thresholds target `src/shared/**/*.ts`, aligning with where co-located tests live.
- **54 -- Contract Fixtures**: `__fixtures__/` directories sit inside the module tree, near the tests that use them.
