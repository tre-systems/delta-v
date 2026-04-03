# Multi-Stage Validation

## Category

Validation & Error Handling

## Intent

Validate untrusted client input through multiple defensive layers, each catching a different class of error, so that invalid data is rejected as early as possible and engine code can trust its inputs.

## How It Works in Delta-V

Client messages pass through three validation stages before reaching the game engine:

### Stage 1: Transport-level parsing (`socket.ts`)

Raw WebSocket text is JSON-parsed. If parsing fails, a `Result` error is returned immediately.

```
WebSocket string -> JSON.parse -> unknown
```

### Stage 2: Protocol-level validation (`protocol.ts`)

The parsed `unknown` is validated by `validateClientMessage()`, which checks:
- The payload is a non-null object with a string `type` field
- The `type` is a known C2S message type (switch/case)
- Each variant's fields are present and correctly typed
- Arrays are within size limits (`MAX_FLEET_PURCHASES = 64`, etc.)
- Numeric fields are integers within valid ranges
- String fields are non-empty

This stage returns `Result<C2S>` -- either a fully typed union member or an error string.

### Stage 3: Engine-level validation (engine modules)

After protocol validation passes, the message reaches the game engine via `dispatchGameStateAction`. The engine functions perform domain validation:
- **Phase checks**: Is it the right phase for this action? (`ErrorCode.INVALID_PHASE`)
- **Turn checks**: Is it this player's turn? (`ErrorCode.NOT_YOUR_TURN`)
- **Ownership checks**: Does the player own the referenced ships? (`ErrorCode.INVALID_SHIP`)
- **Resource checks**: Does the player have enough fuel/credits? (`ErrorCode.RESOURCE_LIMIT`)
- **State checks**: Is the game in a consistent state for this action? (`ErrorCode.STATE_CONFLICT`)

Engine functions return `StatefulActionSuccess | EngineFailure`, where `EngineFailure = { error: EngineError }` carries an `ErrorCode` and human-readable message.

The `runGameStateAction` runner in `actions.ts` catches thrown exceptions from the engine (unexpected bugs) and returns them as error responses, preventing the game state from being corrupted.

## Key Locations

- `src/server/game-do/socket.ts` (lines 47-60) -- Stage 1: JSON parsing
- `src/shared/protocol.ts` (lines 358-468) -- Stage 2: protocol validation
- `src/shared/engine/astrogation.ts` -- Stage 3: engine validation (astrogation)
- `src/shared/engine/fleet-building.ts` -- Stage 3: engine validation (fleet)
- `src/shared/engine/logistics.ts` -- Stage 3: engine validation (logistics)
- `src/server/game-do/actions.ts` (lines 341-379) -- `runGameStateAction` error handling

## Code Examples

Stage 2 validation with size limits and type checks:

```typescript
const parseAstrogationOrders = (raw: unknown): AstrogationOrder[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_ASTROGATION_ORDERS) {
    return null;
  }

  const orders: AstrogationOrder[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }
    if (!isNullableIntegerInRange(item.burn, 0, 5)) {
      return null;
    }
    // ...
  }
  return orders;
};
```

Stage 3 engine validation returning `EngineFailure`:

```typescript
// In engine code:
if (gameState.phase !== 'astrogation') {
  return { error: { code: ErrorCode.INVALID_PHASE, message: '...' } };
}
if (ship.owner !== playerId) {
  return { error: { code: ErrorCode.INVALID_SHIP, message: '...' } };
}
```

Runner catching unexpected engine errors:

```typescript
export const runGameStateAction = async (deps, ws, action, onSuccess) => {
  const gameState = await deps.getCurrentGameState();
  if (!gameState) return;

  let result;
  try {
    result = await action(gameState);
  } catch (err) {
    deps.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
    deps.sendError(ws, 'Engine error -- action rejected, game state preserved');
    return;
  }

  if ('error' in result) {
    deps.sendError(ws, result.error.message, result.error.code);
    return;
  }
  await onSuccess(result);
};
```

## Consistency Analysis

The three-stage pattern is consistently applied across all C2S message types. Every message goes through JSON parse, protocol validation, and engine validation before mutating state.

The protocol validator is thorough about size limits (every array has a max length) and type narrowing. The engine validators consistently use `ErrorCode` for categorisation.

One inconsistency: some engine validation returns `EngineFailure` (object with `error` field) while others use helper functions like `engineFailure()`. The intent is the same but the style varies slightly between engine modules.

## Completeness Check

- **No schema validation library**: Validation is hand-written rather than using Zod, io-ts, or similar. This keeps the bundle dependency-free but means each new field needs manual validation code.
- **Rate limiting as Stage 0**: `applySocketRateLimit` runs before JSON parsing, acting as a pre-validation rate gate. This is architecturally correct but is documented separately as pattern 60.
- **S2C validation is lighter**: `validateServerMessage` does structural checks but does not deeply validate `GameState` internals. The comment says "the server is the authority" -- correct, but it means a corrupted server could send malformed state.

## Related Patterns

- **47 -- Discriminated Union Messages**: Stage 2 validates the discriminant and variant-specific fields.
- **59 -- Error Code Enum**: Stage 3 uses `ErrorCode` for structured error categorisation.
- **60 -- Rate Limiting**: Stage 0 (before parsing) rate-limits messages per socket.
