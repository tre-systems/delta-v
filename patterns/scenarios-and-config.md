# Scenarios & Config Patterns

How Delta-V varies behavior across scenarios and difficulty levels without branching engine code. [SPEC.md](../docs/SPEC.md) describes the nine shipped scenarios; this chapter walks through the config patterns that drive their differences.

Each section: the pattern, a minimal example, where it lives, and why this shape.

---

## AI Config as Weights, Not Code

**Pattern.** The AI doesn't have `if (difficulty === 'hard')` branches. Instead, a flat record of ~60 numeric weights and boolean flags drives pure scoring functions. Difficulty presets and per-scenario overrides adjust the weights; the logic stays identical.

**Minimal example.**

```ts
// Config type — data, not class hierarchies:
interface AIDifficultyConfig {
  multiplier: number;                  // global scaling
  escapeDistWeight: number;
  combatClosingWeight: number;
  combatCloseBonus: number;
  singleAttackOnly: boolean;
  …60ish more fields
}

// Scoring — pure, takes config:
const score = scoreCourse(ship, course, map, cfg);
//  = scoreNavigation(…, cfg)
//  + scoreEscape(…, cfg)
//  + scoreRaceDanger(…, cfg)
//  + scoreGravityLookAhead(…, cfg)
//  + scoreCombatPositioning(…, cfg)

// Orchestration — evaluate all 7 burn options, pick highest score:
const candidates = enumerateBurnOptions(ship);
const best = maxBy(candidates, (c) => scoreCourse(ship, c, map, cfg));
```

**Where it lives.** Config types and presets: `src/shared/ai/config.ts`. Scoring functions: `src/shared/ai/scoring.ts`. Orchestration: `src/shared/ai/index.ts`. Per-phase decisions: `src/shared/ai/{astrogation,combat,ordnance,logistics}.ts`.

**Why this shape.**

