# Engine-Style Error Return

## Category

Type System & Data Flow

## Intent

Engine functions need to return both a new game state (on success) and a
structured error (on failure). Rather than using exceptions or the generic
`Result<T, E>` type, the engine layer uses a structural discriminated union
pattern: success returns `{ state: GameState, ... }` and failure returns
`{ error: EngineError }`. TypeScript narrows between the two by checking
for the presence of the `error` property (`'error' in result`).

This approach is tailored to the engine's needs: success results carry
varying additional fields (movements, combat results, engine events)
alongside the state, while failure is always a simple `{ error }` object.

## How It Works in Delta-V

### The EngineError type

```typescript
// src/shared/types/domain.ts
export enum ErrorCode {
  INVALID_PHASE = 'INVALID_PHASE',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  INVALID_PLAYER = 'INVALID_PLAYER',
  INVALID_SHIP = 'INVALID_SHIP',
  INVALID_TARGET = 'INVALID_TARGET',
  INVALID_SELECTION = 'INVALID_SELECTION',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_ALLOWED = 'NOT_ALLOWED',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  STATE_CONFLICT = 'STATE_CONFLICT',
}

export interface EngineError {
  code: ErrorCode;
  message: string;
}
```

### The return type convention

Every public engine function returns a union of its success type with
`{ error: EngineError }`:

```typescript
// Success type varies per function
processAstrogation(...): MovementResult | StateUpdateResult | { error: EngineError }
processCombat(...): CombatPhaseResult | { error: EngineError }
processFleetReady(...): StateUpdateResult | { error: EngineError }
processLogistics(...): { state: GameState; engineEvents: EngineEvent[] } | { error: EngineError }
```

### The `engineFailure` helper

A convenience constructor avoids repeating the `{ error: { code, message } }`
nesting:

```typescript
// src/shared/engine/util.ts
export const engineError = (code: ErrorCode, message: string): EngineError => ({
  code,
  message,
});

export const engineFailure = (code: ErrorCode, message: string) => ({
  error: engineError(code, message),
});
```

### Consumer-side narrowing

Callers discriminate with `'error' in result`:

```typescript
const result = processAstrogation(state, playerId, orders, map, rng);
if ('error' in result) {
  // result is { error: EngineError }
  return sendError(result.error);
}
// result is MovementResult | StateUpdateResult
```

## Key Locations

| Function | File | Return Type |
|----------|------|-------------|
| `processAstrogation` | `src/shared/engine/astrogation.ts:123-177` | `MovementResult \| StateUpdateResult \| { error }` |
| `processOrdnance` | `src/shared/engine/astrogation.ts:180-319` | `MovementResult \| { error }` |
| `skipOrdnance` | `src/shared/engine/astrogation.ts:323-336` | `MovementResult \| StateUpdateResult \| { error }` |
| `processCombat` | `src/shared/engine/combat.ts:311-605` | `CombatPhaseResult \| { error }` |
| `processSingleCombat` | `src/shared/engine/combat.ts:609-727` | `CombatPhaseResult \| { error }` |
| `beginCombatPhase` | `src/shared/engine/combat.ts:263-308` | `CombatPhaseResult \| StateUpdateResult \| { error }` |
| `endCombat` | `src/shared/engine/combat.ts:731-771` | `{ state; results?; engineEvents } \| { error }` |
| `skipCombat` | `src/shared/engine/combat.ts:774-826` | `{ state; results?; engineEvents } \| { error }` |
| `processFleetReady` | `src/shared/engine/fleet-building.ts:20-204` | `StateUpdateResult \| { error }` |
| `processLogistics` | `src/shared/engine/logistics.ts:255-338` | `{ state; engineEvents } \| { error }` |
| `skipLogistics` | `src/shared/engine/logistics.ts:340-366` | `{ state; engineEvents } \| { error }` |
| `processSurrender` | `src/shared/engine/logistics.ts:369-448` | `{ state; engineEvents } \| { error }` |
| `processEmplacement` | `src/shared/engine/ordnance.ts:75-181` | `{ state; engineEvents } \| { error }` |
| Helpers | `src/shared/engine/util.ts:92-99` | `engineError`, `engineFailure` |

## Code Examples

### Engine function with early error returns

```typescript
// src/shared/engine/fleet-building.ts
export const processFleetReady = (
  inputState: GameState,
  playerId: PlayerId,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
):
  | StateUpdateResult
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  if (state.phase !== 'fleetBuilding') {
    return engineFailure(
      ErrorCode.INVALID_PHASE,
      'Not in fleet building phase',
    );
  }

  // ... validation continues with more engineFailure returns ...

  return { state, engineEvents };
};
```

### Inline error object construction (without helper)

Some code constructs the error object directly:

```typescript
// src/shared/engine/combat.ts
if (attackSeen.has(id)) {
  return {
    error: {
      code: ErrorCode.INVALID_INPUT,
      message: 'Each ship may appear at most once in an attack declaration',
    },
  };
}
```

### The reduce-based error accumulation pattern

```typescript
// src/shared/engine/fleet-building.ts
const totalCostOrError = purchases.reduce<
  { cost: number } | { error: EngineError }
>(
  (acc, purchase) => {
    if ('error' in acc) return acc;
    // ... validate each purchase, return engineFailure on error
    return { cost: acc.cost + stats.cost };
  },
  { cost: 0 },
);

if ('error' in totalCostOrError) {
  return totalCostOrError;
}
```

## Consistency Analysis

**Consistently applied**: Every public engine function follows this
convention. The pattern is remarkably uniform across astrogation, combat,
fleet building, logistics, ordnance, and surrender processing.

**Two construction styles**: Some functions use the `engineFailure()`
helper while others construct `{ error: { code, message } }` inline.
The `processCombat` function in `combat.ts` mixes both styles within the
same function. This is a minor inconsistency -- the helper should be
preferred everywhere.

**The `validatePhaseAction` return convention**: The shared
`validatePhaseAction` function returns `EngineError | null` rather than
using the `{ error }` wrapper. Every caller then wraps it:

```typescript
const phaseError = validatePhaseAction(state, playerId, 'combat');
if (phaseError) return { error: phaseError };
```

This two-step pattern is repeated in every engine entry point. A
`validatePhaseOrFail` variant returning `{ error } | null` could
eliminate the wrapping.

## Completeness Check

- **Consistent `engineFailure` usage**: The inline `{ error: { code, message } }`
  construction in `combat.ts` should be migrated to use `engineFailure()`
  for consistency. About 10 occurrences in `processCombat` use the inline
  form.

- **Missing error codes**: The `ErrorCode` enum covers the main categories
  well. No functions return ad-hoc error strings outside of `EngineError`.

- **`validatePhaseAction` wrapping boilerplate**: Every engine entry point
  repeats the same 2-line phase validation pattern. A combined helper
  that returns `{ error: EngineError } | null` would reduce repetition.

- **Type narrowing reliability**: The `'error' in result` check works
  because no success result type has an `error` field. This is an implicit
  invariant -- adding an `error` field to any success type would break
  narrowing. Consider a more explicit discriminant if the types grow.

## Related Patterns

- **Result<T, E>** (pattern 24) -- the event projector and protocol
  validators use `Result` instead of this pattern. The two approaches
  serve different layers.
- **Guard Clause / Validation** (pattern 26) -- validation functions
  return `EngineError | null`, which feeds into the engine error return.
- **Discriminated Unions** (pattern 23) -- the error return is a
  structural discriminated union (discriminated by property presence
  rather than a literal field).
