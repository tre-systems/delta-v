# Builder (Game Setup)

## Category

Creational

## Intent

Assemble a complex, deeply nested `GameState` object from a scenario definition
and map data through a multi-step construction process. The builder isolates
validation, resolution of starting positions, base assignment, ship creation,
identity assignment, and rule propagation into discrete steps so that the final
state object is always internally consistent.

## How It Works in Delta-V

The `createGame` function in `src/shared/engine/game-creation.ts` is the sole
entry point for constructing a new `GameState`. It is not a classic GoF Builder
with a separate Director, but it follows the builder intent: a single function
orchestrates multiple construction phases, each delegated to a focused helper,
producing a complex immutable-by-convention result.

### Construction Phases

The build proceeds through these stages:

1. **Validation** -- `assertScenarioPlayerCount` verifies the scenario defines
   exactly 2 players. This is a precondition gate; construction fails fast if
   the invariant is violated.

2. **Base resolution** -- `resolveControlledBases` maps each player's declared
   bases (or home body) to concrete `HexKey` values on the map. Shared bases
   (for race scenarios like Grand Tour) are then merged into both players'
   base lists.

3. **Ship construction** -- Each scenario ship definition is expanded into a
   full `Ship` object. `resolveStartingPlacement` determines the starting hex
   and lifecycle (active vs landed) through a fallback chain: explicit
   position with base -> player's first base -> body hex -> home body lookup.
   Ship stats are pulled from the `SHIP_STATS` constant, gravity effects are
   conditionally initialised, and passenger counts are applied.

4. **Identity assignment** -- For hidden-identity scenarios (like Escape),
   one ship per player is randomly designated as the fugitive via
   `randomChoice`.

5. **Rule propagation** -- Scenario rules are deep-copied into
   `scenarioRules`, spreading optional fields only when present. This includes
   ordnance types, fleet purchases, planetary defense, checkpoint bodies,
   shared bases, reinforcements, and fleet conversion rules.

6. **State assembly** -- All pieces are combined into the final `GameState`
   literal, including derived values like the starting phase
   (fleetBuilding vs astrogation based on whether starting credits exist).

### Function Signature

```ts
// src/shared/engine/game-creation.ts:133-145
export const createGame = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
  gameCode: string,
  findBaseHex: (
    map: SolarSystemMap,
    bodyName: string,
  ) => {
    q: number;
    r: number;
  } | null,
  rng: () => number = Math.random,
): GameState => {
```

The `findBaseHex` callback is injected rather than imported, keeping the pure
game engine decoupled from map layout concerns. The `rng` parameter enables
deterministic testing of identity assignment.

## Key Locations

| Component | File | Lines |
|---|---|---|
| `createGame` | `src/shared/engine/game-creation.ts` | 133-335 |
| `assertScenarioPlayerCount` | `src/shared/engine/game-creation.ts` | 64-71 |
| `resolveControlledBases` | `src/shared/engine/game-creation.ts` | 14-28 |
| `resolveStartingPlacement` | `src/shared/engine/game-creation.ts` | 73-128 |
| `getScenarioStartingCredits` | `src/shared/engine/game-creation.ts` | 30-40 |
| `getStartingVisitedBodies` | `src/shared/engine/game-creation.ts` | 42-62 |
| `ScenarioDefinition` type | `src/shared/types/scenario.ts` | 19-28 |
| `SCENARIOS` registry | `src/shared/scenario-definitions.ts` | 3-393 |

## Code Examples

### Base resolution with shared base merging

```ts
// src/shared/engine/game-creation.ts:147-164
  const playerBases = scenario.players.map((player) =>
    resolveControlledBases(player, map),
  );
  // Shared bases: add fuel-body bases to both players
  // (Grand Tour race)
  if (scenario.rules?.sharedBases) {
    const sharedBaseKeys = [...map.hexes.entries()]
      .filter(
        ([, hex]) =>
          hex.base && scenario.rules?.sharedBases?.includes(hex.base?.bodyName),
      )
      .map(([key]) => key);
    for (const bases of playerBases) {
      for (const key of sharedBaseKeys) {
        if (!bases.includes(key)) bases.push(key);
      }
    }
  }
```

### Ship construction with placement resolution

