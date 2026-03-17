# Delta-V: Architectural Patterns & Refactoring Guide

This document captures recommendations for reducing complexity in the Delta-V codebase and making it easier to get the whole thing working really well. The codebase is already well-structured — the pure functional engine in `shared/`, the extraction of helper modules on the client side, the typed message protocol — these are solid foundations. The suggestions below are about pushing further in the same direction, not replacing anything.

## What's working well

Before diving into changes, it's worth naming the patterns that are already strong:

- **Pure functional game engine.** `shared/game-engine.ts` takes state + actions and returns new state + events with no side effects. This is exactly right for a turn-based game and makes the rules unit-testable in isolation.
- **The "derive plan, then execute" pattern.** Files like `game-client-phase.ts`, `game-client-messages.ts`, and `game-client-phase-entry.ts` return plain data objects describing what should happen, and the caller executes them. This keeps logic testable and side effects contained. The `setState` method's entry plan execution is the best example.
- **Shared types as the contract.** `types.ts` as the single source of truth for `GameState`, `Ship`, network messages, etc. ensures client and server never drift.
- **Decomposed renderer.** At ~1000 lines with well-extracted sub-modules (`renderer-combat.ts`, `renderer-entities.ts`, `renderer-vectors.ts`, etc.), the renderer is doing what a game renderer should.

The overarching theme of this document is: you don't need a framework, you need to shrink the surface area of `GameClient` by pulling state and logic out of the class and into composable pure functions and a thin transport layer. You're already doing this — just keep going.

---

## Priority 1: Pull PlanningState out of the Renderer

This is the sneakiest source of complexity in the codebase. `PlanningState` lives on the `Renderer`, but it's mutated directly by three different systems:

- `InputHandler` writes to it on clicks (burns, combat targets, torpedo acceleration)
- `main.ts` writes to it from keyboard actions, state transitions, combat flow, and ordnance
- Renderer sub-modules read it each frame

```typescript
// main.ts does this constantly:
this.renderer.planningState.selectedShipId = null;
this.renderer.planningState.burns.clear();
this.renderer.planningState.queuedAttacks.push(attack);
```

Three systems reaching into the same mutable bag is where "who changed this and when" bugs come from.

### Proposed change

Pull `PlanningState` out as a standalone object that `GameClient` owns. Pass it to both the renderer and input handler as a read reference. Mutations go through helper functions (some already exist, like `createClearedCombatPlan`). The renderer just reads it each frame.

```typescript
// Owned by GameClient, not Renderer
const planning: PlanningState = createInitialPlanningState();

// Renderer receives it as a read dependency
const renderer = new Renderer(canvas, planning);

// InputHandler produces commands instead of mutating directly
const input = new InputHandler(canvas, camera);
input.onCommand = (cmd) => dispatch(cmd);
```

This eliminates the coupling between input, orchestration, and rendering around a shared mutable object. It also makes it straightforward to snapshot planning state for debugging or undo.

---

## Priority 2: Transport adapter for local vs network play

There are parallel code paths throughout `main.ts` for local and network play:

```typescript
if (this.isLocalGame) {
  this.localProcessCombat(attacks);
} else {
  this.send({ type: 'combat', attacks });
}
```

This pattern repeats for astrogation, ordnance, skip ordnance, skip combat, begin combat, fleet ready, and rematch — roughly 8 places.

### Proposed change

Define a `GameTransport` interface:

```typescript
interface GameTransport {
  submitAstrogation(orders: AstrogationOrder[]): void;
  submitCombat(attacks: CombatAttack[]): void;
  submitOrdnance(launches: OrdnanceLaunch[]): void;
  submitFleetReady(purchases: FleetPurchase[]): void;
  skipOrdnance(): void;
  skipCombat(): void;
  beginCombat(): void;
  requestRematch(): void;
}
```

Then implement `WebSocketTransport` and `LocalTransport`. `GameClient` calls `this.transport.submitCombat(attacks)` and never branches on `isLocalGame`. The transport handles the mechanics — the WebSocket version serialises and sends, the local version calls the engine directly and feeds results back through a callback or event.

This also makes it trivial to add new transports later (e.g. replay playback, spectator mode, or test harnesses that inject canned server responses).

---

## Priority 3: Command/dispatch instead of method soup

`GameClient` has ~30 private methods that are action handlers (`undoSelectedShipBurn`, `confirmOrders`, `queueAttack`, `fireAllAttacks`, `sendOrdnanceLaunch`, `sendSkipCombat`, etc.). The keyboard handler is already halfway there — `deriveKeyboardAction` returns a `KeyboardAction` discriminated union, and `handleKeyboardAction` switches on it. But the execution side is still scattered across methods that directly mutate `this`.

