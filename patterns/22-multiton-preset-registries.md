# Multiton (Preset Registries)

## Category

Creational

## Intent

Provide a fixed set of named, pre-configured instances (presets) through a
keyed registry so that the rest of the codebase accesses them by key rather
than constructing them ad-hoc. This ensures each preset is defined once,
eliminates construction duplication, and makes the set of valid keys
statically discoverable.

## How It Works in Delta-V

Delta-V uses module-level `Record` or `Map` constants as multiton registries.
Each registry maps a known key to a fully-configured value object. The two
primary registries are:

### SCENARIOS Registry

`SCENARIOS` is a `Record<string, ScenarioDefinition>` that defines every
playable game scenario. Each entry fully specifies player ships, positions,
velocities, target bodies, bases, optional rules, and starting credits.

```ts
// src/shared/scenario-definitions.ts:3
export const SCENARIOS: Record<string, ScenarioDefinition> = {
```

The registry contains 9 scenarios: `biplanetary`, `escape`, `evacuation`,
`convoy`, `duel`, `blockade`, `interplanetaryWar`, `fleetAction`, and
`grandTour`.

Scenarios are looked up by string key throughout the codebase:

```ts
// src/client/game/main-session-network.ts:70
  return SCENARIOS[scenario] ?? SCENARIOS.biplanetary;
```

```ts
// src/client/game/main-session-shell.ts:244
        SCENARIOS[args.ctx.scenario] ?? SCENARIOS.biplanetary,
```

Both lookup sites use a fallback to `SCENARIOS.biplanetary` to handle unknown
keys safely.

### AI_CONFIG Registry

`AI_CONFIG` is a `Record<AIDifficulty, AIDifficultyConfig>` that maps each
difficulty level to a complete set of AI tuning parameters (80+ numeric
weights).

```ts
// src/shared/ai/config.ts:81
export const AI_CONFIG: Record<AIDifficulty, AIDifficultyConfig> = {
```

The `AIDifficulty` type is a string union:

```ts
// src/shared/ai/types.ts:1
export type AIDifficulty = 'easy' | 'normal' | 'hard';
```

AI modules look up the config at the start of each decision:

```ts
// src/shared/ai/combat.ts:39
  const cfg = AI_CONFIG[difficulty];
```

```ts
// src/shared/ai/astrogation.ts:243
  const cfg = AI_CONFIG[difficulty];
```

```ts
// src/shared/ai/ordnance.ts:23
  const cfg = AI_CONFIG[difficulty];
```

### BODY_DEFS (Map Layout)

A third registry exists as a module-private array in `src/shared/map-layout.ts`:

```ts
// src/shared/map-layout.ts:24
const BODY_DEFS: BodyDefinition[] = [
```

This defines every celestial body (Sol, Mercury, Venus, Terra, Luna, Mars,
Jupiter, Io, Callisto) with positions, gravity, colors, and base directions.
Unlike `SCENARIOS` and `AI_CONFIG`, this is an array rather than a keyed
record, but it serves the same multiton purpose -- a fixed set of
pre-configured objects that define the game world.

## Key Locations

| Registry | File | Line | Key Type |
|---|---|---|---|
| `SCENARIOS` | `src/shared/scenario-definitions.ts` | 3 | `string` |
| `AI_CONFIG` | `src/shared/ai/config.ts` | 81 | `AIDifficulty` |
| `BODY_DEFS` | `src/shared/map-layout.ts` | 24 | array index |
| `AIDifficulty` type | `src/shared/ai/types.ts` | 1 | -- |
| `AIDifficultyConfig` interface | `src/shared/ai/config.ts` | 3-78 | -- |
| `ScenarioDefinition` interface | `src/shared/types/scenario.ts` | 19-28 | -- |
| Re-export barrel | `src/shared/map-data.ts` | 7 | -- |

## Code Examples

### Scenario definition structure

```ts
// src/shared/scenario-definitions.ts:5-37
  biplanetary: {
    name: 'Bi-Planetary',
    tags: ['Beginner'],
    description: '1v1 corvettes race to land on the ' + "opponent's world",
    players: [
      {
        ships: [
          {
            type: 'corvette',
            position: { q: -9, r: -5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
        targetBody: 'Venus',
        homeBody: 'Mars',
        bases: getControlledBaseHexes('Mars'),
        escapeWins: false,
      },
      // ...player 2...
    ],
  },
```

Scenarios reference helper functions like `getControlledBaseHexes` and
`getBodyOffset` from `map-layout.ts` to compute positions relative to
celestial bodies. This keeps scenario definitions readable while still
resolving to concrete hex coordinates.

### AI config with difficulty-specific tuning

```ts
// src/shared/ai/config.ts:82-137
  easy: {
    multiplier: 0.7,
    // ...80+ tuning parameters...
    ordnanceSkipChance: 0.3,
    minRollThreshold: 3,
    singleAttackOnly: true,
  },
```

Key differences between difficulties:

- `easy` has `multiplier: 0.7`, `ordnanceSkipChance: 0.3` (30% chance to skip
  ordnance), `singleAttackOnly: true`, and `minRollThreshold: 3`
