# Discriminated Unions

## Category

Type System & Data Flow

## Intent

Discriminated unions encode distinct message shapes, event types, and state
variants into a single union type where a literal `type` (or `kind`) field
acts as the discriminant. This lets TypeScript narrow the full variant in
`switch` / `if` branches so every handler sees exactly the fields it needs,
and the compiler can enforce exhaustiveness -- guaranteeing no variant is
silently ignored.

## How It Works in Delta-V

Delta-V makes heavy use of discriminated unions across every layer of the
codebase:

1. **Network protocol messages** -- `C2S` and `S2C` in
   `src/shared/types/protocol.ts` define the client-to-server and
   server-to-client message vocabularies. Both use `type` as the
   discriminant.

2. **Engine events** -- `EngineEvent` in
   `src/shared/engine/engine-events.ts` is a large union (30+ variants)
   covering every discrete state change the game engine can produce. The
   event projector dispatches on `event.type` to rebuild state from an
   event stream.

3. **Client commands** -- `GameCommand` in
   `src/client/game/commands.ts` lists every user-initiated action the
   client can dispatch. The command router switches on `command.type` to
   invoke the correct action handler.

4. **UI events** -- `UIEventPlan` in
   `src/client/game/ui-event-router.ts` uses `kind` as the discriminant
   to map UI events into client-side plans.

5. **Input events** -- `InputEvent` in
   `src/client/game/input-events.ts` discriminates on `type` between
   `clickHex` and `hoverHex` interactions.

6. **Domain sub-types** -- Several domain types are themselves
   discriminated unions:
   - `CourseResult` and `ShipMovement` discriminate on `outcome`
     (`'crash' | 'landing' | 'normal'`).
   - `FleetPurchase` discriminates on `kind` (`'ship' | 'orbitalBaseCargo'`).
   - `MovementEvent` discriminates on `type` (7 variants).

## Key Locations

| Type | File | Discriminant |
|------|------|-------------|
| `C2S` | `src/shared/types/protocol.ts:32-51` | `type` |
| `S2C` | `src/shared/types/protocol.ts:53-105` | `type` |
| `EngineEvent` | `src/shared/engine/engine-events.ts:17-231` | `type` |
| `GameCommand` | `src/client/game/commands.ts:6-62` | `type` |
| `UIEventPlan` | `src/client/game/ui-event-router.ts:4-17` | `kind` |
| `InputEvent` | `src/client/game/input-events.ts:24-26` | `type` |
| `CourseResult` | `src/shared/types/domain.ts:215-221` | `outcome` |
| `ShipMovement` | `src/shared/types/domain.ts:263-268` | `outcome` |
| `FleetPurchase` | `src/shared/types/domain.ts:376` | `kind` |
| `MovementEvent` | `src/shared/types/domain.ts:339-355` | `type` |

## Code Examples

### Network protocol (C2S)

```typescript
// src/shared/types/protocol.ts
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

### Exhaustive switch with `never` check in the event projector

```typescript
// src/shared/engine/event-projector/index.ts
switch (event.type) {
  case 'gameCreated':
  case 'fleetPurchased':
  // ... lifecycle events
    return projectLifecycleEvent(state, event, envelope.gameId, map);

  case 'shipMoved':
  case 'shipLanded':
  // ... ship events
    return projectShipEvent(state, event);

  case 'ordnanceLaunched':
  case 'ordnanceMoved':
  // ... conflict events
    return projectConflictEvent(state, event);

  default: {
    const unreachable: never = event;
    return {
      ok: false,
      error: `unsupported setup event: ${String(unreachable)}`,
    };
  }
}
```

### Domain sub-union: CourseResult with `outcome` discriminant

```typescript
// src/shared/types/domain.ts
export type CourseResult = CourseResultBase &
  (
    | { outcome: 'crash'; crashBody: string; crashHex: HexCoord }
    | { outcome: 'landing'; landedAt: string }
    | { outcome: 'normal' }
  );
```

### FleetPurchase with `kind` discriminant and type guards

```typescript
// src/shared/types/domain.ts
export type FleetPurchase = ShipFleetPurchase | OrbitalBaseCargoPurchase;

export const isShipFleetPurchase = (
  purchase: FleetPurchase,
): purchase is ShipFleetPurchase => purchase.kind === 'ship';

export const isOrbitalBaseCargoPurchase = (
  purchase: FleetPurchase,
): purchase is OrbitalBaseCargoPurchase => purchase.kind === 'orbitalBaseCargo';
```

## Consistency Analysis

The pattern is applied consistently across the codebase:

- **Discriminant naming** is predominantly `type`, with `kind` used for
  `FleetPurchase` and `UIEventPlan`, and `outcome` for movement result
  variants. The choice is intentional: `type` is the default, `kind` is
  used where `type` would clash with an existing field, and `outcome`
  describes a result rather than a message.

- **Exhaustive switches** are used in the event projector (`never` check),
  protocol validators, command routers, and UI event resolution. The event
  projector is the most rigorous -- it assigns `event` to `never` in the
  default branch, catching missing cases at compile time.

- **Type guard functions** (`isShipFleetPurchase`, `isActive`, etc.) are
  provided for unions that need to be narrowed outside of switch statements,
  such as in `.filter()` callbacks.

**Minor inconsistency**: The protocol validator in `protocol.ts` handles
the `C2S` switch without a `never` check -- it falls through to a
`default: return invalid('Unknown message type')` branch. This is
intentional (runtime validation of untrusted input), but it means new
`C2S` variants are not compile-time enforced in the validator.

## Completeness Check

- **Exhaustiveness checking**: Present in the event projector but missing
  from the protocol validators and the command router. Consider adding
  `const _: never = ...` assertions in the command router's switch to
  catch new `GameCommand` variants at compile time.

- **`MovementEvent.type` coverage**: The `MovementEvent` union has 7
  `type` values but no exhaustive switch over them. The toast formatter
  in `toast.ts` handles them with a switch but lacks a default `never`
  check.

- **Discriminant consistency**: Using both `type` and `kind` is fine, but
  `UIEventPlan` uses `kind` while the closely related `UIEvent` uses
  `type`. Documenting the convention would help.

## Related Patterns

- **Result<T, E>** (pattern 24) -- `Result` is itself a discriminated union
  on `ok: true | false`.
- **Engine-Style Error Return** (pattern 25) -- engine functions return
  `{ state } | { error }`, discriminated by presence of `error`.
- **Guard Clause / Validation** (pattern 26) -- protocol validators
  narrow discriminated unions from untrusted `unknown` input.
- **Cond/Condp** (pattern 29) -- sometimes used as an alternative to
  switch when the logic is simple value mapping.
