# Guard Clause / Validation

## Category

Type System & Data Flow

## Intent

Guard clauses validate preconditions at function entry points and exit
early on failure, keeping the happy path at the top level of indentation.
In Delta-V this serves two purposes: (1) protecting the game engine from
invalid state transitions and illegal player actions, and (2) validating
untrusted network input before it reaches the engine.

## How It Works in Delta-V

Delta-V uses guard clauses at three levels:

### 1. Phase + player validation (`validatePhaseAction`)

Every engine entry point begins by calling `validatePhaseAction`, which
checks that the game is in the expected phase and that the calling player
is the active player:

```typescript
// src/shared/engine/util.ts
export const validatePhaseAction = (
  state: GameState,
  playerId: PlayerId,
  requiredPhase: Phase,
): EngineError | null => {
  if (state.phase !== requiredPhase) {
    return {
      code: ErrorCode.INVALID_PHASE,
      message: `Not in ${requiredPhase} phase`,
    };
  }

  if (playerId !== state.activePlayer) {
    return {
      code: ErrorCode.NOT_YOUR_TURN,
      message: 'Not your turn',
    };
  }
  return null;
};
```

### 2. Domain-specific validation functions

Dedicated `validate*` functions check business rules for specific
operations:

- `validateAstrogationOrders` -- validates burn directions, fuel, overload
  eligibility, and ship ownership for all orders in a batch.
- `validateShipOrdnanceLaunch` -- checks ship lifecycle, damage state,
  control status, ordnance type eligibility, and cargo capacity.
- `validateOrdnanceLaunch` -- wraps ship validation with scenario-level
  restrictions (allowed types, resupply turn, mine + burn rule).
- `validateTransfer` -- validates logistics transfer eligibility, amounts,
  and capacity for fuel, cargo, and passenger transfers.

### 3. Protocol validation (untrusted input)

`validateClientMessage` in `protocol.ts` takes `unknown` input from the
network and produces a `Result<C2S>`. Each message type has its own
parser (e.g., `parseAstrogationOrders`, `parseCombatAttacks`) that
validates structure, types, and bounds before constructing typed values.

## Key Locations

| Validator | File | Returns |
|-----------|------|---------|
| `validatePhaseAction` | `src/shared/engine/util.ts:71-90` | `EngineError \| null` |
| `validateShipOrdnanceLaunch` | `src/shared/engine/util.ts:175-250` | `EngineError \| null` |
| `validateOrdnanceLaunch` | `src/shared/engine/util.ts:254-294` | `EngineError \| null` |
| `validateAstrogationOrders` | `src/shared/engine/astrogation.ts:26-120` | `EngineError \| null` |
| `validateTransfer` | `src/shared/engine/logistics.ts:134-253` | `EngineError \| null` |
| `validateClientMessage` | `src/shared/protocol.ts:358-468` | `Result<C2S>` |
| `validateServerMessage` | `src/shared/protocol.ts:478-577` | `Result<S2C>` |
| Protocol sub-parsers | `src/shared/protocol.ts:49-356` | `T[] \| null` |

## Code Examples

### Phase guard at engine entry point

```typescript
// src/shared/engine/logistics.ts
export const processLogistics = (
  inputState: GameState,
  playerId: PlayerId,
  transfers: TransferOrder[],
  map: SolarSystemMap,
):
  | { state: GameState; engineEvents: EngineEvent[] }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'logistics');
  if (phaseError) return { error: phaseError };

  for (const transfer of transfers) {
    const error = validateTransfer(state, playerId, transfer);
    if (error) return { error };
    // ... apply transfer
  }

  return { state, engineEvents };
};
```

### Ship ordnance validation with layered guards

