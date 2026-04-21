# Scenarios & Config Patterns

How Delta-V varies behavior across scenarios and difficulty levels without branching engine code. The spec document describes the nine shipped scenarios; this chapter walks through the config patterns that drive their differences.

Each section covers the pattern, a minimal example of how it works, where in the codebase it lives, and why it takes this shape.

---

## AI Config as Weights, Not Code

The AI does not use conditional branches to check whether the difficulty is hard or easy. Instead, a flat record of roughly sixty numeric weights and boolean flags drives pure scoring functions. Difficulty presets and per-scenario overrides adjust the weights; the logic itself stays identical across all difficulties.

The config type is pure data, not a class hierarchy. It holds fields like a global scaling multiplier, an escape-distance weight, a combat-closing weight, a combat-close bonus, and a flag for whether the AI may fire only a single weapon per turn, along with sixty or so additional fields.

The scoring side is a pure function that takes a ship, a candidate course, the map, and a config object and returns a numeric score. That total score is composed of sub-scores for navigation, escape, race danger, gravity look-ahead, and combat positioning — each sub-function also receiving the config so weights feed in uniformly.

The orchestration layer enumerates all seven possible burn options for a ship, scores each with the same function, and selects the one with the highest score.

The config types and presets live in the AI config module. The scoring functions live in the AI scoring module. The orchestration entry point lives in the AI index module. Per-phase decisions for astrogation, combat, ordnance, and logistics each live in their own AI sub-modules.

**Why this shape.**

- Adding a new scoring dimension means adding a new function and a new config key. No existing code changes. This is the Strategy pattern expressed as data rather than subclasses.
- Difficulty tuning is pure data. Adjusting the hard-difficulty weights does not touch any function — you change the record only.
- Each scoring function is pure, which makes it straightforward to write property tests asserting things like "a higher hard-difficulty weight causes the AI to close faster than normal."

---

## Scenario-Scoped AI Overrides

The scenario rules structure includes an optional AI config overrides field, which is a partial version of the full AI difficulty config. At every AI call site, a resolve-AI-config helper merges the scenario override on top of the difficulty preset. Fields not listed in the override fall through unchanged.

For example, the Duel scenario sets its combat-closing weight to one (the default is three) and its combat-close bonus to ten (the default is forty). Every AI call site calls the resolve-AI-config helper with the current difficulty and the scenario's override object, then passes the resulting merged config into whichever AI phase function it needs — astrogation, ordnance, combat, or the passenger-escort look-ahead.

The resolve-AI-config helper lives in the AI config module. The override field is defined on the scenario rules type in the domain types module. Scenarios opt in to overrides via the scenario definitions module. All four AI call sites thread the resolved config through.

**Why this shape.**

- There are no special cases. A check like "if the scenario is Duel" never appears in AI code. The data decides.
- Scenarios that do not set overrides behave exactly as before — the feature is opt-in at the scenario level.
- The mechanism was designed to support empirical sweep testing. The duel pacing fix went through such a harness, iterating over candidate weight values to find the best feel.

---

## Preset Registries with Closed-Union Keys

When a config set has a fixed, known number of entries, Delta-V indexes it by a closed-union string type so TypeScript can enforce exhaustiveness. A lookup into such a registry always returns a value — there is no fallback needed.

The AI difficulty type, for instance, is defined as the union of the three literal strings "easy", "normal", and "hard". The AI config registry is then declared as a record keyed by that union type, with an entry for each difficulty level providing its full config object. Looking up a difficulty in that record is always safe — the return type is the full config, never undefined.

This AI config registry lives in the AI config module. The same pattern appears anywhere a fixed enumeration maps to a value, such as the client state entry rules registry.

**Why this shape.**

- Adding a new difficulty value fails to compile until the registry has a corresponding entry. The compiler enforces exhaustiveness automatically.
- Runtime fallbacks like "use the normal config if the key is missing" are a code smell. A proper closed-union key guarantees the entry exists, so no fallback is needed.

---

## Scenario Rules as Feature Flags

Scenario-specific behavior is expressed as a flat bag of optional flags on the scenario rules type. Defaults are permissive — omitting a field means the feature is available. Engine code checks these flags at decision points, and client UI derives button visibility from the same flags.