- `normal` has `multiplier: 1.0`, `ordnanceSkipChance: 0`, and
  `singleAttackOnly: false`
- `hard` has `multiplier: 1.5`, larger `torpedoRange: 12` (vs 8), larger
  `mineRange: 6` (vs 4), and `minRollThreshold: 0`

Most parameters (navigation weights, combat positioning, fuel seeking) are
identical across all three difficulties. The differences are concentrated in
the global multiplier, ordnance ranges, skip probabilities, and attack
constraints.

### Type-safe lookup (AI_CONFIG)

Because `AI_CONFIG` uses `Record<AIDifficulty, AIDifficultyConfig>` and
`AIDifficulty` is a closed union type (`'easy' | 'normal' | 'hard'`), TypeScript
guarantees:

- Every difficulty level has a config entry (no missing keys)
- Lookups with `AI_CONFIG[difficulty]` where `difficulty: AIDifficulty` always
  return a valid config (no `undefined`)
- Adding a new difficulty to the union type would cause a compile error until
  a config entry is added

### Non-type-safe lookup (SCENARIOS)

`SCENARIOS` uses `Record<string, ScenarioDefinition>`, meaning:

- Any string is a valid key at the type level
- Lookups can return `undefined` at runtime
- The set of valid scenario keys is not captured in the type system

This is why lookup sites defensively fallback:

```ts
SCENARIOS[scenario] ?? SCENARIOS.biplanetary
```

## Consistency Analysis

**Mixed type safety.** The two main registries represent opposite ends of the
type-safety spectrum:

| Aspect | AI_CONFIG | SCENARIOS |
|---|---|---|
| Key type | Closed union (`AIDifficulty`) | Open `string` |
| Exhaustiveness | Compiler-enforced | Not enforced |
| Lookup safety | Always returns value | May return `undefined` |
| Fallback needed | No | Yes (uses `?? biplanetary`) |

Both registries are defined as frozen-by-convention module constants (not
`Object.freeze`d, but never mutated). The `createGame` builder deep-copies
scenario data before use, protecting against accidental mutation.

**String key usage for scenarios is widespread.** Scenario keys appear as
string literals throughout the codebase -- in tests (`'biplanetary'`, `'duel'`,
`'escape'`), in session model defaults (`scenario: 'biplanetary'`), in UI
event routing, and in telemetry. These are all magic strings that would break
silently if a scenario were renamed.

**AI difficulty strings are better contained.** The `AIDifficulty` type is used
consistently in function signatures, which means misspelling a difficulty value
causes a type error. However, the UI layer still uses inline string literals
(`'easy' | 'normal' | 'hard'`) in some event type definitions rather than
referencing the `AIDifficulty` type.

## Completeness Check

1. **SCENARIOS should use a union key type.** The biggest improvement would be
   to define a `ScenarioKey` type as a union of literal strings and change
   `SCENARIOS` to `Record<ScenarioKey, ScenarioDefinition>`. This would:
   - Make all scenario string references type-checked
   - Eliminate the need for fallback lookups
   - Catch renames at compile time
   - Example: `type ScenarioKey = 'biplanetary' | 'escape' | 'duel' | ...`

2. **Scenario tags are magic strings.** Tags like `'Beginner'`, `'Asymmetric'`,
   `'Combat'`, `'Speed'`, `'Epic'`, `'Fleet'`, `'Race'`, `'Escort'` are plain
   strings with no shared type. A `ScenarioTag` union type would prevent typos.

3. **Body names are untyped strings throughout.** Values like `'Mars'`,
   `'Venus'`, `'Terra'`, `'Luna'` appear in scenario definitions, rule
   configurations, and AI logic as plain strings. A `BodyName` union type
   derived from `BODY_DEFS` would add safety.

4. **Ship type strings are used in scenarios.** Types like `'corvette'`,
   `'frigate'`, `'corsair'`, `'transport'` appear in scenario ship definitions.
   These are likely typed elsewhere (via `SHIP_STATS`), but the scenario
   definitions reference them as strings.

5. **AI config duplication.** The `normal` and `easy` configs share most values,
   and `hard` differs from `normal` in only a handful of fields. A
   spread-based approach (`hard: { ...normal, multiplier: 1.5, torpedoRange: 12 }`)
   would reduce duplication and make the actual differences more visible.

6. **No runtime validation of registry keys.** When a scenario key arrives from
   the network or URL parameters, it is looked up with a string fallback rather
   than validated against a known set. A validation function like
   `isValidScenario(key): key is ScenarioKey` would be more robust.

## Related Patterns

- **Factory Functions** -- Factory functions consume registry values during
  construction (e.g., `createGame` receives a `ScenarioDefinition` from
  `SCENARIOS`).
- **Builder (Game Setup)** -- The builder pattern in `createGame` is the
  primary consumer of `SCENARIOS`, transforming a scenario definition into a
  live `GameState`.
- **Dependency Injection** -- AI modules receive `difficulty: AIDifficulty`
  as a parameter and look up `AI_CONFIG` internally rather than receiving the
  config object directly. This is a minor DI gap -- injecting the config
  would make testing easier.
