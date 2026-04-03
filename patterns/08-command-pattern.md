# Command Pattern

## Category

Behavioral

## Intent

Decouple user input (keyboard, mouse, touch, UI buttons) from the game logic that carries out each action. Every user-initiated mutation flows through a single `GameCommand` discriminated union, enabling uniform dispatch, undo history, AI-driven command injection, and testable intent-to-effect mapping.

## How It Works in Delta-V

The command pattern is implemented across three collaborating layers:

1. **Command definition** (`commands.ts`) -- A single discriminated union type `GameCommand` enumerates every possible user action in the game. Commands are plain data objects with a `type` tag and any required payload. They carry no behavior themselves.

2. **Input interpretation** (`input-events.ts`, `keyboard.ts`, `input.ts`) -- Raw DOM events (pointer clicks, keyboard presses, touch gestures) are translated into `GameCommand` instances by pure functions. `deriveKeyboardAction` maps key + context to a `KeyboardAction`, which `keyboardActionToCommand` converts to a `GameCommand`. Hex clicks go through `interpretInput`, which examines the current interaction mode and produces zero or more `GameCommand` values.

3. **Command routing** (`command-router.ts`) -- `dispatchGameCommand` accepts a `GameCommand` and a dependency bag (`CommandRouterDeps`), then routes to the correct handler. Handlers are grouped by domain (astrogation, combat, ordnance, logistics, fleet/navigation, UI/lifecycle) in separate maps that are spread into a single `commandHandlers` object. The router uses TypeScript `satisfies` to guarantee exhaustive coverage of every command type at compile time.

The flow is strictly one-way: **DOM event -> InputEvent/KeyboardAction -> GameCommand -> dispatchGameCommand -> domain action**. No game logic reads raw DOM events directly.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/commands.ts` | 1-128 | `GameCommand` union + `keyboardActionToCommand` |
| `src/client/game/command-router.ts` | 1-338 | Handler map + `dispatchGameCommand` |
| `src/client/game/keyboard.ts` | 1-264 | `deriveKeyboardAction` -- keyboard to action |
| `src/client/game/input-events.ts` | 1-235 | `interpretInput` -- hex clicks to commands |
| `src/client/game/main-interactions.ts` | 1-60+ | Wires input handler to command dispatch |
| `src/client/input.ts` | 1-209 | Raw DOM listener registration |

## Code Examples

The command union (excerpt from `commands.ts`):

```typescript
export type GameCommand =
  // Astrogation
  | { type: 'confirmOrders' }
  | { type: 'undoBurn' }
  | { type: 'setBurnDirection'; shipId?: string; direction: number | null }
  // Combat
  | { type: 'queueAttack' }
  | { type: 'fireAllAttacks' }
  | { type: 'adjustCombatStrength'; delta: number }
  // Navigation / camera
  | { type: 'selectShip'; shipId: string }
  | { type: 'panCamera'; dx: number; dy: number }
  // ...
  | { type: 'setHoverHex'; hex: HexCoord | null };
```

Handler grouping with compile-time exhaustiveness (excerpt from `command-router.ts`):

```typescript
const astrogationHandlers = {
  confirmOrders: (deps) => confirmOrders(deps.astrogationDeps),
  undoBurn: (deps) => undoSelectedShipBurn(deps.astrogationDeps),
  setBurnDirection: (deps, cmd) =>
    setBurnDirection(deps.astrogationDeps, cmd.direction, cmd.shipId),
  // ...
} satisfies PartialCommandHandlerMap<
  'confirmOrders' | 'undoBurn' | 'setBurnDirection' | /* ... */
>;

const commandHandlers = {
  ...astrogationHandlers,
  ...combatHandlers,
  ...logisticsHandlers,
  ...ordnanceHandlers,
  ...fleetAndNavigationHandlers,
  ...uiAndLifecycleHandlers,
} satisfies CommandHandlerMap;
```

The single dispatch entry point:

```typescript
export const dispatchGameCommand = <T extends GameCommand>(
  deps: CommandRouterDeps,
  cmd: T,
): void => {
  const handler = commandHandlers[cmd.type] as (
    deps: CommandRouterDeps,
    cmd: T,
  ) => void;
  handler(deps, cmd);
};
```

## Consistency Analysis

**Strengths:**

- Every keyboard shortcut flows through `deriveKeyboardAction` -> `keyboardActionToCommand` -> `dispatchGameCommand`. No direct DOM-to-mutation shortcuts.
- Hex click interpretation in `input-events.ts` returns `GameCommand[]`, always dispatched through the same router.
- The `satisfies CommandHandlerMap` constraint is a strong guarantee that adding a new command type without a handler is a compile error.
- Handler groups are cleanly separated by domain, making the router easy to navigate.

**Potential gaps:**

- Camera manipulation in `input.ts` (drag panning, pinch zoom, double-click centering, minimap clicks) mutates camera state directly without going through the command system. This is defensible since these are continuous/transient interactions, but it means camera behavior is not replayable or undoable.
- The `handleMinimapClick` function in `input.ts` directly modifies `camera.targetX`/`camera.targetY`, bypassing commands entirely.
- UI toggle commands (`toggleLog`, `toggleHelp`, `toggleMute`) are routed through commands, which is good, but some UI state changes in `session-signals.ts` effects bypass commands since they are reactive derivations rather than user actions.

## Completeness Check

- The command union covers all game phases: astrogation, ordnance, logistics, combat, fleet building, camera, UI toggles, and lifecycle.
- Keyboard-to-command mapping includes every command that makes sense from a keyboard context. The exhaustive switch in `keyboardActionToCommand` ensures no `KeyboardAction` kind is silently dropped.
- One potential improvement: continuous camera interactions (drag, pinch) could be represented as transient commands for replay/recording purposes, though the complexity cost may not be worthwhile.

## Related Patterns

- **State Machine** (09) -- The interaction FSM determines which commands are valid in which state. `deriveKeyboardAction` reads `ClientState` to decide what action a key produces.
- **Derive/Plan** (12) -- `interpretInput` and `deriveKeyboardAction` are pure derive functions that produce command data, fitting the functional core pattern.
- **Pipeline** (15) -- The input pipeline (DOM -> InputEvent -> GameCommand -> dispatch) is a chain of transformations.
