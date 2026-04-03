# Parity Check

**Category:** Persistence & State

## Intent

Detect divergence between the authoritative live game state held in memory and the state reconstructed from persisted events. If the event stream and checkpoint cannot reproduce the live state, something has gone wrong -- an event was lost, a projector bug exists, or a schema migration is incorrect. The parity check acts as a runtime invariant that catches these problems at the point of state publication rather than letting them propagate silently.

## How It Works in Delta-V

Every time the server publishes a state change through `runPublicationPipeline`, step 3 calls `deps.verifyProjectionParity(state)`. This:

1. Reads the latest checkpoint and the event stream tail from storage.
2. Replays the tail events onto the checkpoint to produce a **projected state**.
3. Compares the projected state to the **live state** using JSON serialization after normalizing transient fields.

If the two states do not match, the system:
- Logs an error with diagnostic details (game ID, live turn/phase, projected turn/phase).
- Reports the mismatch to the D1 analytics database as a `projection_parity_mismatch` event.
- Does **not** halt the game -- the live state is considered authoritative. The mismatch is treated as an observability signal rather than a fatal error.

The normalization step strips transient fields that are expected to differ between live and projected state. Specifically, `player.connected` is set to `false` on both sides before comparison, since connection status is a runtime property not captured in events.

## Key Locations

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/game-do/publication.ts` | 90-125 | Pipeline runner calling `verifyProjectionParity` at step 3 |
| `src/server/game-do/telemetry.ts` | 98-107 | `verifyGameDoProjectionParity` -- loads projected state and compares |
| `src/server/game-do/telemetry.ts` | 46-96 | `reportGameDoProjectionParityMismatch` -- logs and writes D1 event |
| `src/server/game-do/projection.ts` | 191-205 | `normalizeStateForParity` and `hasProjectedStateParity` -- comparison logic |
| `src/server/game-do/archive.ts` | 199-206 | `hasProjectionParity` -- orchestrates checkpoint + tail projection and comparison |
| `src/server/game-do/game-do.ts` | 79-85 | GameDO wires `verifyProjectionParity` into the publication deps |

## Code Examples

The comparison function normalizes transient fields before JSON comparison:

```ts
// src/server/game-do/projection.ts, lines 191-205
const normalizeStateForParity = (state: GameState): GameState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    connected: false,
  })) as GameState['players'],
});

export const hasProjectedStateParity = (
  projectedState: GameState | null,
  liveState: GameState,
): boolean =>
  projectedState !== null &&
  JSON.stringify(normalizeStateForParity(projectedState)) ===
    JSON.stringify(normalizeStateForParity(liveState));
```

The telemetry layer that runs the check and reports mismatches:

```ts
// src/server/game-do/telemetry.ts, lines 98-107
export const verifyGameDoProjectionParity = async (
  storage: DurableObjectStorage,
  state: GameState,
  onMismatch: (gameId: string, liveState: GameState) => Promise<void>,
): Promise<void> => {
  const hasParity = await hasProjectionParity(storage, state.gameId, state);
  if (!hasParity) {
    await onMismatch(state.gameId, state);
  }
};
```

The check is invoked from the publication pipeline for every state change:

```ts
// src/server/game-do/publication.ts, lines 109-110
// Step 3: Verify projection parity
await deps.verifyProjectionParity(state);
```

## Consistency Analysis

**Strengths:**

- The check runs on **every** state publication, not just at turn boundaries. This means even within-turn state changes (individual combat actions, ordnance launches) are verified.
- The check is wired through a dependency injection interface (`PublicationDeps.verifyProjectionParity`), making it testable and replaceable.
- Transient field normalization (`connected`) prevents false positives from runtime-only state.

**Potential gaps:**

- The normalization only strips `connected`. The test suite (`archive.test.ts`, line 966-971) also filters out `ready` and `detected` fields in its parity diff. If these fields can legitimately differ between live and projected state, the production normalizer may produce false-positive mismatches for those fields.
- The comparison uses `JSON.stringify`, which is order-dependent. This works because the state is always constructed by the same code paths, but a future refactor that changes property insertion order could cause spurious mismatches.
- If the event append and checkpoint save are not atomic (they are separate `storage.put` calls), a parity check running between them could see stale data. In practice this is unlikely since the pipeline is sequential and single-threaded within the Durable Object.

## Completeness Check

**Testing coverage is good.** The test suite verifies:
- Parity holds when live state matches checkpoint (`archive.test.ts`, line 869-885)
- Parity holds across a complete multi-turn game flow (`archive.test.ts`, lines 906-975)
- Parity mismatch is detected when live state diverges (`archive.test.ts`, lines 977-999)
- Transient `connected` state is ignored in comparison (`archive.test.ts`, lines 887-904)

**Possible improvements:**

1. **Extend normalization** to cover `ready` and `detected` fields that the test suite already filters, aligning production behavior with test expectations.
2. **Structured diff logging:** Currently the mismatch report only logs turn/phase for both sides. Including a field-level diff (similar to the `diffStates` helper in the test file) would make debugging production mismatches much easier.
3. **Metrics aggregation:** The D1 event insert provides per-incident tracking, but a counter metric for mismatch rate would help identify systemic issues.

## Related Patterns

- **Event Stream + Checkpoint Recovery (Pattern 31):** The parity check validates the output of checkpoint + tail recovery against the live authoritative state.
- **Chunked Event Storage (Pattern 33):** The event stream read during parity verification uses the chunked storage layer.
- **Mutable Clone Pattern (Pattern 35):** The `structuredClone` used in `projectGameStateFromStream` ensures the parity check does not accidentally mutate the checkpoint state.
