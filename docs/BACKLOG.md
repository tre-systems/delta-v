# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Gameplay & Content

### Turn replay

Let players step backward and forward through recorded
turn history after a game ends, and optionally during
play.

The current lightweight `GameEvent` log is already in
place; remaining work is replay presentation, history
loading/catch-up, and timeline controls.

**Files:** `src/shared/events.ts`,
`src/server/game-do/game-do.ts`, client replay UI

### Spectator mode

Allow read-only third-party connections that receive
state broadcasts and replay/catch-up data but cannot
submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat
type / auth), `src/server/protocol.ts`,
client spectator UI

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

### Passenger rescue mechanics

Add passenger-specific transfer / rescue rules for
rescue scenarios.

Fuel and cargo transfer are already implemented; the
remaining work is passenger state, rescue objectives,
and the related UI / log presentation.

**Files:** `src/shared/engine/logistics.ts`,
`src/shared/engine/victory.ts`, `src/shared/types/`,
`src/client/game/logistics-ui.ts`,
`src/client/ui/game-log-view.ts`

---

## Reliability & Hardening

### Replacement socket disconnect race

Prevent server-initiated socket replacement during
reconnect from creating a disconnect marker and later
forfeit.

The Durable Object should distinguish between a genuine
disconnect and an intentional socket swap for the same
player.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/game-do/session.ts`

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

### Reconnect teardown consistency

Route all reconnect cancel / reconnect exhausted exits
through the same session teardown path as normal
"Exit to Menu" flow.

Prevents stale `gameCode`, transport, and history state
from surviving after the UI has returned to the menu.

**Files:** `src/client/game/connection.ts`,
`src/client/game/session-controller.ts`,
`src/client/main.ts`

### Service worker API bypass rules

Restrict service-worker caching to safe GET asset /
navigation traffic and explicitly bypass reporting and
other API routes.

Prevents `/telemetry`, `/error`, and future non-GET
endpoints from being intercepted by cache logic.

**Files:** `static/sw.js`

---

## Operations & Performance

### Reduce DO inactivity write amplification

The Durable Object currently updates inactivity storage
on every valid client message, including frequent `ping`
traffic.

Debounce / cache `inactivityAt` in memory and keep chat
rate-limit state in memory where possible to reduce DO
I/O and alarm rescheduling churn.

**Files:** `src/server/game-do/game-do.ts`

### Event Sourcing for Replays

To support the "Turn Replay" feature without state-snapshot bloat, transition the engine to [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html), emitting a strict append-only log of domain events (`ShipMoved`, `DamageTaken` etc.).

### Adopt `reactive.ts` for Complex UI

Begin adopting the existing zero-dependency `reactive.ts` signals library to consolidate DOM synchronization logic for complex overlays (like lobbies or fleet building) and prevent the manual `ui.ts` layer from becoming brittle.

### Engine Mutation Optimization

Investigate adopting structural sharing (e.g., [Immer](https://immerjs.github.io/immer/)) to optimize the `structuredClone(inputState)` brute-force deep-cloning occurring on every engine entry point.

---

## Security & Abuse Prevention

### Rate Limit Room Creation

To prevent malicious actors from spamming `POST /create` and instantiating thousands of empty Durable Objects (incurring compute and storage overhead), apply a Cloudflare WAF Rate Limiting rule restricting `/create` to ~5 requests per IP per minute.

### In-Memory WebSocket Throttling

To prevent an attacker from joining a room and blasting 10,000 garbage WebSocket messages a second (which could force DO I/O or cpu spikes), add an in-memory counter in the `webSocketMessage` handler. Drop connections that exceed reasonable client bounds (e.g., > 10 messages/sec).