### Proposed change

Define a unified command type:

```typescript
type GameCommand =
  | { type: 'confirmOrders' }
  | { type: 'undoBurn' }
  | { type: 'queueAttack' }
  | { type: 'fireAllAttacks' }
  | { type: 'launchOrdnance'; ordType: 'mine' | 'torpedo' | 'nuke' }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  | { type: 'skipCombat' }
  | { type: 'adjustCombatStrength'; delta: number }
  | { type: 'resetCombatStrength' }
  | { type: 'clearCombatSelection' }
  | { type: 'cycleShip'; direction: 1 | -1 }
  | { type: 'focusNearestEnemy' }
  | { type: 'focusOwnFleet' }
  | { type: 'panCamera'; dx: number; dy: number }
  | { type: 'zoomCamera'; factor: number }
  | { type: 'toggleLog' }
  | { type: 'toggleHelp' }
  | { type: 'toggleMute' }
  | { type: 'requestRematch' }
  | { type: 'exitToMenu' };
```

Route all inputs through a single `dispatch(cmd: GameCommand)` method. The keyboard handler, UI callbacks, and potentially the AI flow all go through this one bottleneck. This gives you:

- One place to add logging/tracing
- One place to add guard conditions (e.g. "ignore commands during animation")
- A clear, greppable list of everything the game can do
- Easy integration with an undo stack if you ever want one

The existing `KeyboardAction` type can map directly into `GameCommand` — it's almost the same union already.

---

## Priority 4: Centralise mutable client state

State is currently spread across multiple locations on `GameClient`:

- `this.state` — the client phase (`ClientState`)
- `this.gameState` — the authoritative game state
- `this.renderer.planningState` — input/planning UI state
- `this.ws`, `this.reconnectAttempts`, `this.reconnectTimer` — connection state
- `this.pingInterval`, `this.lastPingSent`, `this.latencyMs` — ping state
- `this.turnStartTime`, `this.turnTimerInterval`, `this.timerWarningPlayed` — timer state
- `this.playerId`, `this.gameCode`, `this.inviteLink`, `this.scenario` — session state
- `this.isLocalGame`, `this.aiDifficulty` — mode state
- `this.combatWatchInterval`, `this.lastLoggedTurn` — miscellaneous

### Proposed change

Group into a single typed context:

```typescript
interface ClientContext {
  // Core
  clientState: ClientState;
  gameState: GameState | null;
  planning: PlanningState;

  // Session
  playerId: number;
  gameCode: string | null;
  inviteLink: string | null;
  scenario: string;
  isLocalGame: boolean;
  aiDifficulty: AIDifficulty;

  // Connection
  connection: {
    ws: WebSocket | null;
    reconnectAttempts: number;
    latencyMs: number;
  };

  // Timers (managed externally)
  turnStartTime: number;
  lastLoggedTurn: number;
}
```

You don't need Redux or a state management library — just a plain object that you pass to your pure derivation functions instead of pulling fields off `this`. This makes it possible to snapshot the entire client state for debugging, and makes the derivation functions' dependencies explicit in their signatures.

---

## Priority 5: Typed event bus for UI callbacks

`UIManager` has ~15 nullable callback properties that `main.ts` wires up in the constructor:

```typescript
onSelectScenario: ((scenario: string) => void) | null = null;
onSinglePlayer: ((scenario: string, difficulty: ...) => void) | null = null;
onJoin: ((code: string, playerToken?: string | null) => void) | null = null;
onUndo: (() => void) | null = null;
onConfirm: (() => void) | null = null;
onLaunchOrdnance: ((type: 'mine' | 'torpedo' | 'nuke') => void) | null = null;
// ... ~10 more
```

This works but makes the relationship between UI events and game actions invisible unless you read the constructor.

### Proposed change

Define a typed UI event union:

```typescript
type UIEvent =
  | { type: 'selectScenario'; scenario: string }
  | { type: 'startSinglePlayer'; scenario: string; difficulty: AIDifficulty }
  | { type: 'join'; code: string; playerToken?: string | null }
  | { type: 'confirm' }
  | { type: 'undo' }
  | { type: 'launchOrdnance'; ordType: 'mine' | 'torpedo' | 'nuke' }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  | { type: 'attack' }
  | { type: 'fireAll' }
  | { type: 'skipCombat' }
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'rematch' }
  | { type: 'exit' }
  | { type: 'selectShip'; shipId: string };
```

`UIManager` fires events through a single typed emitter. `GameClient` subscribes once. The events can feed into the same `dispatch` function from Priority 3, closing the loop: UI events → commands → dispatch → state changes.

---

