# Discriminated Union Messages

## Category

Protocol & Communication

## Intent

Provide a single, type-safe representation of every client-to-server (C2S) and server-to-client (S2C) message so that TypeScript's exhaustive narrowing can guarantee every message type is handled. This eliminates stringly-typed dispatch and makes protocol drift impossible without a compiler error.

## How It Works in Delta-V

The protocol defines two top-level discriminated union types -- `C2S` and `S2C` -- each a union of object literals sharing a `type` string discriminant. Every variant carries exactly the fields that message needs and nothing more.

On the **client side**, outgoing messages are constructed as plain object literals that satisfy one of the `C2S` variants. On the **server side**, incoming WebSocket strings are JSON-parsed, then run through `validateClientMessage()` which returns a `Result<C2S>`. The validator is a hand-written switch over the `type` discriminant; unknown types are rejected with an error Result.

The same pattern works in reverse for S2C. The server builds typed S2C objects and serialises them. The client validates incoming messages through `validateServerMessage()`, which also switches on `type`.

Discriminated unions enable two important downstream patterns:

1. **Exhaustive dispatch** -- `actions.ts` defines a `GAME_STATE_ACTION_TYPES` set and derives `GameStateActionMessage` as an `Extract<C2S, { type: GameStateActionType }>`. A `satisfies Record<GameStateActionType, unknown>` on the handler map ensures every action type has a handler at compile time.

2. **Aux message separation** -- `AuxMessage = Exclude<C2S, { type: GameStateActionType }>` cleanly carves out chat, ping, and rematch from the game-state action path.

## Key Locations

- `src/shared/types/protocol.ts` (lines 32-105) -- `C2S` and `S2C` union definitions
- `src/shared/protocol.ts` (lines 358-468) -- `validateClientMessage` switch
- `src/shared/protocol.ts` (lines 478-577) -- `validateServerMessage` switch
- `src/server/game-do/actions.ts` (lines 42-64) -- `GAME_STATE_ACTION_TYPES`, `GameStateActionMessage`, `AuxMessage`
- `src/server/game-do/ws.ts` (lines 86-122) -- runtime dispatch based on discriminant

## Code Examples

C2S union (each variant carries only what it needs):

```typescript
export type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'surrender'; shipIds: string[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'combatSingle'; attack: CombatAttack }
  | { type: 'endCombat' }
  | { type: 'skipCombat' }
  | { type: 'logistics'; transfers: TransferOrder[] }
  | { type: 'skipLogistics' }
  | { type: 'rematch' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };
```

Compile-time exhaustive handler map:

```typescript
export const GAME_STATE_ACTION_TYPES = new Set([
  'fleetReady',
  'astrogation',
  'surrender',
  // ...
] as const satisfies readonly C2S['type'][]);

// Handler map -- satisfies ensures completeness
return {
  fleetReady: defineGameStateActionHandler({ /* ... */ }),
  astrogation: defineGameStateActionHandler({ /* ... */ }),
  // ...
} satisfies Record<GameStateActionType, unknown>;
```

## Consistency Analysis

The pattern is applied consistently across both directions of the protocol. Every C2S variant has a corresponding case in `validateClientMessage`, and every S2C variant has a case in `validateServerMessage`. The `satisfies` constraint on the action handler map prevents silent omission when adding a new game-state action type.

One minor inconsistency: `validateServerMessage` casts through `as unknown as S2C` after structural checks rather than constructing a fresh typed object the way `validateClientMessage` does. This means S2C validation trusts the server's object shape more loosely than C2S. This is intentional (the server is authoritative), but it is a deliberate asymmetry worth noting.

## Completeness Check

- **Missing: exhaustive switch helper** -- Neither validator uses a `never` default case to get compile-time exhaustiveness. They rely on the `default: return invalid(...)` fallback. An `assertNever` style check in the default branch would catch new types at compile time rather than silently rejecting them at runtime.
- **Missing: S2C emit-time type safety** -- There is no equivalent of the `satisfies Record<...>` trick for the server broadcast code paths. A new S2C type could be added to the union without a corresponding broadcast call being guaranteed.
- The `emplaceBase` C2S variant uses a plural `emplacements` array but does not carry a matching skip variant (`skipEmplacement`) unlike ordnance/combat/logistics, since emplacement is always optional within the astrogation phase. This is correct for the domain but could confuse someone expecting symmetry.

## Related Patterns

- **48 -- Single State-Bearing Message**: Each state-mutating S2C message carries its own `state: GameState` field, so the discriminant controls both routing and payload shape.
- **58 -- Multi-Stage Validation**: `validateClientMessage` is the first stage; engine-level validation (phase checks, ownership) is the second.
- **59 -- Error Code Enum**: The `S2C` error variant carries an optional `ErrorCode`, connecting protocol errors to the enum.
- **54 -- Contract Fixtures**: `__fixtures__/contracts.json` provides canonical C2S/S2C payloads used in round-trip tests against the validators.