The scenario rules type includes fields such as: an optional list of allowed ordnance types (default is all types); an optional list of available fleet purchases (default is all); an optional boolean for whether planetary defense is enabled (default true); an optional boolean for whether combat is disabled (default false); an optional boolean for whether logistics are enabled (default false); flags for hidden-identity inspection, escape-edge direction, checkpoint bodies, shared bases, passenger rescue, target-win-requires-passengers, reinforcement definitions, fleet conversion definitions, and AI config overrides.

At a decision point in the engine — for instance, when determining which phase to enter — the engine checks whether combat is disabled. If it is, the engine sets the phase to logistics and returns immediately.

The scenario rules type is defined in the domain types module. Scenario-level settings live in the scenario definitions module. A derived capability layer in the scenario capabilities module provides a helper called derive-capabilities that computes what the current scenario permits.

**Why this shape.**

- New scenarios do not need engine changes. The Grand Tour scenario disabled combat; the Convoy scenario enables logistics. Each just sets a flag.
- Permissive defaults keep simple scenarios minimal. The Bi-Planetary scenario's rules object is short because it does not opt out of anything.
- Client derivation stays consistent. The ordnance heads-up display and ordnance-phase auto-selection read from the same helpers the engine uses, so restricted scenarios do not drift between UI and server behavior.

---

## Declarative Scenario Definitions

Each scenario is a declarative object describing ships, positions, rules, and budget — with zero procedural logic. Positions use body-relative helpers so that if a body's coordinates change, the scenario definition does not need to be updated.

The scenarios registry maps scenario keys to scenario definition objects. Each definition includes a name, a description, and an array of player entries. Each player entry lists that player's ships with their type, position, and initial velocity; their target body; their home body; and whether escaping wins the game. It also includes a rules object that can hold any subset of the feature flags described above — for example, the Duel scenario sets its AI config overrides here.

A create-game function snapshots the definition into a game state object when a game starts.

The scenario definitions live in the scenario definitions module. Body-relative position helpers — including a body-offset helper that places a position a given number of hexes away from a named body, and a controlled-base-hexes helper — live in the map layout module.

**Why this shape.**

- There are no conditionals at scenario start. The create-game function simply reads the specification and builds the initial state.
- Because positions are body-relative, a scenario that places a frigate two hexes east of Mercury still works correctly if Mercury's center hex moves.
- Once create-game runs, the game state owns its ships. Editing a scenario definition does not affect games already in progress.

---

## Data-Driven Solar System Map

The map is generated from eleven body definitions — Sol, Mercury, Venus, Terra, Luna, Mars, Ceres, Jupiter, Io, Callisto, and Ganymede — plus asteroid-belt coordinate arrays. There are no hand-drawn hex tables.

Each body is a declarative specification. A body definition includes the body's name, its center hex coordinates, its surface radius, the number of gravity rings it exerts, its gravity strength, whether it is destructive to ships, which of its six sides have orbital bases, its display color, and its render radius in pixels.

The map builder generates from these definitions: surface hexes typed as planet-surface or sun-surface, gravity rings with direction vectors pointing toward the body center, orbital bases placed according to the base-directions field, and asteroid belt hexes drawn from explicit coordinate arrays (irregular shapes do not lend themselves to a formula).

The body definitions, asteroid belt data, and map builder all live in the map data module. Body offset helpers and controlled-base helpers live in the map layout module.

**Why this shape.**

- Adjusting Mars's gravity strength is a one-field edit; the engine never needs to change.
- Body-relative helpers work off the same definitions, so if a body moves, scenarios and the renderer follow automatically.
- A lookup table indexed by body name is built at module load time from the body definitions array. Renderers, the AI, and any other reader all query the same object.

---

## Cross-Pattern Theme: Untyped String Keys

The type-safety gap that cuts across these patterns is untyped string keys. The AI config registry shows the target state: a closed-union key paired with a record type gives compiler-enforced exhaustiveness with no runtime fallback needed.

A parallel rollout would introduce a scenario key union type covering all scenario names, a body name union type covering all eleven bodies, and branded identifier types for ship IDs, ordnance IDs, and game IDs — a topic covered in the Type System chapter.

Each step would replace a defensive runtime fallback with a compile error, catching renames and typos automatically.
