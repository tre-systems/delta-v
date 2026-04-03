# Mutable Clone Pattern

**Category:** Persistence & State

## Intent

Prevent game engine functions from accidentally mutating their input state. Every engine entry point receives a `GameState` that may be the authoritative live state held by the server, a checkpoint loaded from storage, or a state being used for AI simulation. Mutating the input would corrupt shared references. By immediately cloning the input via `structuredClone`, each engine function gets its own mutable copy to work with, and the caller's state is guaranteed to remain unchanged.

## How It Works in Delta-V

Every public engine entry point follows the same opening pattern:

1. Accept the input state as a parameter named `inputState`.
2. Immediately clone it: `const state = structuredClone(inputState)`.
3. Perform all mutations on `state`.
4. Return `state` as part of the result.

The caller never sees mutations until it explicitly adopts the returned state. This is particularly important on the server, where the authoritative state is held as a projected value and must not be corrupted by a failed or rejected action.

The pattern also appears in non-engine contexts:
- **Checkpoint saving** (`saveCheckpoint`): clones the state before persisting to prevent the checkpoint from sharing references with the live state.
- **Event projection** (`projectGameStateFromStream`): clones the initial state (typically a checkpoint) before replaying events onto it.
- **Replay entry construction** (`toReplayEntry`): clones the replay message to avoid shared references across timeline entries.
- **AI simulation** (`aiAstrogation`, `aiLogistics`): clones the state for speculative evaluation without affecting the real game.

## Key Locations

| File | Lines | Purpose |
|------|-------|---------|
| `src/shared/engine/astrogation.ts` | 130 | `processAstrogation` -- clones inputState |
| `src/shared/engine/astrogation.ts` | 187 | `processOrdnance` -- clones inputState |
| `src/shared/engine/astrogation.ts` | 329 | `skipOrdnance` -- clones inputState |
| `src/shared/engine/combat.ts` | 272 | `beginCombatPhase` -- clones inputState |
| `src/shared/engine/combat.ts` | 318 | `processCombat` -- clones inputState |
| `src/shared/engine/combat.ts` | 616 | `skipCombat` -- clones inputState |
| `src/shared/engine/combat.ts` | 743 | `processSingleCombat` -- clones inputState |
| `src/shared/engine/combat.ts` | 782 | `endCombat` -- clones inputState |
| `src/shared/engine/ordnance.ts` | 83 | `processEmplacement` -- clones inputState |
| `src/shared/engine/logistics.ts` | 268 | `processLogistics` -- clones inputState |
| `src/shared/engine/fleet-building.ts` | 30 | `processFleetReady` -- clones inputState |
| `src/shared/engine/event-projector/index.ts` | 71 | `projectGameStateFromStream` -- clones initialState |
| `src/server/game-do/archive.ts` | 96 | `saveCheckpoint` -- clones state before persisting |
| `src/shared/ai/astrogation.ts` | 104 | AI simulation -- clones state for speculative eval |
| `src/shared/ai/logistics.ts` | 584 | AI simulation -- clones state for speculative eval |

## Code Examples

The canonical pattern in an engine entry point:

```ts
// src/shared/engine/astrogation.ts, lines 123-131
export const processAstrogation = (
  inputState: GameState,
  playerId: PlayerId,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng: () => number,
): MovementResult | StateUpdateResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];
  // ... all mutations happen on `state`
```

The same pattern in combat:

```ts
// src/shared/engine/combat.ts, lines 269-273
export const beginCombatPhase = (
  inputState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  rng: () => number,
):
  | CombatPhaseResult
  | { state: GameState; engineEvents: EngineEvent[] }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];
```

Defensive clone in checkpoint persistence:

```ts
// src/server/game-do/archive.ts, lines 91-98
const checkpoint: Checkpoint = {
  gameId,
  seq,
  turn: state.turnNumber,
  phase: state.phase,
  state: normalizeArchivedGameState(structuredClone(state)),
  savedAt: Date.now(),
};
```

Clone in the event projector to protect checkpoint state during replay:

```ts
// src/shared/engine/event-projector/index.ts, lines 70-72
let state = initialState
  ? migrateGameState(structuredClone(initialState))
  : null;
```

AI speculative clone:

```ts
// src/shared/ai/astrogation.ts, line 104
let simulated = structuredClone(state);
```

## Consistency Analysis

**The pattern is applied consistently across all engine entry points.** Every public function that receives `GameState` and returns a modified version clones the input first. The naming convention is uniform: the parameter is called `inputState` and the clone is called `state`.

**The pattern is also applied in non-engine contexts** where state must be protected:
- Checkpoint saving clones to prevent storage from holding references to live state.
- Event projection clones to prevent replay from corrupting the checkpoint.
- AI simulation clones to prevent speculative evaluation from affecting the real game.
- Replay entry construction clones to prevent timeline entries from sharing state.

**One area where the pattern is notably absent:** The `resolveTurnTimeoutOutcome` function in `src/server/game-do/turns.ts` does **not** clone its input. However, this is safe because it delegates immediately to engine entry points (`processAstrogation`, `skipOrdnance`, `skipCombat`) which each perform their own clone. The function itself does not mutate its `gameState` parameter.

**The `processLogistics` and `processSurrender` functions** follow the same pattern. `skipLogistics` was also verified to follow the pattern in the logistics module.

## Completeness Check

**Test coverage for clone isolation:**
The archive test suite explicitly verifies that checkpoint state is deep-cloned:

```ts
// src/server/game-do/archive.test.ts, lines 453-469
it('checkpoint state is deep-cloned from live state', async () => {
  // ... create and save checkpoint ...
  // Mutate original state
  state.turnNumber = 999;
  const checkpoint = await getCheckpoint(storage, 'CLONE-m1');
  expect(checkpoint?.state.turnNumber).not.toBe(999);
});
```

**Potential risks:**

1. **Performance cost of `structuredClone`:** Each engine call clones the entire game state, which includes arrays of ships, ordnance, planets, and other objects. For the current game size (2 players, ~10 ships each), this is negligible. If the state grew significantly larger, the clone cost could become measurable.

2. **Double cloning:** Some call chains clone more than once. For example, `saveCheckpoint` clones the state, and the publication pipeline calls it after the engine entry point already produced a cloned result. The checkpoint clone is still necessary because the caller may continue to mutate the returned state. The event projector clone is necessary because it protects the stored checkpoint from being mutated during replay.

3. **No compile-time enforcement:** The pattern is a convention, not a type-system guarantee. A new engine function could forget the `structuredClone` call. TypeScript's `Readonly<GameState>` could help but would require pervasive type changes. The consistent naming convention (`inputState` / `state`) makes it easy to spot violations in code review.

4. **Non-engine callers passing mutable state:** The server's `getCurrentGameState` method returns the projected state directly. If a caller mutated this return value before passing it to an engine function, the clone inside the engine function would still protect correctness. But if a caller mutated it and then used it for something else (like a parity check), problems could arise. The checkpoint + projection pattern mitigates this by always reconstructing state from storage.

## Related Patterns

- **Event Stream + Checkpoint Recovery (Pattern 31):** Checkpoint persistence relies on the mutable clone pattern to isolate the stored snapshot from the live state.
- **Deterministic RNG Injection (Pattern 34):** The cloned state is what the injected RNG modifies -- without the clone, random mutations would corrupt the shared input.
- **Parity Check (Pattern 32):** The `projectGameStateFromStream` clone ensures that parity verification does not accidentally mutate checkpoint state.
