# Derive/Plan (Functional Core / Imperative Shell)

## Category

Behavioral

## Intent

Separate decision-making from side effects by splitting every stateful operation into two phases: a pure `derive*` function that computes a plan (what should happen), and an `apply*` function that executes it (making it happen). This enables easy testing of logic without mocking, prevents accidental side effects in business rules, and makes the data flow explicit.

## How It Works in Delta-V

The pattern is expressed through two naming conventions:

### `derive*` Functions (Functional Core)

Pure functions that take immutable inputs (game state, player id, client state, etc.) and return a data structure describing what to do. They never:
- Mutate state
- Call network APIs
- Touch the DOM
- Trigger side effects

They always:
- Return a typed plan/result object
- Are deterministic given the same inputs
- Are directly unit-testable without mocks

### `apply*` Functions (Imperative Shell)

Functions that take a plan and a dependency bag, then execute the plan by mutating state, calling APIs, updating the DOM, etc. They contain minimal logic -- ideally just conditionals on plan fields and delegation to external systems.

### The Boundary

The composition root (e.g., `client-kernel.ts`, `state-transition.ts`, `authoritative-updates.ts`) calls derive first, then apply. This boundary is where the pure world meets the effectful world.

## Key Locations

### Derive functions (functional core)

| File | Function | Returns |
|------|----------|---------|
| `src/client/game/phase.ts` | `derivePhaseTransition` | `PhaseTransitionPlan` |
| `src/client/game/interaction-fsm.ts` | `deriveInteractionMode` | `InteractionMode` |
| `src/client/game/keyboard.ts` | `deriveKeyboardAction` | `KeyboardAction` |
| `src/client/game/client-message-plans.ts` | `deriveClientMessagePlan` | `ClientMessagePlan` |
| `src/client/game/endgame.ts` | `deriveGameOverPlan` | Game over plan |
| `src/client/game/briefing.ts` | `deriveScenarioBriefingEntries` | Briefing entries |
| `src/client/game/network.ts` | `deriveGameStartClientState`, `deriveWelcomeHandling`, `deriveDisconnectHandling`, `deriveReconnectAttemptPlan` | Various network plans |
| `src/client/game/timer.ts` | `deriveTurnTimer` | Timer state |
| `src/client/game/burn.ts` | `deriveBurnChangePlan` | Burn change plan |
| `src/client/game/hud-view-model.ts` | `deriveHudViewModel` | `HudViewModel` |
| `src/client/game/phase-entry.ts` | `deriveClientStateEntryPlan` | `ClientStateEntryPlan` |
| `src/client/game/ai-flow.ts` | `deriveAIActionPlan` | `AIActionPlan` |
| `src/client/game/replay-selection.ts` | `deriveReplaySelection` | Replay selection |
| `src/client/ui/layout.ts` | `deriveHudLayoutOffsets` | Layout offsets |
| `src/shared/scenario-capabilities.ts` | `deriveCapabilities` | Scenario capabilities |
| `src/shared/prng.ts` | `deriveActionRng` | Seeded RNG |

### Apply functions (imperative shell)

| File | Function | Effect |
|------|----------|--------|
| `src/client/game/state-transition.ts` | `applyClientStateTransition` | Mutates client state, triggers UI/timer/tutorial side effects |
| `src/client/game/authoritative-updates.ts` | `applyAuthoritativeUpdate` | Routes server updates to presentation/state |
| `src/client/game/client-context-store.ts` | `applyWelcomeSession` | Sets session fields from welcome message |
| `src/client/game/game-state-store.ts` | `applyClientGameState` | Writes game state to reactive session |
| `src/client/ui/layout-metrics.ts` | `applyHudLayoutMetrics` | Writes CSS custom properties |
| `src/client/ui/visibility.ts` | `applyUIVisibility` | Sets DOM display styles |
| `src/shared/combat.ts` | `applyDamage` | Mutates ship damage state |
| `src/shared/engine/victory.ts` | `applyCheckpoints`, `applyEscapeMoralVictory` | Mutates game state |
| `src/shared/engine/post-movement.ts` | `applyResupply`, `applyDetection` | Mutates game state |
| `src/server/game-do/socket.ts` | `applySocketRateLimit` | Checks/updates rate limit state |

## Code Examples

Phase transition derive + apply:

