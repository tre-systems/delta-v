# 3-Layer Input Pipeline

## Category
Client-Specific

## Intent
Separate input handling into three distinct layers -- raw DOM events, semantic game events, and command dispatch -- so that each layer can be tested, reasoned about, and modified independently. Raw pointer/touch/keyboard events are translated into domain-meaningful actions without coupling the DOM to game logic.

## How It Works in Delta-V

The pipeline has three layers:

### Layer 1: Raw Input Capture (`input.ts` + `input-interaction.ts`)

The `createInputHandler()` function binds raw DOM events (mousedown, mousemove, mouseup, touchstart, touchmove, touchend, wheel, dblclick) to the canvas. It uses the `PointerInteractionManager` from `input-interaction.ts` to handle:

- **Drag detection**: Distinguishes clicks from drags using a threshold (8px for touch, 3px for mouse).
- **Pinch-to-zoom**: Tracks two-touch distances and computes zoom factors.
- **Coordinate conversion**: Converts screen pixels to world coordinates via the camera, then to hex coordinates via `pixelToHex()`.
- **Minimap click resolution**: Checks if a click falls within the minimap overlay before processing as a game hex click.

Raw events are distilled into two semantic `InputEvent` types: `{ type: 'clickHex', hex }` and `{ type: 'hoverHex', hex }`.

### Layer 2: Input Interpretation (`input-events.ts`)

The `interpretInput()` function takes an `InputEvent` along with game state context (current `InteractionMode`, game state, map, player ID, planning snapshot) and produces an array of `GameCommand` objects.

It delegates to phase-specific interpreters:
- `interpretAstrogationClick()` -- resolves clicks to burn toggles, overload toggles, weak gravity toggles, or ship selections.
- `interpretOrdnanceClick()` -- resolves clicks to torpedo acceleration or ship selections.
- `interpretCombatClick()` -- resolves clicks to target selection, attacker toggling, or selection clearing.

Each interpreter returns `GameCommand[]`, making the interpretation pure and testable without DOM or canvas dependencies.

### Layer 3: Command Dispatch (`command-router.ts`)

The `dispatchGameCommand()` function takes a `GameCommand` and routes it to the appropriate handler via a type-safe handler map. Handlers are organized by domain:

- `astrogationHandlers` -- burn/overload/gravity/confirm operations
- `combatHandlers` -- target/attacker/strength/queue/fire operations
- `ordnanceHandlers` -- launch/emplace/skip operations
- `logisticsHandlers` -- skip/confirm transfers
- `fleetAndNavigationHandlers` -- ship selection, camera control
- `uiAndLifecycleHandlers` -- toggle log/help/mute, rematch, exit

The handler map is typed with `satisfies CommandHandlerMap` to ensure exhaustive coverage of all command types at compile time.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/input.ts` | 15-208 | Layer 1: Raw input capture |
| `src/client/input-interaction.ts` | 46-136 | Pointer interaction manager |
| `src/client/game/input-events.ts` | 1-234 | Layer 2: Input interpretation |
| `src/client/game/input-events.ts` | 26-27 | `InputEvent` type definition |
| `src/client/game/command-router.ts` | 1-338 | Layer 3: Command dispatch |
| `src/client/game/commands.ts` | 6-63 | `GameCommand` discriminated union |
| `src/client/game/interaction-fsm.ts` | 1-43 | `InteractionMode` and `deriveInteractionMode` |

## Code Examples

Layer 1 produces semantic input events:

```typescript
// src/client/input.ts
const handleClick = (screenX: number, screenY: number) => {
  if (handleMinimapClick(screenX, screenY)) return;
  const worldPos = camera.screenToWorld(screenX, screenY);
  const hex = pixelToHex(worldPos, HEX_SIZE);
  onInput({ type: 'clickHex', hex });
};
```

Layer 2 interprets events into commands (pure function):

```typescript
// src/client/game/input-events.ts
export const interpretInput = (
  event: InputEvent,
  state: GameState | null,
  interactionMode: InteractionMode,
  map: SolarSystemMap | null,
  playerId: PlayerId,
  planning: InteractivePlanningSnapshot,
): GameCommand[] => {
  switch (event.type) {
    case 'clickHex':
      return interpretClickHex(event.hex, state, interactionMode, map, playerId, planning);
    case 'hoverHex':
      if (state) return [{ type: 'setHoverHex', hex: event.hex }];
      if (planning.hoverHex) return [{ type: 'setHoverHex', hex: null }];
      return [];
  }
};
```

Layer 3 dispatches commands via a typed handler map:

```typescript
// src/client/game/command-router.ts
const commandHandlers = {
  ...astrogationHandlers,
  ...combatHandlers,
  ...logisticsHandlers,
  ...ordnanceHandlers,
  ...fleetAndNavigationHandlers,
  ...uiAndLifecycleHandlers,
} satisfies CommandHandlerMap;

export const dispatchGameCommand = <T extends GameCommand>(
  deps: CommandRouterDeps,
  cmd: T,
): void => {
  const handler = commandHandlers[cmd.type] as (deps: CommandRouterDeps, cmd: T) => void;
  handler(deps, cmd);
};
```

Keyboard input also enters the pipeline at Layer 3 via `keyboardActionToCommand()`:

```typescript
// src/client/game/commands.ts
export const keyboardActionToCommand = (action: KeyboardAction): GameCommand | null => {
  switch (action.kind) {
    case 'cycleShip':
      return { type: 'cycleShip', direction: action.direction };
    case 'confirmOrders':
      return { type: 'confirmOrders' };
    // ... exhaustive mapping
  }
};
```

## Consistency Analysis

The layer separation is clean:

- **Layer 1** never references game state types or planning state. It only knows about cameras and hex coordinates.
- **Layer 2** is a pure function that takes state snapshots (via `Pick` types) and returns commands. It has no DOM dependencies.
- **Layer 3** has side effects (state mutations, network calls) but is organized into domain-specific handler groups with exhaustive type coverage.

**Minor observations**:
- The renderer's `start()` method (line 542) uses raw `window.addEventListener('resize', resize)` instead of `listen()`. This is a presentation infrastructure concern outside the input pipeline.
- The `visibilitychange` listener in `renderer.ts` is also outside the pipeline, correctly -- it controls animation, not input.
- Camera panning during drag (`input-interaction.ts`) bypasses the command pipeline and calls `camera.pan()` directly. This is appropriate since drag panning is a continuous, high-frequency operation that would flood the command system.

## Completeness Check

The pipeline handles all input paths:

- **Mouse**: click, drag, double-click, wheel zoom
- **Touch**: tap, drag, pinch zoom
- **Keyboard**: Mapped through `keyboardActionToCommand()` into `GameCommand`
- **UI buttons**: Emit `GameCommand` objects directly to the dispatcher

No layer violations were found -- DOM code does not reach into game logic, and game logic does not manipulate the DOM.

## Related Patterns

- **Planning Store** (Pattern 37): Commands from Layer 3 mutate the planning store.
- **Session Model** (Pattern 38): The command router reads session state via `CommandRouterSessionRead`.
- **Camera/Viewport Transform** (Pattern 43): Layer 1 uses the camera for screen-to-world coordinate conversion.
- **Disposal Scope** (Pattern 36): Layer 1 event listeners are scoped via `withScope`.
