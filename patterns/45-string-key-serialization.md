# String-Key Serialization

## Category
Client-Specific

## Intent
Use string-based keys (particularly `HexKey` in `"q,r"` format) as canonical identifiers for hex coordinates in Maps, Records, and arrays, rather than using object references that cannot be compared by value. This enables efficient lookup, deduplication, and serialization of hex-based data structures.

## How It Works in Delta-V

Hex coordinates are value types (`{ q: number, r: number }`) that cannot serve as reliable Map/Set keys because JavaScript compares objects by reference, not by structure. The codebase solves this with the `hexKey()` function and the branded `HexKey` type.

### The HexKey Type

```typescript
declare const __hexKeyBrand: unique symbol;
export type HexKey = string & { readonly [__hexKeyBrand]: never };
```

`HexKey` is a branded string type -- it is structurally a string but the brand prevents accidental mixing with arbitrary strings at the type level. This provides compile-time safety: you cannot pass a plain `string` where a `HexKey` is expected without explicit casting.

### Key Functions

- **`hexKey({ q, r })`** -- Serializes a hex coordinate to `"q,r"` format, returning a `HexKey`.
- **`parseHexKey(key)`** -- Deserializes a `HexKey` back to `{ q, r }`.
- **`asHexKey(key)`** -- Casts a trusted string literal to `HexKey`. Used at serialization boundaries and in tests.

### Usage Contexts

The string key pattern is used in several data structures:

1. **Map hex lookup** (`SolarSystemMap.hexes: Map<HexKey, MapHex>`) -- The primary map data structure keyed by hex position.
2. **Destroyed lists** (`GameState.destroyedAsteroids: HexKey[]`, `destroyedBases: HexKey[]`) -- Arrays of serialized positions.
3. **Player bases** (`PlayerState.bases: HexKey[]`) -- Base positions as serialized keys.
4. **Weak gravity choices** (`AstrogationOrder.weakGravityChoices?: Record<HexKey, boolean>`) -- Player decisions about which gravity hexes to ignore.
5. **Planning state last selected hex** (`lastSelectedHex: string | null`) -- Stored as a hex key string for ship cycling.
6. **Ship stacking detection** (`renderer/entities.ts`, `renderer/ships.ts`) -- Uses `hexKey(ship.position)` to group ships at the same hex.

### Ship ID Keys

Beyond hex keys, ship IDs (plain strings like `"p0s0"`) are used as Map keys in the planning store:

- `burns: Map<string, number | null>` -- Ship ID to burn direction.
- `overloads: Map<string, number | null>` -- Ship ID to overload direction.
- `weakGravityChoices: Map<string, Record<string, boolean>>` -- Ship ID to gravity choices.

And in the logistics store:

- `fuelAmounts: Map<string, number>` -- Pair key (`"sourceId->targetId"`) to transfer amount.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/shared/hex.ts` | 45-59 | `HexKey` type, `hexKey()`, `parseHexKey()`, `asHexKey()` |
| `src/shared/types/domain.ts` | 297 | `SolarSystemMap.hexes: Map<HexKey, MapHex>` |
| `src/shared/types/domain.ts` | 94-95 | `destroyedAsteroids: HexKey[]`, `destroyedBases: HexKey[]` |
| `src/shared/types/domain.ts` | 187 | `PlayerState.bases: HexKey[]` |
| `src/shared/types/domain.ts` | 200 | `weakGravityChoices?: Record<HexKey, boolean>` |
| `src/client/game/planning.ts` | 113 | `lastSelectedHex: string` (hex key format) |
| `src/client/game/command-router.ts` | 156 | `hexKey(ship.position)` for selection tracking |
| `src/client/renderer/ships.ts` | 130 | `map?.hexes.get(hexKey(ship.position))` |
| `src/client/renderer/entities.ts` | 63, 71 | `hexKey(ship.position)` for stacking |
| `src/client/renderer/course.ts` | 426 | `weakGravityChoices[hexKey(gravity.hex)]` |

## Code Examples

Core serialization functions:

```typescript
// src/shared/hex.ts
export type HexKey = string & { readonly [__hexKeyBrand]: never };

export const hexKey = ({ q, r }: HexCoord): HexKey => `${q},${r}` as HexKey;

export const parseHexKey = (key: HexKey): HexCoord => {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
};
```

Map hex lookup:

```typescript
// src/client/renderer/ships.ts
const inGravity = Boolean(map?.hexes.get(hexKey(ship.position))?.gravity);
```

Gravity choice keying:

```typescript
// src/client/renderer/course.ts
weakGravityChoices[hexKey(gravity.hex)] === true,
```

Ship selection with hex key tracking:

```typescript
// src/client/game/command-router.ts
deps.ctx.planningState.selectShip(shipId, hexKey(ship.position));
```

Logistics pair key pattern:

```typescript
// src/client/game/logistics-ui.ts
const pairKey = (source: string, target: string): string =>
  `${source}->${target}`;
```

## Consistency Analysis

The serialization approach is consistent across the codebase:

- **All hex-to-key conversions** use the `hexKey()` function. No hand-written `"q,r"` formatting was found outside of `hexKey()` itself.
- **All key-to-hex conversions** use `parseHexKey()`.
- **The branded type** prevents accidental string/HexKey mixing at compile time.
- **No object references as keys**: All Maps and Records use string keys, not `HexCoord` objects.
- **The `lastSelectedHex` field** on `PlanningState` is typed as `string | null` rather than `HexKey | null`. This is a minor typing inconsistency -- the value is always produced by `hexKey()` but the type does not enforce the brand.

The logistics module uses its own key format (`"sourceId->targetId"`) for transfer pair keys, which is a different serialization pattern but follows the same principle of string-key-based lookup.

## Completeness Check

The pattern is well-applied:

- **Branded type safety**: The `HexKey` brand prevents most accidental misuse.
- **Single serialization function**: `hexKey()` is the only way to produce a `HexKey`, ensuring consistent format.
- **Deserialization available**: `parseHexKey()` exists for cases where the coordinate needs to be reconstructed.

Potential improvements:

- **Type the `lastSelectedHex`** as `HexKey | null` instead of `string | null` in `PlanningState` for stronger type safety.
- **The `asHexKey()` escape hatch** is documented as "use only at serialization boundaries and in tests," which is appropriately restrictive.

## Related Patterns

- **Record-Based Type Mapping** (Pattern 46): `Record<HexKey, boolean>` and `Map<HexKey, MapHex>` use these serialized keys.
- **Planning Store** (Pattern 37): Uses hex key strings for `lastSelectedHex` and ship ID strings as Map keys.
