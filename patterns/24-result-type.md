# Result<T, E>

## Category

Type System & Data Flow

## Intent

The `Result<T, E>` type replaces exception-based error handling with an
explicit, type-safe return value. Callers cannot accidentally ignore errors
because the compiler forces them to check `ok` before accessing `value` or
`error`. This eliminates unhandled exceptions, makes error paths visible in
function signatures, and composes well with functional control flow.

## How It Works in Delta-V

`Result` is defined as a discriminated union on the `ok` boolean:

```typescript
// src/shared/types/domain.ts
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

The default error type is `string`, keeping the common case lightweight.
Callers that need richer errors can parameterize `E` (e.g.,
`Result<JoinAttemptSuccess, Response>` on the server).

Results are constructed inline rather than through helper functions --
there is no `Ok()` / `Err()` wrapper. This keeps the pattern zero-cost
and immediately readable:

```typescript
return { ok: true, value: state };
return { ok: false, error: 'empty event stream' };
```

Consumers check `ok` and then access the narrowed variant:

```typescript
const projected = projectEvent(state, envelope, map);
if (!projected.ok) {
  return projected;   // propagate the error
}
state = projected.value;
```

## Key Locations

| Usage | File | Lines |
|-------|------|-------|
| Definition | `src/shared/types/domain.ts` | 6-8 |
| Protocol validation (C2S) | `src/shared/protocol.ts` | 358 |
| Protocol validation (S2C) | `src/shared/protocol.ts` | 478 |
| Event projector | `src/shared/engine/event-projector/index.ts` | 13, 69 |
| Event projector (ship) | `src/shared/engine/event-projector/ships.ts` | 11 |
| Event projector (lifecycle) | `src/shared/engine/event-projector/lifecycle.ts` | 19 |
| Event projector (conflict) | `src/shared/engine/event-projector/conflict.ts` | 14 |
| Event projector (support) | `src/shared/engine/event-projector/support.ts` | 80, 88, 99 |
| Server protocol parsing | `src/server/protocol.ts` | 79 |
| Server join handler | `src/server/game-do/http-handlers.ts` | 41 |
| Client session API | `src/client/game/session-api.ts` | 123 |
| Server socket parsing | `src/server/game-do/socket.ts` | 47 |

## Code Examples

### Protocol validation returning Result

```typescript
// src/shared/protocol.ts
export const validateClientMessage = (raw: unknown): Result<C2S> => {
  const ok = (value: C2S) => ({ ok: true as const, value });
  const invalid = (error: string) => ({ ok: false as const, error });

  if (!isObject(raw) || !isString(raw.type)) {
    return invalid('Invalid message payload');
  }

  // ... switch on message.type, returning ok() or invalid()
};
```

The local `ok()` and `invalid()` helpers are scoped within the function
to reduce boilerplate. They use `as const` to narrow the boolean
discriminant.

### Event projector consuming Result

```typescript
// src/shared/engine/event-projector/index.ts
export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    const projected = projectEvent(state, envelope, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.value;
  }

  return state === null
    ? { ok: false, error: 'empty event stream' }
    : { ok: true, value: state };
};
```

### Server-side with custom error type

```typescript
// src/server/game-do/http-handlers.ts (signature)
export const handleJoinAttempt = (
  ...
): Promise<Result<JoinAttemptSuccess, Response>> => { ... };
```

Here `E = Response` lets the handler return an HTTP Response object
directly as the error, avoiding a separate error-to-response mapping step.

## Consistency Analysis

**Consistently applied in**:

- All protocol validation (both client and server message parsing)
- The entire event projector pipeline (project, support, conflict, ships,
  lifecycle modules)
- Server join/session management

**Not used in the engine layer**: Engine functions (`processAstrogation`,
`processCombat`, etc.) use a different error convention --
`{ state } | { error: EngineError }` (see pattern 25). This is a
deliberate design choice: engine functions always return mutated state on
success, making the `{ state }` / `{ error }` split more natural than
wrapping state in `Result.value`.

**Consistency of construction**: Most code constructs `Result` values
inline. The protocol validator defines local `ok()` / `invalid()` helpers,
but these are not shared. A shared constructor could reduce repetition
but the current approach works fine given the small number of call sites.

## Completeness Check

- **Missing `Result` usage**: Several server-side functions still throw
  errors (e.g., `transitionPhase` in `engine/util.ts` throws on invalid
  phase transitions). These are intentional panics (development-only
  invariant violations) rather than recoverable errors, so `Result` is
  not appropriate there.

- **No shared constructors**: Unlike some codebases that provide `Ok(v)`
  and `Err(e)` helpers, Delta-V constructs results inline. This is fine
  but means each call site must remember `as const` for correct narrowing.
  The protocol validator's local helpers show the way -- promoting them
  to shared utilities could reduce boilerplate.

- **Error type discipline**: Most `Result` usages default to `E = string`.
  The server join handler uses `Result<T, Response>`, which is creative
  but couples error handling to HTTP semantics. Consider whether a
  dedicated error type would be more maintainable.

- **No `map` / `flatMap` combinators**: The codebase does not define
  functional combinators over `Result`. The pipeline style used in the
  event projector (`if (!r.ok) return r`) works well enough, but a
  `flatMap` could make chains more concise.

## Related Patterns

- **Discriminated Unions** (pattern 23) -- `Result` is itself a
  discriminated union on `ok`.
- **Engine-Style Error Return** (pattern 25) -- the engine layer's
  alternative to `Result` for functions that return state.
- **Guard Clause / Validation** (pattern 26) -- validation functions
  often return `Result` or `EngineError | null`.
