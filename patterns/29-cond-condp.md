# Cond/Condp

## Category

Type System & Data Flow

## Intent

The `cond` and `condp` family of functions replace imperative `if/else`
chains and simple `switch` statements with a declarative, expression-based
style inspired by Clojure. They return the first matching result from a
list of predicate/value pairs, making the mapping from conditions to
outcomes immediately visible.

## How It Works in Delta-V

The `src/shared/util.ts` module defines four related functions:

### `cond` -- predicate/value pairs

Evaluates pairs of `[boolean, T]` and returns the value of the first pair
whose predicate is `true`. Returns `undefined` if nothing matches.

```typescript
export const cond = <T>(...pairs: readonly [boolean, T][]): T | undefined =>
  pairs.find(([pred]) => pred)?.[1];
```

Usage: flat condition chains where each condition is independent.

### `condp` -- parameterized predicate

Like `cond`, but applies a predicate function `pred(test, expr)` to each
pair. Every clause compares the same `expr` against different `test` values.

```typescript
export const condp = <TExpr, TTest, TResult>(
  pred: (test: TTest, expr: TExpr) => boolean,
  expr: TExpr,
  ...pairs: readonly (readonly [TTest, TResult])[]
): TResult | undefined => {
  for (const [test, result] of pairs) {
    if (pred(test, expr)) return result;
  }
  return undefined;
};
```

### `condpOr` -- with fallback

Same as `condp` but returns a `fallback` value instead of `undefined`.

### `matchEq` / `matchEqOr` -- equality shorthand

Specialized `condp` where the predicate is strict equality (`===`).

```typescript
export const matchEq = <T, R>(
  expr: T,
  ...pairs: readonly (readonly [T, R])[]
): R | undefined => condp((a, b) => a === b, expr, ...pairs);

export const matchEqOr = <T, R>(
  expr: T,
  fallback: R,
  ...pairs: readonly (readonly [T, R])[]
): R => matchEq(expr, ...pairs) ?? fallback;
```

`matchEqOr` is the most commonly used variant in production code --
it provides a value-mapping expression with a guaranteed fallback.

## Key Locations

| Function | File | Lines |
|----------|------|-------|
| `cond` | `src/shared/util.ts:89-90` | Definition |
| `condp` | `src/shared/util.ts:103-113` | Definition |
| `condpOr` | `src/shared/util.ts:116-121` | Definition |
| `matchEq` | `src/shared/util.ts:124-127` | Definition |
| `matchEqOr` | `src/shared/util.ts:130-134` | Definition |

### Usage sites

| Site | File | Function Used |
|------|------|---------------|
| Hex flash color | `src/client/renderer/renderer.ts:487` | `cond` |
| Combat result color | `src/client/renderer/toast.ts:16` | `matchEqOr` |
| Movement damage text | `src/client/renderer/toast.ts:27` | `matchEqOr` |
| Movement damage color | `src/client/renderer/toast.ts:35` | `matchEqOr` |

## Code Examples

### `cond` for multi-condition color selection

```typescript
// src/client/renderer/renderer.ts
const color =
  cond(
    [ev.type === 'crash', '#ff4444'],
    [ev.type === 'nukeDetonation', '#ff6600'],
    [ev.damageType === 'eliminated', '#ff4444'],
  ) ?? '#ffaa00';
```

Each condition is evaluated in order. The first `true` wins. The `?? '#ffaa00'`
provides the fallback. Note how conditions can check different fields --
this is where `cond` is more flexible than `switch`.

### `matchEqOr` for value mapping

```typescript
// src/client/renderer/toast.ts
const getResultColor = (damageType: CombatResult['damageType']): string =>
  matchEqOr(
    damageType,
    '#88ff88',
    ['eliminated', '#ff4444'],
    ['disabled', '#ffaa00'],
  );
```

This reads as: "Match `damageType` -- if `'eliminated'` return red, if
`'disabled'` return orange, otherwise return green." The fallback is the
second argument.

### `matchEqOr` for damage text formatting

```typescript
// src/client/renderer/toast.ts
const getMovementDamageText = (
  event: MovementEvent,
  missLabel: string,
): string =>
  matchEqOr(
    event.damageType,
    missLabel,
    ['eliminated', 'ELIMINATED'],
    ['disabled', `DISABLED ${event.disabledTurns}T`],
  );
```

The template literal in the `'disabled'` case shows that result values
can be dynamically computed.

## Consistency Analysis

**Current usage is limited but consistent**: The `cond` / `matchEqOr`
functions are used exclusively in the rendering/UI layer for value-mapping
expressions. The engine layer uses `if/else` chains and `switch`
statements, which is appropriate given the complex validation logic.

**The hierarchy is well-designed**:
- `cond` -- heterogeneous conditions (different fields/expressions)
- `condp` -- homogeneous conditions with custom predicate
- `matchEq` / `matchEqOr` -- the most common case (equality matching)

**Test coverage**: The test file `src/shared/util.test.ts` thoroughly
tests all variants including edge cases (no pairs, no match, fallback
behavior).

## Completeness Check

### Places where `matchEqOr` could replace if/else chains

Several places in the codebase use if/else chains or ternary expressions
for simple value mapping that could be expressed more cleanly with
`matchEqOr`:

- **Damage result translation** in `lookupGunCombat` and
  `lookupOtherDamage` (`combat.ts`): the `if (value === 0) ... if
  (value === 6) ...` chains could use `matchEqOr`, though the current
  form is already clear.

- **Phase-specific UI text**: any place that maps a `Phase` value to
  display text could benefit from `matchEqOr`.

### `condp` is unused in production

The `condp` function (with custom predicate) is only exercised in tests.
Production code uses either `cond` (heterogeneous conditions) or `matchEq`
/ `matchEqOr` (equality). This is fine -- `condp` is the general-purpose
building block that `matchEq` specializes.

### Relationship to `switch`

The codebase uses `switch` for exhaustive dispatch over discriminated
unions (event projector, command router, protocol validator). It uses
`cond` / `matchEqOr` for non-exhaustive value mapping (colors, text).
This division is sensible: `switch` gets exhaustiveness checking from
TypeScript, while `cond` is more concise for simple mappings with
fallbacks.

### No `condOr` variant

There is `condpOr` (with fallback) but no equivalent `condOr` for the
basic `cond`. The `?? fallback` pattern at the call site serves the same
purpose and is arguably clearer.

## Related Patterns

- **Discriminated Unions** (pattern 23) -- `switch` statements handle
  exhaustive dispatch; `cond` handles non-exhaustive value mapping.
- **Data-Driven Lookup Tables** (pattern 28) -- lookup tables serve a
  similar purpose (mapping input to output) but for larger, more
  structured datasets.
- **Utility Type Patterns** (pattern 30) -- `cond` and `matchEq` are
  generic utility functions that leverage TypeScript's type inference.