```typescript
// Derive (pure): determine what transition to make
export const derivePhaseTransition = (
  state: GameState,
  playerId: number,
  lastLoggedTurn: number,
  isLocalGame: boolean,
): PhaseTransitionPlan => {
  // ... pure logic examining state
  return {
    nextState: 'playing_astrogation',
    banner: 'YOUR TURN',
    playPhaseSound: true,
    beginCombatPhase: false,
    runLocalAI: false,
    turnLogNumber: state.turnNumber,
    turnLogPlayerLabel: 'You',
  };
};

// Apply (shell): execute the plan
export const applyClientStateTransition = (
  deps: StateTransitionDeps,
  newState: ClientState,
): void => {
  batch(() => {
    deps.ctx.state = newState;
    deps.onStateChanged(prevState, newState);
    const entryPlan = deriveClientStateEntryPlan(newState, /* ... */);
    if (entryPlan.hideTutorial) deps.tutorial.hideTip();
    if (entryPlan.resetCamera) deps.renderer.resetCamera();
    if (entryPlan.startTurnTimer) deps.turnTimer.start();
    // ...
  });
};
```

AI action plan derive:

```typescript
export const deriveAIActionPlan = (
  state: GameState | null,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  generators: AIDecisionGenerators,
): AIActionPlan => {
  if (!state || state.phase === 'gameOver') return { kind: 'none' };
  if (state.phase === 'astrogation') {
    return {
      kind: 'astrogation',
      aiPlayer: state.activePlayer,
      orders: generators.astrogation(/* ... */),
      errorPrefix: 'AI astrogation error:',
    };
  }
  // ...
};
```

Client message plan derive:

```typescript
export const deriveClientMessagePlan = (
  currentState: ClientState,
  reconnectAttempts: number,
  playerId: PlayerId | -1,
  nowMs: number,
  msg: S2C,
): ClientMessagePlan => {
  switch (msg.type) {
    case 'welcome':
      return {
        kind: 'welcome',
        playerId: msg.playerId,
        code: msg.code,
        showReconnectToast: welcome.showReconnectToast,
        nextState: welcome.nextState,
      };
    // ... all message types produce a plan
  }
};
```

## Consistency Analysis

**Strengths:**

- The `derive*` / `apply*` naming convention is applied consistently across the codebase, making it immediately clear which functions are pure and which have side effects.
- Derive functions return explicit plan types (e.g., `PhaseTransitionPlan`, `ClientStateEntryPlan`, `AIActionPlan`, `ClientMessagePlan`), making the intermediate data inspectable and testable.
- Apply functions receive dependencies through interfaces, not globals, enabling test substitution.
- The pattern extends from client-only concerns (HUD, UI visibility) through shared game logic (damage, checkpoints) to server-side operations (rate limiting).

**Potential violations:**

- `derivePhaseTransition` accesses `state.ships` via `.find()` and `.some()`, which is fine for pure reads, but `hasPendingOwnedAsteroidHazards` performing a nested search could be expensive. No side effects though.
- Some `apply*` functions on the engine side (e.g., `applyDamage`, `applyResupply`) mutate their `GameState` argument in place rather than returning a new one. This is the engine's convention (mutation for performance in tight game loops) and differs from the client's immutable-derive style.
- `applyClientStateTransition` calls `deriveClientStateEntryPlan` internally, so the derive is nested inside the apply rather than being done by the caller. This is a minor deviation -- the caller does not see the entry plan.

**Recommendations:**

- Consider documenting the convention that engine `apply*` functions mutate in place while client `apply*` functions use dependency injection.
- The `deriveAIActionPlan` function injects generators as a parameter with defaults, which is excellent for testability.

## Completeness Check

- There are 20+ derive functions covering: phase transitions, keyboard actions, client messages, HUD view model, AI actions, network handling, game over, briefing, layout, scenarios, and more.
- There are 12+ apply functions covering: state transitions, authoritative updates, session setup, game state writing, UI visibility, layout metrics, damage, resupply, detection, checkpoints, and rate limiting.
- The pattern is used in both `src/client/` and `src/shared/` directories, showing consistent adoption across the codebase.
- No derive functions appear to have hidden side effects (no DOM access, no network calls, no mutable external state).

## Related Patterns

- **Command** (08) -- Commands are produced by derive functions (`deriveKeyboardAction`, `interpretInput`) and dispatched by the imperative shell.
- **State Machine** (09) -- `derivePhaseTransition` and `deriveClientStateEntryPlan` are the pure derivation layer for the state machine.
- **Builder** (13) -- `build*` functions are a related but distinct pattern: they construct data structures rather than computing transition plans.
- **Strategy** (11) -- `deriveAIActionPlan` delegates scoring to the config-weighted strategy system.
