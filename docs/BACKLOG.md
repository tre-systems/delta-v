# Delta-V Backlog

Remaining work only. Completed items are in git history.

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

---

## Technical Debt & Architecture

### Fix DO Write Amplification

Cloudflare Durable Object (`game-do.ts`) writes to storage on every valid client message (including frequent `ping` and `chat` messages) by calling `touchInactivity()` which triggers `this.ctx.storage.put('inactivityAt', ...)` and `rescheduleAlarm()` (forcing 3 more reads).
* **Task:** Implement in-memory debouncing for `inactivityAt` and use in-memory rate limiting for chat to save DO I/O and reduce costs.

### Event Sourcing for Replays

To support the "Turn Replay" feature, broadcasting and saving full state snapshots will become a bottleneck.
* **Task:** Transition the engine to emit a strict append-only log of domain events (`ShipMoved`, `OrdnanceFired`, `DamageTaken` etc.). Turn replays can then act as a state reduction over the event array.

### Adopt `reactive.ts` for Complex UI

The UI overlay currently relies on heavy manual DOM manipulation in `ui.ts` (~2200 LOC). As features like Spectator Mode and Replays are added, this will become brittle.
* **Task:** Begin adopting the existing Zero-dependency `reactive.ts` signals library for complex overlays like fleet building and lobby state to consolidate DOM synchronization logic.

### Engine Mutation Optimization

Every engine entry point deep-clones the entire state (`structuredClone(inputState)`). While incredibly safe (guarantees rollback), this is a brute-force approach that will degrade performance as state size and turn histories grow.
* **Task:** Investigate adopting structural sharing (e.g., Immer) or relying solely on Event Sourcing deltas instead of full deep copies on every turn constraint.

---

## Hardening

### Reconnect teardown consistency

Route all reconnect cancel / reconnect exhausted exits
through the same session teardown path as normal
"Exit to Menu" flow.

Prevents stale `gameCode`, transport, and history state
from surviving after the UI has returned to the menu.

**Files:** `src/client/game/connection.ts`,
`src/client/game/session-controller.ts`,
`src/client/main.ts`

### Replacement socket disconnect race

Prevent server-initiated socket replacement during
reconnect from creating a disconnect marker and later
forfeit.

The Durable Object should distinguish between a genuine
disconnect and an intentional socket swap for the same
player.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/session.ts`

### Service worker API bypass rules

Restrict service-worker caching to safe GET asset /
navigation traffic and explicitly bypass reporting and
other API routes.

Prevents `/telemetry`, `/error`, and future non-GET
endpoints from being intercepted by cache logic.

**Files:** `static/sw.js`

### First-connect failure handling

Differentiate initial WebSocket join failure from an
in-progress game disconnect.

Handshake failures like "game full", "join token
required", or "game not found" should surface clearly to
the user instead of entering the reconnect backoff loop.

Possible approaches: add an HTTP preflight join check or
track whether the client has ever reached a successful
connected session before enabling reconnect behavior.

**Files:** `src/client/game/network.ts`,
`src/client/game/connection.ts`,
`src/client/main.ts`
