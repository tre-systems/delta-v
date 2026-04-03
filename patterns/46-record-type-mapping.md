# Record-Based Type Mapping

## Category
Client-Specific

## Intent
Use `Record<K, V>` and `Map<K, V>` instead of arrays for keyed lookups, ensuring O(1) access by identifier and making the key relationship explicit in the type system. This prevents linear scans and avoids the ambiguity of arrays where the index has no semantic meaning.

## How It Works in Delta-V

The codebase uses two primary key-value patterns depending on context:

### Map<K, V> for Runtime State

`Map` is preferred for mutable, runtime data structures where entries are added, deleted, and iterated:

- **`SolarSystemMap.hexes: Map<HexKey, MapHex>`** -- The core map data structure. Keyed by serialized hex coordinates for O(1) hex lookup.
- **Planning store maps**: `burns: Map<string, number | null>`, `overloads: Map<string, number | null>`, `weakGravityChoices: Map<string, Record<string, boolean>>` -- Per-ship planning state keyed by ship ID.
- **Logistics maps**: `fuelAmounts: Map<string, number>`, `cargoAmounts: Map<string, number>`, `passengerAmounts: Map<string, number>` -- Transfer amounts keyed by pair key.
- **Animation trails**: `Map<string, HexCoord[]>` -- Trail paths keyed by ship/ordnance ID.

### Record<K, V> for Static/Serialized Data

`Record` is used for static configuration, serialized data, and type-level mappings:

- **`PHASE_TRANSITIONS: Record<Phase, readonly Phase[]>`** -- Static mapping of game phases to their valid successors. This is a compile-time constant.
- **`weakGravityChoices: Record<HexKey, boolean>`** on `AstrogationOrder` -- Serialized player choices sent to/from the server. Uses `Record` because it serializes naturally to JSON (unlike `Map`).
- **Command handler map**: `CommandHandlerMap` uses a Record-like pattern (object with typed keys) for exhaustive command dispatch.
- **`SHIP_STATS: Record<ShipType, ShipStats>`** (in shared constants) -- Static ship configuration.

### Arrays for Ordered Collections

Arrays are used where order matters or the collection is small and identified by content:

- **`GameState.ships: Ship[]`** and `ordnance: Ordnance[]` -- Ordered entity lists. Ships are found by `ships.find(s => s.id === id)`, which is a linear scan. This is acceptable because the entity count is small (typically under 20 ships per game).
- **`destroyedAsteroids: HexKey[]`** and `bases: HexKey[]` -- Small lists where membership testing is done via `includes()`.
- **`combatAttackerIds: string[]`** -- Ordered list of attacking ship IDs.

### Sets for Membership Testing

`Set<string>` is used where the only operation is membership testing:

- **`landingShips: Set<string>`** -- Planning store tracks which ships are attempting landing.
- **`acknowledgedShips: Set<string>`** and `acknowledgedOrdnanceShips: Set<string>` -- Tracks which ships have been processed in a phase.
- **`gravityBodies?: Set<string>`** on `SolarSystemMap` -- Bodies that exert gravity.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/shared/types/domain.ts` | 47 | `PHASE_TRANSITIONS: Record<Phase, readonly Phase[]>` |
| `src/shared/types/domain.ts` | 200 | `weakGravityChoices?: Record<HexKey, boolean>` |
| `src/shared/types/domain.ts` | 297 | `hexes: Map<HexKey, MapHex>` |
| `src/client/game/planning.ts` | 74-83 | Planning Maps: `burns`, `overloads`, `weakGravityChoices` |
| `src/client/game/planning.ts` | 80-81 | Planning Sets: `landingShips`, `acknowledgedShips` |
| `src/client/game/logistics-ui.ts` | 24-26 | Logistics Maps: `fuelAmounts`, `cargoAmounts`, `passengerAmounts` |
| `src/client/renderer/animation.ts` | 95-96 | Trail Maps: `shipTrails`, `ordnanceTrails` |
| `src/client/game/command-router.ts` | 318-325 | Handler map: `commandHandlers satisfies CommandHandlerMap` |

## Code Examples

Map for hex lookup:

```typescript
// src/shared/types/domain.ts
export interface SolarSystemMap {
  hexes: Map<HexKey, MapHex>;
  bodies: CelestialBody[];
  gravityBodies?: Set<string>;
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number };
}
```

Map for per-ship planning state:

```typescript
// src/client/game/planning.ts
interface AstrogationPlanningState {
  burns: Map<string, number | null>;
  overloads: Map<string, number | null>;
  landingShips: Set<string>;
  weakGravityChoices: Map<string, Record<string, boolean>>;
  acknowledgedShips: Set<string>;
}
```

Record for static phase transitions:

```typescript
// src/shared/types/domain.ts
export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  waiting: ['fleetBuilding', 'astrogation'],
  fleetBuilding: ['astrogation', 'gameOver'],
  astrogation: ['ordnance', 'logistics', 'combat', 'astrogation', 'gameOver'],
  ordnance: ['logistics', 'combat', 'astrogation', 'gameOver'],
  logistics: ['astrogation', 'gameOver'],
  combat: ['logistics', 'astrogation', 'gameOver'],
  gameOver: [],
} as const;
```

Record for serializable gravity choices:

```typescript
// src/shared/types/domain.ts
export interface AstrogationOrder {
  shipId: string;
  burn: number | null;
  overload: number | null;
  weakGravityChoices?: Record<HexKey, boolean>;
  land?: boolean;
}
```

## Consistency Analysis

The codebase follows a clear pattern for choosing between data structures:

| Data Structure | Use Case | Examples |
|---|---|---|
| `Map<K, V>` | Mutable runtime state, frequent add/delete | Planning maps, logistics amounts, trails, hex map |
| `Record<K, V>` | Static config, serialized data, type-level mappings | Phase transitions, gravity choices, ship stats |
| `Set<K>` | Membership testing | Landing ships, acknowledged ships, gravity bodies |
| `Array<T>` | Ordered collections, small lists | Ships, ordnance, bases, destroyed asteroids |

**Potential improvement areas**:

- **`GameState.ships: Ship[]`** uses `ships.find(s => s.id === id)` for lookups in several places. With the current game scale (under 20 ships), this is fine. If entity counts grew significantly, a `Map<string, Ship>` index would be more appropriate.
- **`destroyedAsteroids: HexKey[]`** uses array `includes()` for membership testing. A `Set<HexKey>` would be semantically clearer but the array size is small.
- **`combatTargetedThisPhase?: string[]`** is an array used for membership checks. A Set would be more appropriate but the list is typically very short.

These are minor -- the current choices are pragmatically correct given the small data sizes in this game.

## Completeness Check

The pattern is well-applied overall:

- **No object references as Map keys**: All Maps use string or branded string keys.
- **Record vs Map choice is consistent**: Records for static/serializable data, Maps for mutable runtime data.
- **Set usage is appropriate**: Used for membership testing where no value is needed.
- **Type safety**: `HexKey` branding prevents accidental string/key mixing. `Phase` as a union type provides exhaustive Record keys.

The main completeness gap is minor: a few small arrays could be Sets for semantic clarity, but this is not a correctness issue.

## Related Patterns

- **String-Key Serialization** (Pattern 45): The `HexKey` branded type enables type-safe keying of Maps and Records.
- **Planning Store** (Pattern 37): The primary consumer of `Map<string, ...>` for per-ship planning state.
- **Session Model** (Pattern 38): `GameState` uses these patterns for its core data structures.
