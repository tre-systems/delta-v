# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Open issues

#### 26. Minimap is not interactive

The minimap shows planet/ship positions but clicking it
doesn't pan the main camera. Click-to-navigate would solve
the "can't find my ship" problem.

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
