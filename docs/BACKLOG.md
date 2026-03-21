# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Maintenance

### Phase 5. Stronger entity state models

- Replace growing optional-flag bags on entities with clearer
  status/capability models where invalid combinations are harder
  to represent.
- Do this incrementally, starting with the most heavily used
  shapes such as `Ship`.

### Reactive signals

`src/client/reactive.ts` is a standalone signals library
(signal, computed, effect, batch, DOM helpers) with 31 tests
including property-based coverage. Lifecycle gaps are resolved:
nested effects auto-dispose on parent re-run, computed exposes
`dispose()`. Ready for wiring into core UI state.

Known trade-off: diamond dependencies can emit glitchy
intermediate states outside of `batch()`. Use `batch()` when
updating multiple signals that feed the same computed/effect.

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
