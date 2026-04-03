# Data-Driven Lookup Tables

## Category

Type System & Data Flow

## Intent

Game rules and parameters are encoded as typed constant lookup tables
rather than scattered through procedural code. This centralizes game data,
makes rules auditable against the rulebook, simplifies balancing changes,
and lets TypeScript enforce that every variant has an entry.

## How It Works in Delta-V

Delta-V encodes all game data as `Record<K, V>` constants or typed arrays,
indexed by the appropriate discriminant type (`ShipType`, `OrdnanceType`,
`OddsRatio`, etc.). The `Record` type ensures compile-time completeness:
adding a new `ShipType` variant without updating `SHIP_STATS` produces a
type error.

These tables serve as the single source of truth for:

- Ship capabilities and costs
- Ordnance properties
- Combat resolution
- Game timing constants
- Phase transitions

## Key Locations

| Table | File | Key Type | Value Type |
|-------|------|----------|------------|
| `SHIP_STATS` | `src/shared/constants.ts:81-212` | `ShipType` | `ShipStats` |
| `ORDNANCE_MASS` | `src/shared/constants.ts:223` | `OrdnanceType` | `number` |
| `GUN_COMBAT_TABLE` | `src/shared/combat.ts:38-46` | `[roll][odds]` | `number` |
| `OTHER_DAMAGE_TABLES` | `src/shared/combat.ts:54-59` | `OtherDamageSource` | `number[]` |
| `ODDS_RATIOS` | `src/shared/combat.ts:62` | index | `OddsRatio` |
| `PHASE_TRANSITIONS` | `src/shared/types/domain.ts:47-55` | `Phase` | `Phase[]` |
| `WARSHIP_TYPES` | `src/shared/constants.ts:22-28` | - | `Set<ShipType>` |
| `CIVILIAN_TYPES` | `src/shared/constants.ts:31-35` | - | `Set<ShipType>` |
| `BASE_CARRIER_TYPES` | `src/shared/constants.ts:38-39` | - | `Set<ShipType>` |

## Code Examples

### SHIP_STATS -- the master ship data table

```typescript
// src/shared/constants.ts
export const SHIP_STATS: Record<ShipType, ShipStats> = {
  transport: {
    name: 'Transport',
    combat: 1,
    defensiveOnly: true,
    fuel: 10,
    cargo: 50,
    cost: 10,
    canOverload: false,
    canLaunchTorpedoes: false,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  // ... entries for all 10 ship types
  orbitalBase: {
    name: 'Orbital Base',
    combat: 16,
    defensiveOnly: false,
    fuel: Infinity,
    cargo: Infinity,
    cost: 1000,
    canOverload: false,
    canLaunchTorpedoes: true,
    operatesAtD1: true,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
};
```

The `Record<ShipType, ShipStats>` type guarantees every ship type has a
stats entry. The `ShipStats` interface documents each field's role with
comments referencing the rulebook.

### GUN_COMBAT_TABLE -- 2D matrix lookup

```typescript
// src/shared/combat.ts
const GUN_COMBAT_TABLE: number[][] = [
  [0, 0, 0, 0, 0, 0], // roll <= 0
  [0, 0, 0, 0, 0, 2], // roll 1
  [0, 0, 0, 0, 2, 3], // roll 2
  [0, 0, 0, 2, 3, 4], // roll 3
  [0, 0, 2, 3, 4, 5], // roll 4
  [0, 2, 3, 4, 5, 6], // roll 5
  [1, 3, 4, 5, 6, 6], // roll 6+
];
```

Rows are modified die rolls (0 through 6+), columns are odds ratio
indices. Values encode damage: 0 = none, 1-5 = disabled turns,
6 = eliminated. The lookup function clamps input ranges:

```typescript
// src/shared/combat.ts
export const lookupGunCombat = (
  odds: OddsRatio,
  modifiedRoll: number,
): DamageResult => {
  const col = ODDS_RATIOS.indexOf(odds);
  const row = clamp(modifiedRoll, 0, 6);
  const value = GUN_COMBAT_TABLE[row][col];

  if (value === 0) return { type: 'none', disabledTurns: 0 };
  if (value === 6) return { type: 'eliminated', disabledTurns: 0 };
  return { type: 'disabled', disabledTurns: value };
};
```

### OTHER_DAMAGE_TABLES -- per-source damage columns

```typescript
// src/shared/combat.ts
const OTHER_DAMAGE_TABLES: Record<OtherDamageSource, number[]> = {
  torpedo: [0, 1, 1, 1, 2, 3],
  mine: [0, 0, 0, 0, 2, 2],
  asteroid: [0, 0, 0, 0, 1, 2],
  ram: [0, 0, 1, 1, 3, 5],
};
```

