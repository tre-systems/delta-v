# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Review Follow-Up Plan

Current direction is good. This plan is aimed at removing the
main correctness and coordination risks found in the latest
project review without rewriting working systems.

### Phase 1. Consolidate protocol validation

- Move C2S/S2C runtime schema ownership next to the shared
  protocol message definitions instead of maintaining a large
  hand-written parser island in `src/server/protocol.ts`.
- Keep room-code, token, and seat-assignment helpers separate if
  they stay generic; focus schema consolidation on message
  payloads first.
- Use the shared schema layer for both runtime validation and
  compile-time TypeScript inference where practical.
- Target outcome: one source of truth for protocol shape, smaller
  validator surface area, and cheaper message evolution.

### Phase 2. Finish consolidating client state ownership

- Extract `ClientContext` and `PlanningState` mutation behind a
  small store or reducer layer instead of mutating the shared
  object directly from `main.ts` and helper deps.
- Move the imperative `setState()` side-effect block toward
  explicit transition handlers so phase-entry behavior is easier
  to test in isolation.
- Keep `GameClient` as the bootstrap/wiring shell for renderer,
  connection, and UI composition.
- Target outcome: `main.ts` becomes orchestration glue instead of
  the default home for future gameplay coupling.

### Phase 3. Enforce shared type boundaries

- Replace broad barrel imports from `shared/types` with direct
  imports from `shared/types/domain`, `shared/types/protocol`,
  and `shared/types/scenario`.
- Update docs and import conventions so new modules follow the
  bounded split by default.
- If needed, add a lint rule or lightweight repo check once the
  bulk migration is complete.
- Target outcome: the type split becomes architectural reality,
  not just a file-layout improvement.

### Suggested order

1. Phase 1: protocol schema consolidation.
2. Phase 2: client store/transition consolidation.
3. Phase 3: direct shared-type imports and boundary enforcement.

---

## Maintenance

### Phase 5. Stronger entity state models

- Replace growing optional-flag bags on entities with clearer
  status/capability models where invalid combinations are harder
  to represent.
- Do this incrementally, starting with the most heavily used
  shapes such as `Ship`.

---

## Features

### Turn replay

Allow players to review past turns after a game ends
(or during, stepping back through history).

### Spectator mode

Third-party WebSocket connections that receive state
broadcasts but cannot submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat
type), `src/server/protocol.ts`, client spectator UI

### New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics
beyond what's currently implemented (rescue/passenger
transfer, fleet mutiny trigger, advanced reinforcement
waves).

### Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios.
Extends the logistics phase with a new transfer type.