```typescript
// src/shared/engine/util.ts
export const validateShipOrdnanceLaunch = (
  ship: Ship,
  ordnanceType: Ordnance['type'],
): EngineError | null => {
  const stats = SHIP_STATS[ship.type];

  if (!stats) return engineError(ErrorCode.INVALID_INPUT, 'Unknown ship type');

  if (ship.lifecycle === 'destroyed') {
    return engineError(ErrorCode.STATE_CONFLICT, 'Ship is destroyed');
  }

  if (ship.lifecycle === 'landed') {
    return engineError(ErrorCode.STATE_CONFLICT, 'Cannot launch ordnance while landed');
  }

  if (ship.control === 'captured')
    return engineError(ErrorCode.NOT_ALLOWED, 'Captured ships cannot launch ordnance');

  if (ship.damage.disabledTurns > 0) {
    if (!stats.operatesWhileDisabled && !(stats.operatesAtD1 && ship.damage.disabledTurns <= 1)) {
      return engineError(ErrorCode.STATE_CONFLICT, 'Ship is disabled');
    }
  }

  // ... more checks for ordnance type eligibility, cargo capacity

  return null;
};
```

### Protocol validation (untrusted input with bounds checking)

```typescript
// src/shared/protocol.ts
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

    // ... more field validation

    orders.push({ shipId: item.shipId, burn: item.burn, ... });
  }

  return orders;
};
```

### Surrender validation with per-ship guards

```typescript
// src/shared/engine/logistics.ts
for (const shipId of shipIds) {
  const ship = state.ships.find((s) => s.id === shipId);

  if (!ship) {
    return engineFailure(ErrorCode.INVALID_SHIP, `Ship ${shipId} not found`);
  }

  if (ship.owner !== playerId) {
    return engineFailure(ErrorCode.NOT_ALLOWED, `Ship ${shipId} not owned by player`);
  }

  if (ship.lifecycle === 'destroyed') {
    return engineFailure(ErrorCode.STATE_CONFLICT, `Ship ${shipId} is destroyed`);
  }

  if (ship.control === 'surrendered') {
    return engineFailure(ErrorCode.STATE_CONFLICT, `Ship ${shipId} already surrendered`);
  }

  if (ship.control === 'captured') {
    return engineFailure(ErrorCode.STATE_CONFLICT, `Ship ${shipId} is captured`);
  }
}
```

## Consistency Analysis

**Highly consistent**: Every engine entry point begins with
`validatePhaseAction`. Domain validation is always expressed as
`EngineError | null` return values. Protocol parsing always returns
`T | null`.

**Three-tier validation** is applied uniformly:

1. Protocol layer: validates structure and types from untrusted input
2. Phase guard: validates game phase and active player
3. Domain validation: validates business rules per operation

**Minor patterns**:

- The `EngineError | null` convention for validators (return null on
  success) is used everywhere in the engine layer.
- Protocol parsers use `T | null` (return null on failure) consistently.
- The `validateClientMessage` function bridges these by wrapping parsers
  in `Result<C2S>`.

## Completeness Check

- **All entry points guarded**: Every public engine function
  (`processAstrogation`, `processOrdnance`, `processCombat`,
  `processFleetReady`, `processLogistics`, `skipOrdnance`, `skipCombat`,
  `skipLogistics`, `endCombat`, `beginCombatPhase`, `processSingleCombat`,
  `processEmplacement`, `processSurrender`) begins with
  `validatePhaseAction`.

- **Protocol bounds checking**: All array inputs are bounded by constants
  (`MAX_FLEET_PURCHASES = 64`, `MAX_ASTROGATION_ORDERS = 64`, etc.).
  String lengths are checked. Integer ranges are validated with
  `isIntegerInRange`.

- **Potential gap -- emplacement validation**: The `processEmplacement`
  function validates the ship and base status inline rather than using a
  dedicated `validateEmplacement` function. Extracting a validator would
  improve consistency and testability.

- **Potential gap -- combat attack validation**: The `processCombat`
  function contains extensive inline validation (~100 lines) for attack
  declarations. This could be extracted into a `validateCombatAttacks`
  function to match the pattern used by astrogation and logistics.

- **No schema validation library**: All validation is hand-written. This
  is appropriate for the domain (game rules cannot be expressed in a
  generic schema) but means new message types require manually writing
  parsers.

## Related Patterns

- **Engine-Style Error Return** (pattern 25) -- validation results feed
  directly into the engine error return convention.
- **Result<T, E>** (pattern 24) -- protocol validators return `Result`
  while engine validators return `EngineError | null`.
- **Discriminated Unions** (pattern 23) -- protocol validation narrows
  `unknown` input into typed discriminated unions.
