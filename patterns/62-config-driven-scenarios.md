# Config-Driven Scenarios

## Category

Scenario & Configuration

## Intent

Define game scenarios as declarative configuration objects rather than procedural setup code. Each scenario specifies players, ships, positions, rules, and victory conditions as data, allowing new scenarios to be added without writing engine code.

## How It Works in Delta-V

Scenarios are defined in `src/shared/scenario-definitions.ts` as a `Record<string, ScenarioDefinition>` exported as `SCENARIOS`. Each `ScenarioDefinition` is a plain object with:

- `name` / `description` -- display metadata
- `tags` -- categorisation (`'Beginner'`, `'Asymmetric'`, `'Combat'`, `'Escort'`, `'Race'`, `'Epic'`, `'Fleet'`, `'Speed'`)
- `players` -- array of two `ScenarioPlayer` objects, each specifying ships, target body, home body, bases, and escape victory flag
- `rules` -- optional `ScenarioRules` feature flags (pattern 61)
- `startingPlayer` -- which player moves first (defaults to 0)
- `startingCredits` -- credits for fleet building scenarios
- `availableFleetPurchases` -- ship types available for purchase

Ship positions are computed from celestial body definitions using helper functions `getBodyOffset(bodyName, dq, dr)` and `getControlledBaseHexes(...bodyNames)`. This means ship starting positions are relative to bodies, not hardcoded hex coordinates -- if a body moves, all scenario ships move with it.

The `ScenarioPlayer` interface captures per-player setup:

```typescript
export interface ScenarioPlayer {
  ships: ScenarioShip[];
  targetBody: string;
  homeBody: string;
  bases?: HexCoord[];
  escapeWins: boolean;
  hiddenIdentity?: boolean;
}
```

At game creation time, `createGame()` reads the scenario definition, places ships, assigns bases, and embeds `scenarioRules` into the `GameState`. The engine never looks at the scenario name after creation -- all behaviour is driven by the embedded rules.

## Key Locations

- `src/shared/types/scenario.ts` -- `ScenarioDefinition`, `ScenarioPlayer` interfaces
- `src/shared/scenario-definitions.ts` -- all scenario configurations
- `src/shared/map-layout.ts` (lines 226-244) -- `getBodyOffset`, `getControlledBaseHexes`

## Code Examples

A simple racing scenario:

```typescript
biplanetary: {
  name: 'Bi-Planetary',
  tags: ['Beginner'],
  description: '1v1 corvettes race to land on the opponent\'s world',
  players: [
    {
      ships: [{
        type: 'corvette',
        position: { q: -9, r: -5 },
        velocity: { dq: 0, dr: 0 },
      }],
      targetBody: 'Venus',
      homeBody: 'Mars',
      bases: getControlledBaseHexes('Mars'),
      escapeWins: false,
    },
    {
      ships: [{
        type: 'corvette',
        position: { q: -7, r: 7 },
        velocity: { dq: 0, dr: 0 },
      }],
      targetBody: 'Mars',
      homeBody: 'Venus',
      bases: getControlledBaseHexes('Venus'),
      escapeWins: false,
    },
  ],
},
```

A fleet-building scenario with credits:

```typescript
interplanetaryWar: {
  name: 'Interplanetary War',
  tags: ['Epic'],
  rules: { logisticsEnabled: true },
  startingPlayer: 1,
  startingCredits: 850,
  availableFleetPurchases: [
    'transport', 'packet', 'tanker', 'corvette',
    'corsair', 'frigate', 'dreadnaught', 'torch',
    'orbitalBaseCargo',
  ],
  players: [
    { ships: [], targetBody: '', homeBody: 'Terra', escapeWins: false },
    { ships: [], targetBody: '', homeBody: 'Mars', escapeWins: false },
  ],
},
```

## Consistency Analysis

All 9 scenarios in the codebase follow the same declarative structure. None contain procedural logic. Ship positions are either absolute hex coordinates or body-relative via `getBodyOffset`. Base assignments use `getControlledBaseHexes`.

The separation between scenario config and engine behaviour is clean: the engine never checks `scenario.name` -- it only reads `GameState.scenarioRules` and the embedded player/ship data. This means a scenario can be added to the `SCENARIOS` record and it will work without engine changes, as long as it uses existing rule flags.

One minor inconsistency: some scenarios set `startLanded: false` explicitly on ships while others omit it (defaulting to `false`). This is cosmetic but could be normalised.

## Completeness Check

- **No scenario validation**: There is no compile-time or runtime check that a scenario definition is self-consistent (e.g., that `targetBody` exists on the map, or that ship positions are in valid hexes).
- **No scenario versioning**: If a scenario definition changes, in-progress games using the old definition could behave unexpectedly. The event-sourced architecture mitigates this since scenarios are snapshotted into `GameState` at creation time.
- **Limited variability**: All scenarios use the same map. A future enhancement could allow per-scenario map definitions, but the current architecture does not support this.

## Related Patterns

- **61 -- Scenario Rules as Feature Flags**: Each scenario's `rules` field uses the `ScenarioRules` feature flag system.
- **63 -- Data-Driven Maps**: Scenarios reference bodies by name from the data-driven map layout.
- **47 -- Discriminated Union Messages**: Scenario selection happens via HTTP, but scenario data flows through the standard state-bearing protocol messages.
