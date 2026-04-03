# Scenario Rules as Feature Flags

## Category

Scenario & Configuration

## Intent

Use a `ScenarioRules` object embedded in `GameState` to toggle gameplay features at the scenario level rather than hard-coding them into the engine. This allows new scenarios to combine existing engine capabilities in novel ways without modifying engine code.

## How It Works in Delta-V

The `ScenarioRules` interface defines a set of optional boolean and enum flags that control which engine subsystems are active for a given match. These rules are set at game creation time from the scenario definition and travel with the `GameState` through the entire game lifecycle -- they are available to both server engine code and client UI code.

Current flags:

| Flag | Type | Effect |
|------|------|--------|
| `allowedOrdnanceTypes` | `OrdnanceType[]` | Restricts which ordnance can be launched |
| `availableFleetPurchases` | `FleetPurchaseOption[]` | Controls fleet building menu |
| `planetaryDefenseEnabled` | `boolean` | Enables/disables planetary base defense fire |
| `hiddenIdentityInspection` | `boolean` | Activates fugitive identity mechanics |
| `escapeEdge` | `'any' \| 'north'` | Which map edge counts for escape victory |
| `combatDisabled` | `boolean` | Completely disables combat phase |
| `checkpointBodies` | `string[]` | Bodies that must be visited for race victory |
| `sharedBases` | `string[]` | Bodies whose bases both players can use |
| `logisticsEnabled` | `boolean` | Enables the logistics transfer phase |
| `passengerRescueEnabled` | `boolean` | Enables passenger transfer in logistics |
| `targetWinRequiresPassengers` | `boolean` | Landing requires passengers for victory |
| `reinforcements` | `Reinforcement[]` | Ships that arrive on specific turns |
| `fleetConversion` | `FleetConversion` | Mid-game fleet ownership changes |

The engine checks these flags at decision points. For example:
- The ordnance phase checks `allowedOrdnanceTypes` before validating a launch.
- The phase advance logic checks `combatDisabled` to skip combat entirely.
- `filterStateForPlayer` checks `hiddenIdentityInspection` to enable identity stripping.

Crucially, all flags are optional with implicit defaults (usually disabled/unrestricted). This means adding a new flag does not require updating existing scenarios -- they simply do not set the flag and get the default behaviour.

## Key Locations

- `src/shared/types/domain.ts` (lines 413-429) -- `ScenarioRules` interface
- `src/shared/types/domain.ts` (lines 81-101) -- `GameState.scenarioRules`
- `src/shared/types/scenario.ts` (lines 19-28) -- `ScenarioDefinition.rules`
- `src/shared/scenario-definitions.ts` -- scenarios setting rules
- `src/shared/engine/resolve-movement.ts` -- `hiddenIdentityInspection` check
- `src/shared/engine/astrogation.ts` -- ordnance type restriction checks

## Code Examples

ScenarioRules interface (all flags optional):

```typescript
export interface ScenarioRules {
  allowedOrdnanceTypes?: OrdnanceType[];
  availableFleetPurchases?: FleetPurchaseOption[];
  planetaryDefenseEnabled?: boolean;
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  combatDisabled?: boolean;
  checkpointBodies?: string[];
  sharedBases?: string[];
  logisticsEnabled?: boolean;
  passengerRescueEnabled?: boolean;
  targetWinRequiresPassengers?: boolean;
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
}
```

Scenario using rules as feature flags:

```typescript
escape: {
  name: 'Escape',
  rules: {
    allowedOrdnanceTypes: ['nuke'],
    planetaryDefenseEnabled: false,
    hiddenIdentityInspection: true,
    escapeEdge: 'north',
  },
  // ...
}

grandTour: {
  name: 'Grand Tour',
  rules: {
    combatDisabled: true,
    checkpointBodies: ['Sol', 'Mercury', 'Venus', 'Terra', 'Mars', 'Jupiter', 'Io', 'Callisto'],
    sharedBases: ['Terra', 'Venus', 'Mars', 'Callisto'],
  },
  // ...
}
```

## Consistency Analysis

The flag pattern is consistently applied. Engine code always reads from `state.scenarioRules` rather than checking scenario names. Client UI code also reads from `scenarioRules` to show/hide buttons and options, ensuring server and client agree on what is allowed.

The architecture document emphasises "shared rule reuse across layers" -- client ordnance entry, HUD button visibility, and engine validation all derive from the same `scenarioRules` flags.

All flags use optional properties with implicit falsy defaults, which is consistent and extensible. No scenario definition sets conflicting flags (e.g., both `combatDisabled` and a combat-dependent flag).

## Completeness Check

- **Growing flag set**: 13 flags is already substantial. If the set grows much further, consider grouping related flags into sub-objects (e.g., `combatRules`, `logisticsRules`).
- **Validation**: There is no schema validation of `ScenarioRules` at game creation time. Invalid flag combinations (e.g., `targetWinRequiresPassengers` without a `targetBody`) could produce confusing runtime behaviour.
- **Documentation**: Each flag's semantics are partly documented via inline comments, but a comprehensive flag reference does not exist outside the type definition.

## Related Patterns

- **62 -- Config-Driven Scenarios**: `ScenarioRules` is the runtime representation of scenario configuration.
- **49 -- Viewer-Aware Filtering**: `hiddenIdentityInspection` flag controls whether filtering is active.
- **63 -- Data-Driven Maps**: Scenarios reference bodies by name, which are resolved from the data-driven map.
