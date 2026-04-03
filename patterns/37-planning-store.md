# Planning Store

## Category
Client-Specific

## Intent
Centralize all ephemeral client-side planning state -- ship selections, burn directions, combat targets, ordnance queues -- into a single mutable store with a revision signal, so that all UI and rendering consumers react to planning changes through one notification channel rather than scattered ad-hoc state.

## How It Works in Delta-V

The `PlanningStore` is a plain object (not a class) created by `createPlanningStore()`. It holds all the local state a player accumulates while deciding their orders for a turn, before those orders are submitted to the server. The store is organized into four logical sub-domains:

1. **Selection state**: `selectedShipId`, `hoverHex`, `lastSelectedHex` -- which ship and hex the player is interacting with.
2. **Astrogation planning**: `burns`, `overloads`, `landingShips`, `weakGravityChoices`, `acknowledgedShips` -- per-ship burn directions, overload vectors, and gravity opt-outs, all stored as `Map<string, ...>`.
3. **Ordnance planning**: `torpedoAimingActive`, `torpedoAccel`, `torpedoAccelSteps`, `queuedOrdnanceLaunches`, `acknowledgedOrdnanceShips` -- torpedo aiming state and queued launches.
4. **Combat planning**: `combatTargetId`, `combatTargetType`, `combatAttackerIds`, `combatAttackStrength`, `queuedAttacks` -- multi-target sequential combat state.

Every mutation method (e.g., `setShipBurn`, `applyCombatPlanUpdate`, `queueCombatAttack`) calls `notifyPlanningChanged()`, which increments a `revisionSignal`. Consumers subscribe to this signal via reactive effects to know when to re-render.

The store provides `enterPhase(phase)` which resets all sub-domain state when transitioning between game phases, ensuring stale planning data from a previous phase does not leak.

Narrow **view types** (`AstrogationPlanningView`, `CombatPlanningView`, etc.) and **snapshot types** (`AstrogationPlanningSnapshot`, `HudPlanningSnapshot`, etc.) are defined using TypeScript `Pick<>` to give consumers read access to only the fields they need.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/planning.ts` | 1-474 | Full planning store definition |
| `src/client/game/planning.ts` | 69-115 | `PlanningState` interface |
| `src/client/game/planning.ts` | 189-229 | `PlanningStore` interface (methods) |
| `src/client/game/planning.ts` | 273-474 | `createPlanningStore()` factory |
| `src/client/game/planning.ts` | 117-186 | View and snapshot type aliases |
| `src/client/game/session-model.ts` | 49 | `planningState: PlanningStore` on `ClientSession` |
| `src/client/game/command-router.ts` | 51 | `CommandRouterSessionRead.planningState` |
| `src/client/renderer/renderer.ts` | 70 | Renderer receives `PlanningState` |

## Code Examples

Store creation and phase transition:

```typescript
// src/client/game/planning.ts
export const createPlanningStore = (): PlanningStore => {
  const revisionSignal = signal(0);

  const notifyPlanningChanged = (): void => {
    revisionSignal.update((n) => n + 1);
  };

  const planningStore: PlanningStore = {
    revisionSignal,
    ...createSelectionState(),
    ...createAstrogationPlanningState(),
    ...createOrdnancePlanningState(),
    ...createCombatPlanningState(),
    enterPhase: (phase, selectedShipId = null): void => {
      planningStore.selectedShipId = selectedShipId;
      resetAstrogationState();
      resetOrdnanceState();
      resetCombatState();
      // ...
      notifyPlanningChanged();
    },
    // ... 20+ mutation methods
  };
  return planningStore;
};
```

Narrow view types restrict consumer access:

```typescript
// src/client/game/planning.ts
export type AstrogationPlanningView = Pick<
  PlanningState,
  'burns' | 'overloads' | 'landingShips' | 'weakGravityChoices' | 'acknowledgedShips'
>;

export type CombatPlanningSnapshot = Pick<ShipSelectionView, 'selectedShipId'> &
  CombatPlanningView;
```

The command router reads planning state to dispatch actions:

```typescript
// src/client/game/command-router.ts
const selectShip = (deps: CommandRouterDeps, shipId: string): void => {
  const gameState = deps.ctx.getGameState();
  const ship = gameState?.ships.find((candidate) => candidate.id === shipId);
  if (ship) {
    deps.ctx.planningState.selectShip(shipId, hexKey(ship.position));
    deps.renderer.centerOnHex(ship.position);
  }
};
```

## Consistency Analysis

All local planning state is captured in this store. No scattered planning state was found:

- **Burns, overloads, weak gravity choices** -- all in the store's Maps.
- **Ship selection and hover** -- in the store.
- **Combat target selection, attacker lists, queued attacks** -- in the store.
- **Torpedo aiming and ordnance queues** -- in the store.

The `PlanningStore` is created once in `createInitialClientSession()` and referenced as `ctx.planningState` throughout the codebase. The renderer receives it as `PlanningState` (the read-only state interface), while the command router and action modules receive `PlanningStore` (with mutation methods).

The revision signal pattern means consumers do not need to subscribe to individual fields -- they watch one counter. This is coarse-grained but simple and avoids missed notifications.

## Completeness Check

The pattern is thorough. Potential improvements:

- **No read-only enforcement at runtime**: The `PlanningState` interface is read-only by convention (consumers receive the narrower type), but nothing prevents a consumer from casting and mutating. TypeScript's type system provides compile-time safety, which is sufficient.
- **Coarse notification**: The single `revisionSignal` means any change notifies all subscribers even if they only care about one sub-domain. For the current UI complexity this is fine; if performance became an issue, per-domain signals could be added.
- **Phase reset is thorough**: `enterPhase()` resets all three sub-domains using `Object.assign(planningStore, createXxxState())`, ensuring no stale state survives phase transitions.

## Related Patterns

- **Session Model** (Pattern 38): The `PlanningStore` lives on the `ClientSession` aggregate.
- **Disposal Scope** (Pattern 36): Effects watching `revisionSignal` are managed via disposal scopes.
- **3-Layer Input Pipeline** (Pattern 41): Input events are interpreted into `GameCommand` objects that mutate the planning store.
- **Record-Based Type Mapping** (Pattern 46): Planning uses `Map<string, ...>` for per-ship state indexed by ship ID.