`Record<OtherDamageSource, number[]>` ensures every damage source has a
table. Adding a new source without a table entry is a compile error.

### PHASE_TRANSITIONS -- state machine as data

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

// Type-level successor lookup
export type PhaseSuccessor<P extends Phase> =
  (typeof PHASE_TRANSITIONS)[P][number];
```

This makes the game's state machine inspectable, testable, and
type-safe. The `PhaseSuccessor` utility type extracts valid next phases
at the type level, used by `transitionPhase` to enforce valid transitions.

### ORDNANCE_MASS -- simple property lookup

```typescript
// src/shared/constants.ts
export const ORDNANCE_MASS: Record<OrdnanceType, number> = {
  mine: 10,
  torpedo: 20,
  nuke: 20,
};
```

### Named constants for game rules

```typescript
// src/shared/constants.ts
export const DAMAGE_ELIMINATION_THRESHOLD = 6;
export const SHIP_DETECTION_RANGE = 3;
export const BASE_DETECTION_RANGE = 5;
export const VELOCITY_MODIFIER_THRESHOLD = 2;
export const BASE_COMBAT_ODDS = '2:1';
export const ANTI_NUKE_ODDS = '2:1';
export const BURN_FUEL_COST = 1;
export const OVERLOAD_TOTAL_FUEL_COST = 2;
export const LANDING_SPEED_REQUIRED = 1;
export const ORDNANCE_LIFETIME = 5;
```

## Consistency Analysis

**Strong consistency**: All game data is in `src/shared/constants.ts` or
`src/shared/combat.ts`. The engine never hardcodes ship stats, ordnance
properties, or combat results -- it always looks them up.

**Type safety**: `Record<K, V>` is used for all keyed tables, ensuring
compile-time completeness. The `Readonly` and `as const` modifiers
prevent accidental mutation.

**Lookup function discipline**: Combat tables are accessed through
dedicated lookup functions (`lookupGunCombat`, `lookupOtherDamage`)
that handle edge cases (clamping, index translation). Ship stats are
accessed directly via `SHIP_STATS[ship.type]`, which is safe because
the Record type guarantees the key exists.

## Completeness Check

### All game data appears to be in tables

- Ship stats: `SHIP_STATS` (all 10 types)
- Ordnance: `ORDNANCE_MASS`, `ORDNANCE_LIFETIME`
- Combat: `GUN_COMBAT_TABLE`, `OTHER_DAMAGE_TABLES`, odds ratios
- Phase machine: `PHASE_TRANSITIONS`
- Detection: `SHIP_DETECTION_RANGE`, `BASE_DETECTION_RANGE`
- Movement: `BURN_FUEL_COST`, `OVERLOAD_TOTAL_FUEL_COST`, `LANDING_SPEED_REQUIRED`

### Potential hardcoded values

- **Protocol bounds**: Constants like `MAX_FLEET_PURCHASES = 64`,
  `MAX_ASTROGATION_ORDERS = 64` in `protocol.ts` are defined locally
  rather than in `constants.ts`. These are protocol limits rather than
  game rules, so the separation is reasonable.

- **Heroism threshold**: The heroism bonus (`+1`) and the condition
  ("D2 or better at underdog odds") are hardcoded in `combat.ts` rather
  than in a table. Since heroism is a simple rule rather than tabular
  data, this is acceptable.

- **Map margins**: The out-of-bounds margin (`oobMargin = 2` in
  `ordnance.ts`, `margin = 3` in `util.ts`) are hardcoded. These could
  be constants in `constants.ts`.

- **Animation durations**: `MOVEMENT_ANIM_DURATION` and
  `CAMERA_LERP_SPEED` are in `constants.ts`, which is good. However,
  toast display durations (e.g., `4000` ms) are hardcoded in the
  renderer.

### GUN_COMBAT_TABLE typing

The table is typed as `number[][]` rather than a more specific type. A
tuple type or a branded damage value could make the encoding more
explicit, though the lookup functions provide a safe abstraction.

## Related Patterns

- **Branded Types** (pattern 27) -- `HexKey` is the key type for the
  hex map lookup table.
- **Discriminated Unions** (pattern 23) -- `ShipType`, `OrdnanceType`,
  and `Phase` are literal union types that serve as table keys.
- **Utility Type Patterns** (pattern 30) -- `Readonly<Record<...>>` is
  used to make tables immutable.
