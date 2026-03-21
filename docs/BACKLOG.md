# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Review Follow-Up Plan

Current direction is good. This plan is aimed at removing the
main correctness and coordination risks found in the latest
project review without rewriting working systems.

### Phase 2. Finish consolidating client state ownership

- Introduce a small store or reducer layer for `ClientContext`
  and `PlanningState` so commands/controllers stop mutating the
  shared object ad hoc.
- Keep building on `game/state-transition.ts`, which now owns
  the main `setState()` side-effect block, by moving more state
  mutation behind explicit transition/update helpers.
- Keep building on `game/session-controller.ts`, which now owns
  create/join/local-start/exit session flows, by moving the rest
  of session-level `ClientContext` mutation behind explicit
  helpers instead of leaving it in `main.ts`.
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

1. Phase 2: client store/transition consolidation.
2. Phase 3: direct shared-type imports and boundary enforcement.

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
