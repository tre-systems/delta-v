# Type System & Validation

Patterns for nominal typing, multi-stage input validation, structured error handling, and abuse prevention. The coding standards doc covers general TypeScript conventions; this document focuses on project-specific type tricks, validation pipeline details, and known gaps.

## Branded Types (27)

Key files: `src/shared/hex.ts`, `src/shared/ids.ts`, `src/shared/types/protocol.ts`

Three branded types: `HexKey`, `RoomCode`, `PlayerToken`. All use the `string & { readonly [__brand]: never }` pattern with `declare const` unique symbols.

Constructor naming convention:
- `hexKey(coord)`: safe constructor from structured `HexCoord` data
- `asHexKey(str)`: unsafe cast for serialization boundaries and tests
- `asRoomCode(str)` / `asPlayerToken(str)`: unsafe casts only (no structured constructor needed)

`RoomCode` and `PlayerToken` have runtime guards (`isRoomCode`, `isPlayerToken`) and normalize functions. `HexKey` has no `isHexKey` guard -- `asHexKey` is used at serialization boundaries without format validation. A guard checking `/^-?\d+,-?\d+$/` would add safety.

Missing branded types that could prevent bugs:
- **Ship IDs** (`ship.id: string`) -- used pervasively in combat targeting, movement, logistics
- **Ordnance IDs** (`ordnance.id: string`) -- engine generates `ord${n}` pattern but typed as plain `string`
- **Game IDs** (`state.gameId: string`)
- **Body names** (`body.name: string`) -- used as lookup keys throughout map system

Unsafe `as HexKey` casts appear in production code beyond tests, including protocol parsing for `weakGravityChoices` and map construction.

## Multi-Stage Validation (58)

Key files: `src/server/game-do/socket.ts` (stage 1), `src/shared/protocol.ts` (stage 2), engine modules (stage 3), `src/server/game-do/actions.ts` (runner)

Three stages with distinct error surfaces:

| Stage | Location | Catches | Returns |
|-------|----------|---------|---------|
| 0 (pre-parse) | `applySocketRateLimit` | Flood abuse | Socket close 1008 |
| 1 (transport) | `parseClientSocketMessage` | Malformed JSON | `Result` error |
| 2 (protocol) | `validateClientMessage` | Wrong types, missing fields, oversized arrays | `Result<C2S>` |
| 3 (engine) | Engine functions | Phase/turn/ownership/resource violations | `EngineFailure` with `ErrorCode` |

Stage 2 enforces size limits on every array (`MAX_FLEET_PURCHASES = 64`, `MAX_ASTROGATION_ORDERS`, etc.) and validates integer ranges. All validation is hand-written (no Zod/io-ts), keeping the bundle dependency-free but requiring manual code for each new field.

The `runGameStateAction` runner wraps engine calls in try/catch, converting thrown exceptions (unexpected bugs) to error responses without corrupting game state.

Minor inconsistency: some engine modules return `{ error: { code, message } }` directly while others use the `engineFailure()` helper. Same shape, different style.

S2C validation (`validateServerMessage`) is lighter -- structural checks without deep `GameState` validation. Intentional since the server is authoritative, but means a corrupted server could send malformed state.

## Error Code Enum (59)

Key files: `src/shared/types/domain.ts`, `src/shared/types/protocol.ts`, engine modules, `src/server/game-do/ws.ts`

String-valued enum with 10 members covering timing (`INVALID_PHASE`, `NOT_YOUR_TURN`), reference (`INVALID_SHIP`, `INVALID_TARGET`, `INVALID_SELECTION`), input (`INVALID_INPUT`), authorization (`NOT_ALLOWED`, `INVALID_PLAYER`), resources (`RESOURCE_LIMIT`), and consistency (`STATE_CONFLICT`).

The S2C `error` message carries an optional `ErrorCode` -- optional because some errors (internal server errors, rate limits) originate outside the engine.

Gaps:
- `INVALID_PLAYER` is defined but unused anywhere in the codebase
- Rate limit violations bypass the error code system entirely (socket close, not error message) -- a `RATE_LIMITED` code could help client handling
- Client-side handling tracks `plan.code` for telemetry but does not branch on it for context-specific messages or recovery guidance

Server-level mapping: `INVALID_INPUT` for malformed messages, `STATE_CONFLICT` for caught exceptions.

## Rate Limiting (60)

Key files: `src/server/game-do/socket.ts`, `src/server/game-do/ws.ts`

Two mechanisms:

**Socket-level**: `WeakMap<WebSocket, RateWindow>` tracking per-socket message counts. `WS_MSG_RATE_LIMIT = 10` messages per `WS_MSG_RATE_WINDOW_MS = 1_000` (1-second window). Exceeding the limit closes the socket with code 1008. The `WeakMap` keys on WebSocket objects, so entries are garbage-collected on socket close and survive DO hibernation wake cycles.

**Chat-level**: `Map<number, number>` tracking last chat timestamp per player ID. `CHAT_RATE_LIMIT_MS = 500`. Messages within the window are silently dropped (soft enforcement vs. the hard socket close above).

The `applySocketRateLimit` function is pure -- takes `now` as a parameter rather than calling `Date.now()` internally, making it deterministically testable.

Gaps:
- No per-action rate limiting beyond the socket-wide 10/sec cap
- No IP-level rate limiting (per-socket only -- multiple connections from same IP are not throttled; would need Worker-level enforcement)
- No warning/backoff before socket close (aggressive but appropriate since legitimate clients never approach the limit)

## Cross-Pattern Flow

The validation pipeline runs in strict order: rate limit (60) -> JSON parse (58 stage 1) -> protocol validation (58 stage 2) -> engine validation (58 stage 3). Error codes (59) are produced at stages 2-3 and flow to the client via the S2C `error` variant. Branded types (27) appear at stage 2 boundaries (e.g., `HexKey` in protocol parsing) but several production cast sites skip runtime validation.