```ts
// src/shared/engine/game-creation.ts:165-215
  const ships: Ship[] = scenario.players.flatMap((player, p) =>
    player.ships.map((def, s) => {
      const playerIdx = p as PlayerId;
      const stats = SHIP_STATS[def.type];
      const { position, lifecycle } = resolveStartingPlacement(
        def,
        player,
        playerBases[p],
        map,
        findBaseHex,
      );
      // ...gravity, passengers, full Ship object...
      return {
        id: `p${p}s${s}`,
        type: def.type,
        owner: playerIdx,
        // ...20+ fields...
      };
    }),
  );
```

Ship IDs are deterministically generated from player index and ship index
(`p0s0`, `p0s1`, `p1s0`, etc.).

### Starting placement fallback chain

```ts
// src/shared/engine/game-creation.ts:73-128
const resolveStartingPlacement = (
  def: ScenarioDefinition['players'][number]['ships'][number],
  player: ScenarioDefinition['players'][number],
  playerBases: HexKey[],
  map: SolarSystemMap,
  findBaseHex: (...) => { q: number; r: number } | null,
): { position: { q: number; r: number }; lifecycle: 'active' | 'landed' } => {
  const shouldLand = def.startLanded !== false;
  if (!shouldLand) {
    return { position: { ...def.position }, lifecycle: 'active' };
  }
  const defHex = map.hexes.get(hexKey(def.position));
  if (defHex?.base) {
    return { position: { ...def.position }, lifecycle: 'landed' };
  }
  if (playerBases[0]) {
    return { position: parseBaseKey(playerBases[0]), lifecycle: 'landed' };
  }
  // ...further fallbacks to body hex, then home body...
```

Four fallback levels ensure every ship gets a valid starting position. This is
a key robustness feature -- scenario authors only need to specify approximate
positions and the builder resolves them to valid hexes.

### Phase determination from credits

```ts
// src/shared/engine/game-creation.ts:238-240
  const hasFleetBuilding = ([0, 1] as PlayerId[]).some(
    (playerId) => (getScenarioStartingCredits(scenario, playerId) ?? 0) > 0,
  );
```

The initial game phase is derived from the scenario data, not specified
explicitly. This ensures fleet-building scenarios always start in the correct
phase.

## Consistency Analysis

**Well-structured with clear separation.** Each construction concern lives in
its own helper function. The main `createGame` body reads as a linear pipeline:
validate, resolve bases, build ships, assign identities, assemble state.

Some observations on consistency:

- **Deep-copy discipline** -- The rule propagation section (lines 242-289)
  carefully deep-copies arrays and nested objects from the scenario definition.
  This prevents mutation of the shared `SCENARIOS` registry. The copying is
  thorough but verbose -- every optional array is individually spread.

- **Ship ID generation** -- The `p${p}s${s}` pattern is simple and
  deterministic but lives inline rather than in a helper. All other ID
  generation in the codebase follows the same convention.

- **Single call site pattern** -- `createGame` is called from two places in
  production: the server-side game Durable Object and the client-side local
  game initialisation. Both pass the same `findBaseHex` implementation from
  `map-layout.ts`. Test code calls it directly with the same arguments.

## Completeness Check

1. **Reinforcement ships are not fully validated** -- The reinforcement rules
   are deep-copied into `scenarioRules` but the reinforcement ships themselves
   are not run through `resolveStartingPlacement`. When reinforcements arrive
   at runtime, the engine must handle placement separately. This is by design
   (reinforcements may reference hexes that don't exist at game start) but
   creates an asymmetry worth noting.

2. **No incremental building** -- The function does everything in one pass. A
   true builder pattern would allow callers to customise steps (e.g., override
   ship placement for testing). Currently, the `rng` parameter is the only
   customisation hook. However, since the function is pure and tests can supply
   arbitrary `ScenarioDefinition` objects, this is not a practical limitation.

3. **Player count hardcoded to 2** -- The assertion and the `players: [...]`
   literal in the final state both assume exactly two players. If the game
   ever supports more players, this function would need significant changes.
   The hardcoding is currently appropriate for the game's design.

4. **The comment on line 130-132 is accurate** -- "Pure game engine -- no IO,
   no networking, no storage" is enforced by the function taking all external
   concerns as parameters (`map`, `findBaseHex`, `rng`).

## Related Patterns

- **Factory Functions** -- `createGame` is itself a factory function following
  the codebase's universal `createX` naming convention.
- **Multiton (Preset Registries)** -- The `SCENARIOS` registry and
  `SHIP_STATS` constant are the primary inputs to the builder.
- **Dependency Injection** -- The `findBaseHex` callback and `rng` function
  are injected to keep the engine pure.
