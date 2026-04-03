# Utility Type Patterns

## Category

Type System & Data Flow

## Intent

TypeScript's built-in utility types (`Pick`, `Readonly`, `Extract`,
`Exclude`, `Omit`, `ReturnType`, `NonNullable`, `Parameters`) let Delta-V
narrow function signatures to their minimal required surface, extract
sub-types from large unions, and enforce immutability -- all without
introducing new type definitions.

## How It Works in Delta-V

### `Pick<T, K>` -- minimal dependency signatures

Engine utility functions use `Pick` to declare exactly which fields of
`GameState` or `Ship` they need, rather than accepting the entire type.
This makes dependencies explicit and allows callers to pass partial
objects in tests.

### `Extract<T, U>` -- sub-union extraction

The event projector uses `Extract` to carve the large `EngineEvent` union
into domain-specific sub-unions for lifecycle, ship, and conflict events.

### `ReturnType<T>` -- inferred return types

Factory functions that return complex or anonymous object types use
`ReturnType<typeof fn>` to name the result type without duplicating it.

### `Readonly` and `readonly` -- immutability

Lookup tables, collection function parameters, and session model
interfaces use `Readonly<Record<...>>`, `readonly T[]`, and `readonly`
properties to prevent mutation.

### `Omit<T, K>` -- field removal

Used in the HUD view layer to create input types that exclude
platform-specific fields.

### `NonNullable<T>` -- null elimination

The `must()` assertion helper returns `NonNullable<T>`.

## Key Locations

### `Pick` usage

| Function | File | Pick Expression |
|----------|------|-----------------|
| `isPlanetaryDefenseEnabled` | `src/shared/engine/util.ts:110` | `Pick<GameState, 'scenarioRules'>` |
| `usesEscapeInspectionRules` | `src/shared/engine/util.ts:114` | `Pick<GameState, 'scenarioRules'>` |
| `getEscapeEdge` | `src/shared/engine/util.ts:118` | `Pick<GameState, 'scenarioRules'>` |
| `getAllowedOrdnanceTypes` | `src/shared/engine/util.ts:144` | `Pick<GameState, 'scenarioRules'>` |
| `getCargoUsedAfterResupply` | `src/shared/engine/util.ts:149` | `Pick<Ship, 'baseStatus'>` |
| `getNextOrdnanceId` | `src/shared/engine/util.ts:155` | `Pick<GameState, 'ordnance'>` |
| `validateOrdnanceLaunch` | `src/shared/engine/util.ts:255` | `Pick<GameState, 'scenarioRules' \| 'pendingAstrogationOrders'>` |
| `getOrderableShipsForPlayer` | `src/shared/engine/util.ts:333` | `Pick<GameState, 'ships'>` |
| `computeRangeModToTarget` | `src/shared/combat.ts:223` | `Pick<Ship \| Ordnance, 'position'>` |
| `computeVelocityModToTarget` | `src/shared/combat.ts:232` | `Pick<Ship \| Ordnance, 'velocity'>` |
| Session UI effects | `src/client/game/session-ui-effects.ts` | `Pick<ClientSession, ...>` |
| Session token store | `src/client/game/session-token-store.ts` | `Pick<StorageLike, 'getItem'>` |
| Room routes | `src/server/room-routes.ts` | `Pick<Env, 'GAME'>` |

### `Extract` usage

| Type | File | Extract Expression |
|------|------|--------------------|
| `LifecycleProjectionEvent` | `src/shared/engine/event-projector/support.ts:7` | `Extract<EngineEvent, { type: 'gameCreated' \| ... }>` |
| `ShipProjectionEvent` | `src/shared/engine/event-projector/support.ts:26` | `Extract<EngineEvent, { type: 'shipMoved' \| ... }>` |
| `ConflictProjectionEvent` | `src/shared/engine/event-projector/support.ts:46` | `Extract<EngineEvent, { type: 'ordnanceLaunched' \| ... }>` |
| `ActiveTurnPhase` | `src/client/game/phase.ts:31` | `Extract<Phase, ...>` |
| `WelcomePlan` | `src/client/game/message-handler.ts:66` | `Extract<ClientMessagePlan, { kind: ... }>` |

### `ReturnType` usage

| Named Type | File | Expression |
|------------|------|------------|
| `CameraController` | `src/client/game/camera-controller.ts:71` | `ReturnType<typeof createCameraController>` |
| `InputHandler` | `src/client/input.ts:208` | `ReturnType<typeof createInputHandler>` |
| `SessionApi` | `src/client/game/session-api.ts:256` | `ReturnType<typeof createSessionApi>` |
| `GameClient` | `src/client/game/client-kernel.ts:221` | `ReturnType<typeof createGameClient>` |
| `HudController` | `src/client/game/hud-controller.ts:168` | `ReturnType<typeof createHudController>` |
| `ActionDeps` | `src/client/game/action-deps.ts:206` | `ReturnType<typeof createActionDeps>` |

### `Readonly` / `readonly` usage

| Usage | File |
|-------|------|
| `Readonly<Record<Phase, readonly Phase[]>>` | `src/shared/types/domain.ts:47` |
| `ReadonlySet<ShipType>` | `src/shared/constants.ts:22,31,38` |
| `readonly HexVec[]` | `src/shared/hex.ts:21` |
| `readonly T[]` parameters in all util functions | `src/shared/util.ts` |
| `readonly` properties on `ScenarioCapabilities` | `src/shared/scenario-capabilities.ts:22-27` |
| `readonly` properties on `ClientSession` model | `src/client/game/session-model.ts` |

### `Omit` usage