## Priority 6: InputHandler produces commands, not mutations

Currently `InputHandler` takes a `Camera` and `PlanningState` in its constructor and mutates both directly. It also has a bare `onConfirm` callback.

### Proposed change

The input handler should translate pointer/touch events into world-space interactions and emit commands — the same `GameCommand` type from Priority 3. Clicks and keyboard actions both produce the same command type, giving you one place to handle game input regardless of source.

```typescript
class InputHandler {
  onCommand: ((cmd: GameCommand) => void) | null = null;

  private handleClick = (screenX: number, screenY: number) => {
    // ... translate to hex, determine interaction ...
    this.onCommand?.({ type: 'setBurnDirection', shipId, direction });
  };
}
```

The input handler no longer needs a reference to `PlanningState` at all — it just needs enough context to figure out what the click means (game state, map, current phase). The command consumer applies the planning state changes.

---

## Priority 7: Async AI turn loop

`processAIPhases` is a recursive chain via callbacks:

```typescript
this.handleLocalResolution(
  resolveAstrogationStep(...),
  () => this.processAIPhases(),  // recursion via callback
  ...
);
```

The AI turn is a state machine disguised as mutual recursion through `setTimeout` and animation callbacks. It works but is hard to follow and harder to debug.

### Proposed change

An explicit async loop:

```typescript
private runAITurn = async () => {
  while (this.gameState && this.gameState.phase !== 'gameOver') {
    const plan = deriveAIActionPlan(
      this.gameState, this.playerId, this.map, this.aiDifficulty
    );
    if (plan.kind === 'none' || plan.kind === 'transition') break;

    for (const entry of plan.logEntries ?? []) {
      this.ui.logText(entry);
    }

    await this.executeAIResolution(plan);
  }
  this.localCheckGameEnd();
  if (this.gameState?.phase !== 'gameOver') {
    this.transitionToPhase();
  }
};

private executeAIResolution = (plan: AIActionPlan): Promise<void> =>
  new Promise((resolve) => {
    this.handleLocalResolution(
      resolveStep(plan),
      resolve,
      plan.errorPrefix,
    );
  });
```

This makes the AI turn readable as a sequence rather than a callback graph. The animation still happens — `handleLocalResolution` still calls `presentMovementResult` with a callback — but the callback resolves a promise instead of recursing.

---

## Priority 8: Serialisation codec

`deserializeState` is called in `handleMessage` to handle the `Map` types in `GameState` and `SolarSystemMap` that don't survive JSON round-trips. This is a potential landmine when adding new `Map` fields.

### Proposed change

Create a `codec.ts` module with explicit serialise/deserialise functions:

```typescript
// shared/codec.ts
export const serializeGameState = (state: GameState): SerializedGameState => { ... };
export const deserializeGameState = (raw: SerializedGameState): GameState => { ... };
```

Add a round-trip test that creates a full game state with all possible fields populated, serialises it, deserialises it, and asserts deep equality. This catches any new `Map` or `Set` fields that get added to the types without updating the codec.

---

## Priority 9: Reduce InputHandler's knowledge

The input handler currently knows about the camera, game state, map, player ID, and planning state. It uses all of these to determine what a click means in context.

### Proposed change (longer-term)

Instead of giving `InputHandler` references to everything, have it produce raw spatial events:

```typescript
type InputEvent =
  | { type: 'clickHex'; hex: HexCoord }
  | { type: 'clickMinimap'; worldPos: PixelCoord }
  | { type: 'doubleClickWorld'; worldPos: PixelCoord }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; cx: number; cy: number; factor: number };
```

A separate interpretation layer (a pure function) maps `InputEvent` + current state → `GameCommand`. This makes the input handler trivially testable (it just translates coordinates) and puts all the game-aware click logic in a pure function that's also easy to test.

This is lower priority because the current structure works and the click logic is already partially extracted into `game-client-input.ts`, `game-client-combat.ts`, etc. But it's the natural endpoint of the patterns you're already using.

---

## Suggested order of work

1. **Pull `PlanningState` out of the renderer** — removes the most coupling with the least disruption
2. **Transport adapter for local/network** — eliminates the `isLocalGame` branching throughout `main.ts`
3. **Command dispatch** — unifies keyboard, UI, and input handling into one flow
4. **Centralise client state** — makes derivation functions' dependencies explicit
5. **Typed UI event bus** — cleans up the callback wiring
6. **Async AI loop** — makes the AI turn readable
7. **Serialisation codec** — prevents future bugs
8. **Input handler produces commands** — the long-term clean endpoint

Each step is independent and can be done incrementally. The first two remove the most accidental complexity. The command dispatch is the one that makes everything else easier to add.
