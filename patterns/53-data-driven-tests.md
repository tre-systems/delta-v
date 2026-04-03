# Data-Driven Tests

## Category

Testing

## Intent

Reduce test boilerplate when the same assertion logic applies to multiple input cases. Using `it.each` or `describe.each`, each case is a row in a table, keeping the test body DRY while producing distinct test names in the output.

## How It Works in Delta-V

Vitest's `it.each` (and occasionally `describe.each`) is used to parameterise tests where a single assertion shape covers multiple inputs. The most prominent use is in protocol validation tests, where multiple simple message types share the same acceptance logic.

The pattern appears in two main forms:

1. **Simple value arrays** -- `it.each(['skipOrdnance', 'beginCombat', 'skipCombat', 'rematch'] as const)` iterates over values that are interpolated into both the test name and the assertion.

2. **Fixture-driven iteration** -- Protocol tests load `__fixtures__/contracts.json` and iterate over its entries, comparing `validateClientMessage(raw)` against `expected`.

Both forms produce descriptive test names in the output (e.g., `accepts skipOrdnance`, `accepts beginCombat`), making failures easy to diagnose.

## Key Locations

- `src/shared/protocol.test.ts` (lines 90-101) -- `it.each` for simple C2S message types
- `src/shared/protocol.test.ts` -- fixture-driven contract tests
- `src/client/game/transport.test.ts` -- `it.each` / `describe.each` for transport scenarios

## Code Examples

Simple value-array `it.each`:

```typescript
describe('simple message types', () => {
  it.each([
    'skipOrdnance',
    'beginCombat',
    'skipCombat',
    'rematch',
  ] as const)('accepts %s', (type) => {
    expect(validateClientMessage({ type })).toEqual({
      ok: true,
      value: { type },
    });
  });
});
```

Fixture-driven test (loads JSON, iterates cases):

```typescript
const sharedContractFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/contracts.json', import.meta.url),
    'utf8',
  ),
) as { c2s: Record<string, { raw: unknown; expected: unknown }> };

// Each entry in contracts.json becomes a test case
```

## Consistency Analysis

Data-driven tests are used where the pattern clearly fits -- protocol validation of uniform message shapes and transport scenario variants. The codebase does not overuse `it.each`; most test suites stick to individual `it` blocks when each case has distinct assertion logic.

The `as const` on the array ensures TypeScript narrows the element type, which matters for protocol tests where the type field must be a literal member of the `C2S` union.

## Completeness Check

- **Table format**: The codebase uses the simpler array form of `it.each` rather than the tagged-template table format. This is fine for small lists but the table format would improve readability for cases with multiple columns.
- **Error case tables**: Data-driven tests are mainly used for valid inputs. Invalid-input rejection tests are written as individual `it` blocks. Consolidating them into `it.each` with `[input, expectedError]` tuples could reduce duplication.
- **describe.each**: Used sparingly. This is appropriate -- `describe.each` is best for scenarios where the parameterised value changes the entire test group context, not just one assertion.

## Related Patterns

- **54 -- Contract Fixtures**: `__fixtures__/contracts.json` provides the data that drives fixture-based `it.each` tests.
- **52 -- Property-Based Testing**: Both patterns cover broad input spaces. Data-driven tests use explicit enumerations; property tests use random generation.
- **47 -- Discriminated Union Messages**: The data-driven protocol tests exercise the discriminated union validator across all message types.
