# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

---

## P3 — Test Coverage

### 3a. Client coordination test coverage

The `dispatch()` switch in `main.ts` has ~60 cases. Phase transitions in `setState()` have implicit coupling to renderer, UI, and timer. These are the highest-risk areas during rapid iteration but currently have no direct tests.

**Approach:** Test the dispatch → state transition → side-effect flow with injectable dependencies. The existing DI pattern (astrogationDeps, combatDeps, etc.) makes this feasible.

**Files:** `src/client/main.ts` (test harness), new `src/client/game/dispatch.test.ts`

---

## Features

### Turn replay

Allow players to review past turns after a game ends (or during, stepping back through history).

### Spectator mode

Third-party WebSocket connections that receive state broadcasts but cannot submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat type), `src/server/protocol.ts`, client spectator UI

### New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics beyond what's currently implemented (rescue/passenger transfer, fleet mutiny trigger, advanced reinforcement waves).

### Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios. Extends the logistics phase with a new transfer type.
