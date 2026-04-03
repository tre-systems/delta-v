# Branded Types

## Category

Type System & Data Flow

## Intent

Branded types (also called nominal or opaque types) prevent accidental
mixing of structurally identical types. A `HexKey` and a `RoomCode` are
both strings at runtime, but the type system treats them as incompatible.
This catches bugs like passing a room code where a hex key is expected,
without any runtime overhead.

## How It Works in Delta-V

TypeScript uses structural typing, so `string` is `string` everywhere.
Delta-V brands strings by intersecting `string` with a unique symbol
property that never exists at runtime:

```typescript
declare const __hexKeyBrand: unique symbol;
export type HexKey = string & { readonly [__hexKeyBrand]: never };
```

The `unique symbol` declaration creates a type that no other module can
reproduce, guaranteeing that `HexKey` is incompatible with plain `string`
or any other branded type. The `never` value type means the property
cannot actually be assigned -- it exists only in the type system.

Each branded type comes with:

1. **A constructor** that casts from `string` (e.g., `hexKey()`,
   `asRoomCode()`).
2. **A type guard** for runtime validation (e.g., `isRoomCode()`).
3. **A normalizer** that validates + normalizes in one step (e.g.,
   `normalizeRoomCode()`).

## Key Locations

| Branded Type | File | Pattern | Constructor |
|-------------|------|---------|-------------|
| `HexKey` | `src/shared/hex.ts:45-48` | `string & { [brand]: never }` | `hexKey()`, `asHexKey()` |
| `RoomCode` | `src/shared/ids.ts:1,4` | `string & { [brand]: never }` | `asRoomCode()` |
| `PlayerToken` | `src/shared/ids.ts:2,5` | `string & { [brand]: never }` | `asPlayerToken()` |

## Code Examples

### HexKey -- the most-used branded type

```typescript
// src/shared/hex.ts
declare const __hexKeyBrand: unique symbol;
export type HexKey = string & { readonly [__hexKeyBrand]: never };

// Safe constructor: serializes a HexCoord to its canonical string form
export const hexKey = ({ q, r }: HexCoord): HexKey => `${q},${r}` as HexKey;

// Escape hatch for trusted boundaries (serialization, tests)
export const asHexKey = (key: string): HexKey => key as HexKey;

// Inverse: parse back to a coordinate
export const parseHexKey = (key: HexKey): HexCoord => {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
};
```

`HexKey` is used pervasively as a Map key for the hex grid, in player
base arrays, destroyed asteroid/base tracking, and gravity choice records.

### RoomCode and PlayerToken -- session identity

```typescript
// src/shared/ids.ts
declare const __roomCodeBrand: unique symbol;
declare const __playerTokenBrand: unique symbol;

export type RoomCode = string & { readonly [__roomCodeBrand]: never };
export type PlayerToken = string & { readonly [__playerTokenBrand]: never };

const ROOM_CODE_PATTERN = /^[A-Z0-9]{5}$/;
const PLAYER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const asRoomCode = (value: string): RoomCode => value as RoomCode;

export const isRoomCode = (value: unknown): value is RoomCode =>
  typeof value === 'string' && ROOM_CODE_PATTERN.test(value);

export const normalizeRoomCode = (value: unknown): RoomCode | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toUpperCase();
  return isRoomCode(normalized) ? asRoomCode(normalized) : null;
};
```

The normalize pattern is particularly nice: it combines validation,
normalization (uppercasing), and branding in one step, returning `null`
for invalid input.

### Usage in the protocol types

```typescript
// src/shared/types/protocol.ts
export type S2C =
  | {
      type: 'welcome';
      playerId: PlayerId;
      code: RoomCode;
      playerToken: PlayerToken;
    }
  // ...
```

The branded types flow through the protocol layer, so the welcome message
carries typed room codes and player tokens rather than plain strings.

## Consistency Analysis

**Brand declaration is consistent**: All three branded types use the same
`string & { readonly [brand]: never }` pattern with `declare const`
symbols.

**Constructor naming varies**:

- `HexKey`: `hexKey()` (functional constructor) and `asHexKey()` (escape hatch)
- `RoomCode`: `asRoomCode()` only (no safe constructor from structured data)
- `PlayerToken`: `asPlayerToken()` only

The difference makes sense: `hexKey()` constructs from a `HexCoord`
(structured data), while room codes and player tokens are always created
from raw strings. The `as*` prefix signals an unsafe cast.

**Validation coverage**:

- `RoomCode` and `PlayerToken` have both `is*` guards and `normalize*`
  functions.
- `HexKey` has the safe `hexKey()` constructor and `parseHexKey()` inverse
  but no `isHexKey()` runtime guard. The `asHexKey()` escape hatch is used
  in protocol parsing and tests.

## Completeness Check

### Missing branded types

Several string-valued identifiers in the codebase are plain `string` where
branding could prevent bugs:

- **Ship IDs** (`ship.id: string`) -- used pervasively in combat targeting,
  movement, and logistics. Mixing a ship ID with a hex key or ordnance ID
  would be caught by branding.

- **Ordnance IDs** (`ordnance.id: string`) -- similar to ship IDs. The
  engine generates them with a `ord${n}` pattern but they are typed as
  plain `string`.

- **Game IDs** (`state.gameId: string`) -- unique per game session.

- **Body names** (`body.name: string`, `hex.base.bodyName: string`) --
  celestial body names are used as lookup keys throughout the map system.

### Unsafe casts

The `as HexKey` cast in `asHexKey()` bypasses validation entirely. This
is documented as intentional ("Use only at serialization boundaries and
in tests") but there are several call sites in production code (e.g.,
protocol parsing for `weakGravityChoices`) that could benefit from
validation.

The pattern `key as HexKey` also appears in:

- `protocol.ts:105` (weak gravity choices parsing)
- Various map construction code

### Missing `isHexKey` guard

Unlike `RoomCode` and `PlayerToken`, `HexKey` has no runtime validation
guard (`isHexKey`). Adding one that checks the `q,r` format would make
`asHexKey` safer at serialization boundaries:

```typescript
// Suggested addition
export const isHexKey = (value: unknown): value is HexKey =>
  typeof value === 'string' && /^-?\d+,-?\d+$/.test(value);
```

## Related Patterns

- **Discriminated Unions** (pattern 23) -- branded types complement
  discriminated unions by providing nominal typing for primitive values.
- **Guard Clause / Validation** (pattern 26) -- the `isRoomCode` /
  `normalizeRoomCode` pattern is a specialized form of input validation.
- **Data-Driven Lookup Tables** (pattern 28) -- `HexKey` is the key
  type for the hex map's lookup table (`Map<HexKey, MapHex>`).