- **New scoring dimensions = new function + new config key.** No existing code changes. This is the [Strategy pattern](https://refactoring.guru/design-patterns/strategy) expressed as data.
- **Difficulty tuning is pure data.** Adjusting `hard` weights doesn't touch any function — just change the record.
- **Testable in isolation.** Each score function is pure; invariants like "more hard than normal makes the AI close faster" are easy property tests.

---

## Scenario-Scoped AI Overrides

**Pattern.** `ScenarioRules.aiConfigOverrides` is a partial `AIDifficultyConfig`. At every AI call site, `resolveAIConfig(difficulty, overrides)` merges the scenario override over the difficulty preset. Un-listed knobs fall through unchanged.

**Minimal example.**

```ts
// Duel's ScenarioRules:
aiConfigOverrides: {
  combatClosingWeight: 1,     // default is 3
  combatCloseBonus: 10,       // default is 40
}

// Every AI call site:
const cfg = resolveAIConfig(difficulty, state.scenarioRules?.aiConfigOverrides);
aiAstrogation(state, playerId, map, cfg);
```

**Where it lives.** Helper in `src/shared/ai/config.ts::resolveAIConfig`. Field definition on `ScenarioRules` in `src/shared/types/domain.ts`. Scenarios opt in via `src/shared/scenario-definitions.ts`. All four AI call sites (`aiAstrogation`, `aiOrdnance`, `aiCombat`, passenger-escort lookahead) thread it through.

**Why this shape.**

- **No special cases.** `if (scenario === 'duel')` never appears in AI code. The data decides.
- **Opt-in at the scenario.** Scenarios that don't set overrides behave exactly as before.
- **Measurable.** The duel pacing fix (2026-04-17) went through an empirical sweep harness — the mechanism was designed to support that loop.

---

## Preset Registries with Closed-Union Keys

**Pattern.** Fixed-cardinality config sets are indexed by closed-union string types so TypeScript can enforce exhaustiveness. Lookup always returns a value — no `?? fallback`.

**Minimal example.**

```ts
// Closed union:
type AIDifficulty = 'easy' | 'normal' | 'hard';

// Record keyed by the union:
const AI_CONFIG: Record<AIDifficulty, AIDifficultyConfig> = {
  easy:   { multiplier: 0.7, … },
  normal: { multiplier: 1.0, … },
  hard:   { multiplier: 1.5, … },
};

// Lookup is always safe:
const cfg = AI_CONFIG[difficulty];   // AIDifficultyConfig, never undefined
```

**Where it lives.** `AI_CONFIG` in `src/shared/ai/config.ts`. Pattern used anywhere a fixed enum maps to a value — e.g. `CLIENT_STATE_ENTRY_RULES` in the client.

**Why this shape.**

- **Compile-time exhaustiveness.** Adding a new `AIDifficulty` value fails to compile until `AI_CONFIG` has an entry.
- **No runtime fallbacks.** `AI_CONFIG[difficulty] ?? AI_CONFIG.normal` is a smell — the union should guarantee the key exists.

---

## Scenario Rules as Feature Flags

**Pattern.** Scenario-specific behavior is a flat bag of optional flags on `ScenarioRules`. Defaults are permissive — omitting a field means the feature is available. Engine code checks flags at decision points; client UI derives button visibility from the same flags.

**Minimal example.**

```ts
interface ScenarioRules {
  allowedOrdnanceTypes?: Ordnance['type'][];   // default: all
  availableFleetPurchases?: string[];          // default: all
  planetaryDefenseEnabled?: boolean;           // default: true
  combatDisabled?: boolean;                    // default: false
  logisticsEnabled?: boolean;                  // default: false
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  checkpointBodies?: string[];
  sharedBases?: string[];
  passengerRescueEnabled?: boolean;
  targetWinRequiresPassengers?: boolean;
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
  aiConfigOverrides?: Partial<AIDifficultyConfig>;
}

// Engine check at decision point:
if (state.scenarioRules.combatDisabled) {
  state.phase = 'logistics';
  return { state, engineEvents };
}
```

**Where it lives.** Type in `src/shared/types/domain.ts`. Scenario-level settings in `src/shared/scenario-definitions.ts`. Derived capability layer in `src/shared/scenario-capabilities.ts::deriveCapabilities`.

**Why this shape.**

- **New scenarios don't need engine changes.** Grand Tour disabled combat, Convoy enables logistics — each just sets a flag.
- **Permissive defaults keep simple scenarios minimal.** Bi-Planetary's rules object is short because it doesn't opt out of anything.
- **Client derivation stays consistent.** The ordnance HUD and ordnance-phase auto-selection read from the same helpers the engine uses — restricted scenarios don't drift between UI and server.

---

## Declarative Scenario Definitions

**Pattern.** Each scenario is a declarative object — ships, positions, rules, budget — with zero procedural logic. Positions use body-relative helpers so a body's coordinates can change without touching scenario definitions.

**Minimal example.**

```ts
export const SCENARIOS: Record<string, ScenarioDefinition> = {
  duel: {
    name: 'Duel',
    description: 'Two frigates near Mercury. Last ship standing wins.',
    players: [
      {
        ships: [{ type: 'frigate', position: getBodyOffset('Mercury', 2, 0), velocity: ZERO }],
        targetBody: '', homeBody: 'Mercury', escapeWins: false,
      },
      {
        ships: [{ type: 'frigate', position: getBodyOffset('Mercury', -2, 0), velocity: ZERO }],
        targetBody: '', homeBody: 'Mercury', escapeWins: false,
      },
    ],
    rules: {
      aiConfigOverrides: { combatClosingWeight: 1, combatCloseBonus: 10 },
    },
  },
  …
};

// createGame snapshots the definition into GameState:
const state = createGame(SCENARIOS[scenario], map, rng);
```

**Where it lives.** Definitions: `src/shared/scenario-definitions.ts`. Helpers: `getBodyOffset(bodyName, dq, dr)`, `getControlledBaseHexes(...bodyNames)` in `src/shared/map-layout.ts`.

**Why this shape.**

- **No conditionals at scenario start.** `createGame` is a simple "read the spec, build initial state" function.
- **Bodies can move.** A scenario that says "frigate 2 hexes east of Mercury" still works if Mercury's center hex shifts.
- **Snapshot into state.** Once `createGame` runs, `GameState` owns its ships — scenario definition edits don't affect in-progress games.

---

## Data-Driven Solar System Map

**Pattern.** The map is generated from 11 body definitions (`Sol`, `Mercury`, `Venus`, `Terra`, `Luna`, `Mars`, `Ceres`, `Jupiter`, `Io`, `Callisto`, `Ganymede`) plus asteroid-belt arrays. No hand-drawn hex tables.

**Minimal example.**

```ts
// A body is a declarative spec:
const MARS: BodyDefinition = {
  name: 'Mars',
  center: { q: 10, r: -3 },
  surfaceRadius: 1,
  gravityRings: 1,
  gravityStrength: 'full',
  destructive: false,
  baseDirections: [0, 1, 2, 3, 4, 5],   // all 6 sides have bases
  color: '#c1440e',
  renderRadius: 18,
};

// buildSolarSystemMap generates from these:
// - surface hexes (typed planetSurface or sunSurface)
// - gravity rings (direction vectors point toward body center)
// - orbital bases (placed per baseDirections)
// - asteroid belt hexes (from explicit coord arrays — irregular shapes don't formulate)
```

**Where it lives.** `src/shared/map-data.ts` (bodies, asteroid belt, map builder). `src/shared/map-layout.ts` (body offset helpers, controlled-base helpers).

**Why this shape.**

- **Editable without code changes.** Adjusting Mars's gravity strength is a one-field edit; engine never cares.
- **One source of truth.** Body-relative helpers work off the same definitions, so if a body moves, scenarios and renderer follow.
- **`BODY_DEF_BY_NAME` lookup** is built at module load from the array — readers, renderers, and the AI all query the same object.

---

## Cross-Pattern Theme: Untyped String Keys

The type-safety gap that cuts across these patterns is **untyped string keys**. `AI_CONFIG` shows the target: closed union key + `Record` = compiler-enforced exhaustiveness with no runtime fallback. A parallel rollout would:

- Introduce a `ScenarioKey = 'biplanetary' | 'escape' | …` union type.
- Introduce a `BodyName = 'Sol' | 'Mercury' | …` union type.
- Brand ship IDs, ordnance IDs, and game IDs (see the Type System chapter).

Each step would replace a defensive fallback with a compile error, catching renames and typos automatically.
