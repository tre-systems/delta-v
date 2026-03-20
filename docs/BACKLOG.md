# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

All P0–P3 items are complete. User-testing readiness items are resolved. Only feature work remains.

---

## User-testing readiness *(all resolved)*

Issues found during a deep review ahead of user testing.

### High — fix before user testing

#### ~~1. No fetch timeout on game creation~~ *(done)*

Added `AbortController` with 10s timeout to `createGame()`.

#### ~~2. No loading indicator on game creation~~ *(done)*

Button shows "CREATING..." and disables while request is in flight.

#### ~~3. Empty src/client/__tests__/ directory~~ *(done)*

Deleted.

### Medium — ship without, but track

#### ~~4. Generic error messages~~ *(done)*

Distinct messages for timeout, network error, and server error.

#### ~~5. Engine errors not telemetrized~~ *(done)*

Engine errors now inserted into D1 via `reportEngineError`.

#### ~~6. Chat rate limit resets on reconnect~~ *(done)*

Rate limit moved from in-memory Map to DO storage.

#### ~~7. Event log unbounded growth~~ *(done)*

Capped at 500 events with oldest trimmed on append.

#### ~~8. No offline detection~~ *(done)*

Toast notifications on offline/online events.

### High — UI/mobile issues

#### ~~12. Help overlay shows keyboard shortcuts on mobile~~ *(done)*

Keyboard-only rows and sections hidden via CSS at mobile breakpoint.

#### ~~13. Game log says "Press ? for controls help" on mobile~~ *(done)*

Shows "Tap ? for controls" on mobile.

#### ~~14. Tutorial mentions keyboard shortcuts~~ *(done)*

Added `mobileText` variants for touch-friendly instructions.

### Low — nice-to-have

#### ~~15. No explicit CORS headers~~ *(done)*

Added `Access-Control-Allow-Origin: *` and OPTIONS preflight.

#### ~~16. Room code collision ceiling~~ *(done)*

32^5 (~33.6M) codes with 12 retries. Collision
ceiling documented in `src/server/protocol.ts`.

#### ~~17. Multiple WebSocket connections per player~~ *(done)*

Old sockets closed before accepting new connection.

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