| Usage | File |
|-------|------|
| `Omit<HUDInput, 'isMobile'>` | `src/client/ui/hud-chrome-view.ts:26,56,57,78` |
| `Omit<TransitionPlanOverrides, ...>` | `src/client/game/phase.ts:26` |

### `NonNullable` usage

| Usage | File |
|-------|------|
| `must<T>` return type | `src/shared/assert.ts:1-10` |

## Code Examples

### Pick for minimal engine function signatures

```typescript
// src/shared/engine/util.ts
export const isPlanetaryDefenseEnabled = (
  state: Pick<GameState, 'scenarioRules'>,
): boolean => deriveCapabilities(state.scenarioRules).planetaryDefenseEnabled;

export const validateOrdnanceLaunch = (
  state: Pick<GameState, 'scenarioRules' | 'pendingAstrogationOrders'>,
  ship: Ship,
  ordnanceType: Ordnance['type'],
): EngineError | null => { ... };
```

By accepting `Pick<GameState, 'scenarioRules'>` instead of `GameState`,
the function documents its actual dependencies and can be tested with a
minimal mock.

### Pick for polymorphic target parameters

```typescript
// src/shared/combat.ts
export const computeRangeModToTarget = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'position'>,
): number =>
  hexDistance(getClosestApproachHex(attacker, target), target.position);

export const computeVelocityModToTarget = (
  attacker: Ship,
  target: Pick<Ship | Ordnance, 'velocity'>,
): number => { ... };
```

`Pick<Ship | Ordnance, 'position'>` accepts anything with a `position`
field, whether it is a ship, ordnance, or a test fixture.

### Extract for event sub-union types

```typescript
// src/shared/engine/event-projector/support.ts
export type LifecycleProjectionEvent = Extract<
  EngineEvent,
  {
    type:
      | 'gameCreated'
      | 'fleetPurchased'
      | 'astrogationOrdersCommitted'
      | 'ordnanceLaunchesCommitted'
      | 'logisticsTransfersCommitted'
      | 'surrenderDeclared'
      | 'fugitiveDesignated'
      | 'phaseChanged'
      | 'turnAdvanced'
      | 'identityRevealed'
      | 'checkpointVisited'
      | 'gameOver';
  }
>;
```

This extracts the subset of `EngineEvent` variants that belong to the
lifecycle domain, creating a narrowed type for the lifecycle projector.

### ReturnType for factory-produced types

```typescript
// src/client/game/camera-controller.ts
export type CameraController = ReturnType<typeof createCameraController>;
```

The `createCameraController` function returns a complex object. Rather
than defining an interface separately, the type is inferred from the
implementation. This avoids type duplication and ensures the type always
matches the factory.

### Readonly for immutable lookup tables

```typescript
// src/shared/types/domain.ts
export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  waiting: ['fleetBuilding', 'astrogation'],
  // ...
} as const;
```

`Readonly<Record<...>>` prevents property reassignment. `readonly Phase[]`
prevents array mutation. The `as const` assertion narrows the literal
types.

### NonNullable via the must() helper

```typescript
// src/shared/assert.ts
export const must = <T>(
  value: T,
  message = 'Expected value to be present',
): NonNullable<T> => {
  if (value == null) {
    throw new Error(message);
  }
  return value;
};
```

Used throughout the engine when a value is known to exist but the type
system cannot prove it (e.g., after a `.find()` that logically must
succeed).

## Consistency Analysis

**`Pick` is well-applied in the shared layer**: Engine utility functions
consistently narrow their `GameState` parameter to the required subset.
The combat module uses `Pick<Ship | Ordnance, 'position'>` to abstract
over target types.

**`Extract` is confined to the event projector**: This is the right
place -- the projector is the only code that needs to partition the
`EngineEvent` union.

**`ReturnType` is used for factory functions**: The client layer
consistently exports `type X = ReturnType<typeof createX>` for
controller and handler factories.

**`Readonly` is systematic for constants**: All game data tables,
scenario capabilities, and session model properties are readonly. The
utility functions in `util.ts` accept `readonly T[]` parameters.

**`Omit` usage is minimal**: Only the HUD chrome view uses it, to
strip `isMobile` from the input type.

## Completeness Check

- **`Pick` could be extended to more engine functions**: Some functions
  like `hasAnyEnemyShips` accept `GameState` but only use `ships` and
  `activePlayer`. Narrowing these to `Pick<GameState, 'ships' | 'activePlayer'>`
  would improve the documentation of dependencies.

- **Missing `Readonly` on some constants**: The `ORDNANCE_MASS` record
  and `SHIP_STATS` record are not wrapped in `Readonly`. While they are
  const-declared (so the binding cannot be reassigned), the object
  properties could theoretically be mutated. Adding `Readonly<>` would
  be a defense-in-depth improvement.

- **`Exclude` is not heavily used**: `PurchasableShipType` in `domain.ts`
  uses `Exclude<ShipType, 'orbitalBase'>` to remove orbital bases from
  the purchasable set. This pattern could be applied elsewhere (e.g.,
  excluding `'destroyed'` from lifecycle types in certain contexts).

- **`Parameters<typeof fetch>` usage**: The session API uses
  `Parameters<typeof fetch>` to type wrapper arguments. This is a clean
  pattern that could be documented as a recommended approach for wrapping
  external APIs.

## Related Patterns

- **Discriminated Unions** (pattern 23) -- `Extract` operates on
  discriminated unions to create sub-union types.
- **Branded Types** (pattern 27) -- `NonNullable` is used alongside
  branded types in the `must()` assertion.
- **Data-Driven Lookup Tables** (pattern 28) -- `Readonly<Record<K, V>>`
  enforces immutability of table data.
- **Engine-Style Error Return** (pattern 25) -- `Pick` narrows state
  parameters for engine validation functions.
