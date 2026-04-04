# Scenarios & Config

Patterns for AI configuration, preset registries, scenario definition, feature flags, and map generation. The architecture doc covers the high-level scenario-driven design and `ScenarioRules` overview; this document captures implementation specifics, config shapes, and type safety gaps.

## Strategy Config Scoring (11)

Key files: `src/shared/ai/config.ts`, `src/shared/ai/scoring.ts`, `src/shared/ai/astrogation.ts`, `src/shared/ai/combat.ts`, `src/shared/ai/ordnance.ts`, `src/shared/ai/logistics.ts`

`AIDifficultyConfig` has ~70+ numeric fields. All scoring functions take `cfg: AIDifficultyConfig` as a parameter (pure, no globals). The `scoreCourse` combiner sums independent strategy scores linearly.

Key difficulty differences:

| Parameter | Easy | Normal | Hard |
|-----------|------|--------|------|
| `multiplier` | 0.7 | 1.0 | 1.5 |
| `ordnanceSkipChance` | 0.3 | 0 | 0 |
| `singleAttackOnly` | true | false | false |
| `minRollThreshold` | 3 | 1 | 0 |
| `torpedoRange` | 8 | 8 | 12 |
| `mineRange` | 4 | 4 | 6 |

Most parameters (navigation weights, combat positioning, fuel seeking) are identical across all three difficulties.

Hardcoded behavior that should be in config:
- Map boundary avoidance weights (`severity * severity * 25`, `edgeDist < 5/8`)
- Easy-mode random burn override probability (`rng() < 0.25`)
- Passenger escort emergency weights (`* 5`, `* 180`, `* 10`)
- Hard-mode target distribution gated by `difficulty === 'hard'` string comparison instead of a config flag like `distributeInterceptTargets`

No runtime config tuning mechanism -- all configs are compile-time constants.

## Multiton Preset Registries (22)

Key files: `src/shared/scenario-definitions.ts`, `src/shared/ai/config.ts`, `src/shared/ai/types.ts`, `src/shared/map-layout.ts`

Three registries with different type safety levels:

| Registry | Key Type | Exhaustiveness | Lookup Safety |
|----------|----------|----------------|---------------|
| `AI_CONFIG` | `Record<AIDifficulty, ...>` (closed union) | Compiler-enforced | Always returns value |
| `SCENARIOS` | `Record<string, ...>` (open) | Not enforced | May return `undefined` |
| `BODY_DEFS` | Array index | N/A | N/A |

`SCENARIOS` lookup sites defensively fallback: `SCENARIOS[scenario] ?? SCENARIOS.biplanetary`. A `ScenarioKey` union type would eliminate magic strings and fallbacks.

Magic string proliferation: scenario keys appear as string literals in tests, session model defaults, UI routing, and telemetry. Renaming a scenario would silently break all these sites. Same issue for scenario tags (`'Beginner'`, `'Asymmetric'`, `'Combat'`, etc.) and body names (`'Mars'`, `'Venus'`, `'Terra'`).

AI difficulty type is well-contained in shared modules but the client UI layer weakens it: `src/client/ui/events.ts` redefines `AIDifficulty`, and `src/client/game/ui-event-router.ts` uses inline `'easy' | 'normal' | 'hard'` instead of importing the shared alias.

AI config duplication: `normal` and `easy` share most values, `hard` differs in only a handful of fields. A spread-based approach (`hard: { ...normal, multiplier: 1.5, torpedoRange: 12 }`) would make actual differences visible and reduce maintenance.

## Scenario Rules as Feature Flags (61)

Key files: `src/shared/types/domain.ts` (`ScenarioRules`), `src/shared/types/scenario.ts`, `src/shared/scenario-definitions.ts`

13 optional flags on `ScenarioRules`, all with implicit falsy defaults. Adding a new flag does not require updating existing scenarios. Engine code reads from `state.scenarioRules` (never checks scenario name). Client UI reads the same flags for button visibility and option rendering.

Current flag set: `allowedOrdnanceTypes`, `availableFleetPurchases`, `planetaryDefenseEnabled`, `hiddenIdentityInspection`, `escapeEdge` (`'any' | 'north'`), `combatDisabled`, `checkpointBodies`, `sharedBases`, `logisticsEnabled`, `passengerRescueEnabled`, `targetWinRequiresPassengers`, `reinforcements`, `fleetConversion`.

Gaps:
- No schema validation at game creation time for flag consistency (e.g., `targetWinRequiresPassengers` without a `targetBody` set)
- No conflicting-flag detection
- Growing flag count (13) -- if it expands further, grouping into sub-objects (`combatRules`, `logisticsRules`) would help organization

## Config-Driven Scenarios (62)

Key files: `src/shared/scenario-definitions.ts`, `src/shared/types/scenario.ts`, `src/shared/map-layout.ts`

9 scenarios defined as declarative `ScenarioDefinition` objects: `biplanetary`, `escape`, `evacuation`, `convoy`, `duel`, `blockade`, `interplanetaryWar`, `fleetAction`, `grandTour`. None contain procedural logic.

Ship positions use body-relative helpers: `getBodyOffset(bodyName, dq, dr)` computes absolute hex coordinates from a body's centre, `getControlledBaseHexes(...bodyNames)` returns base hexes. This means if a body moves, all scenario ships move with it.

`createGame()` snapshots the scenario definition into `GameState` at creation time -- the engine never references the original definition after that. This protects in-progress games from scenario definition changes.

Minor inconsistency: some scenarios set `startLanded: false` explicitly while others omit it (defaults to `false`).

Gaps:
- No compile-time or runtime validation that scenario definitions are self-consistent (e.g., `targetBody` exists on the map, ship positions are in valid hexes)
- No scenario versioning for in-progress games (mitigated by snapshotting into `GameState`)
- All scenarios use the same map -- no per-scenario map support

## Data-Driven Maps (63)

Key files: `src/shared/map-layout.ts`, `src/shared/map-data.ts`

11 bodies in `BODY_DEFS`: Sol, Mercury, Venus, Terra, Luna, Mars, Ceres, Jupiter, Io, Callisto, Ganymede. Each `BodyDefinition` specifies `center`, `surfaceRadius`, `gravityRings`, `gravityStrength` (`'full' | 'weak'`), `destructive`, `baseDirections`, `color`, `renderRadius`.

`buildSolarSystemMap()` generates from definitions:
- Surface hexes (`planetSurface`/`sunSurface`)
- Gravity rings with direction vectors pointing toward body centre
- Orbital bases at positions derived from `baseDirections`
- Asteroid belt hexes from explicit coordinate arrays (not generated from formula -- irregular shapes)

`BODY_DEF_BY_NAME` lookup map derived from the array at module load time.

Gaps:
- Single map only -- architecture supports per-scenario maps in theory (map is a parameter to engine functions) but no infrastructure exists
- No programmatic map validation for overlapping bodies, gravity conflicts, or unreachable bases
- Map bounds are hardcoded constants rather than computed from body positions
- Asteroid belt and Clandestine Base use hardcoded coordinates, breaking the declarative pattern

## Cross-Pattern Type Safety Summary

The biggest consistency gap across these patterns is untyped string keys. A unified effort to introduce union types for scenario keys, body names, scenario tags, and ship types would prevent silent breakage from renames and typos. The `AI_CONFIG` registry demonstrates the target pattern: closed union key + `Record` = compiler-enforced exhaustiveness with no fallback lookups needed.
