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

---

## Security & Abuse Prevention

### Rate Limit Room Creation

To prevent malicious actors from spamming `POST /create` and instantiating thousands of empty Durable Objects (incurring compute and storage overhead), apply a Cloudflare WAF Rate Limiting rule restricting `/create` to ~5 requests per IP per minute.

### In-Memory WebSocket Throttling

To prevent an attacker from joining a room and blasting 10,000 garbage WebSocket messages a second (which could force DO I/O or cpu spikes), add an in-memory counter in the `webSocketMessage` handler. Drop connections that exceed reasonable client bounds (e.g., > 10 messages/sec).
