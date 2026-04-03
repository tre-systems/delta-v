# Error Code Enum

## Category

Validation & Error Handling

## Intent

Categorise engine errors into a fixed set of machine-readable codes so that the server can distinguish between client bugs, player mistakes, and state conflicts -- and so that clients can handle errors programmatically rather than parsing human-readable strings.

## How It Works in Delta-V

The `ErrorCode` enum in `src/shared/types/domain.ts` defines all possible engine error categories:

```typescript
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
```

The codes are string-valued (not numeric), making them readable in logs and JSON payloads.

Engine functions return errors as `EngineError` objects pairing a code with a message:

```typescript
export interface EngineError {
  code: ErrorCode;
  message: string;
}
```

The S2C `error` message type carries an optional `ErrorCode`:

```typescript
| { type: 'error'; message: string; code?: ErrorCode }
```

The `code` is optional because some errors (like internal server errors or rate limit violations) originate outside the engine and may not map to an `ErrorCode`.

## Key Locations

- `src/shared/types/domain.ts` (lines 61-72) -- `ErrorCode` enum definition
- `src/shared/types/domain.ts` (lines 74-77) -- `EngineError` interface
- `src/shared/types/protocol.ts` (line 99) -- S2C `error` variant
- `src/shared/engine/astrogation.ts` -- heavy use of all error codes
- `src/shared/engine/fleet-building.ts` -- fleet validation errors
- `src/shared/engine/logistics.ts` -- logistics transfer errors
- `src/server/game-do/ws.ts` (lines 42-46, 117-120) -- server-level error codes

## Code Examples

Engine function returning typed errors:

```typescript
// Phase check
if (gameState.phase !== 'fleetBuilding') {
  return engineFailure(ErrorCode.INVALID_PHASE, 'Not in fleet building phase');
}

// Resource check
if (totalCost > credits) {
  return engineFailure(ErrorCode.RESOURCE_LIMIT, 'Insufficient credits');
}

// Ownership check
if (ship.owner !== playerId) {
  return engineFailure(ErrorCode.INVALID_SHIP, 'Ship not owned by player');
}
```

Server-level error without engine code:

```typescript
deps.send(ws, {
  type: 'error',
  message: 'Internal server error',
  code: ErrorCode.STATE_CONFLICT,
});
```

Transport-level error with engine code:

```typescript
const sendInvalidSocketMessageError = (deps, ws, message: string): void => {
  deps.send(ws, {
    type: 'error',
    message,
    code: ErrorCode.INVALID_INPUT,
  });
};
```

## Consistency Analysis

The `ErrorCode` enum is used consistently across all engine modules. Each error code maps to a clear semantic category:

- `INVALID_PHASE` / `NOT_YOUR_TURN` -- timing/turn errors
- `INVALID_SHIP` / `INVALID_TARGET` / `INVALID_SELECTION` -- reference errors
- `INVALID_INPUT` -- malformed or out-of-range data
- `NOT_ALLOWED` -- action forbidden by scenario rules
- `RESOURCE_LIMIT` -- insufficient fuel, credits, cargo space
- `STATE_CONFLICT` -- game state inconsistency

The server-level error path (`ws.ts`) uses `INVALID_INPUT` for malformed messages and `STATE_CONFLICT` for caught exceptions, which is a reasonable mapping.

## Completeness Check

- **Missing: rate limit code**: Rate limit errors close the socket with code 1008 rather than sending an S2C error message. A dedicated `RATE_LIMITED` error code could be useful for client-side handling.
- **Missing: client-side handling**: The client currently displays error messages as strings. It could use the `code` field to show localised or context-specific error messages.
- **String enum**: Using string values (not numbers) is the right choice for debuggability and JSON compatibility. The TypeScript enum compiles to a plain object, keeping the bundle small.

## Related Patterns

- **58 -- Multi-Stage Validation**: Error codes are produced by Stage 3 (engine validation) and optionally by Stage 1 (transport validation).
- **47 -- Discriminated Union Messages**: The S2C `error` variant carries the optional `code` field.
- **60 -- Rate Limiting**: Rate limit violations bypass the error code system, closing the socket directly.
