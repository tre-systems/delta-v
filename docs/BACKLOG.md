# Delta-V Backlog

Remaining work only. Completed items are in git history.

## Gameplay & Content

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

### Spectator mode — client UI and live stream

Server-side spectator transport is complete: viewer-
aware filtering, spectator replay delivery, spectator-
tagged broadcasts, and WebSocket boundary enforcement
are all wired and tested. Live spectator WebSocket
joins are explicitly rejected (501) for now.

Remaining work is client-side: a spectator join flow,
real-time spectator state display during live games,
and the protocol extension to accept live spectator
WebSocket connections.

**Files:** `src/server/game-do/game-do.ts`,
`src/server/protocol.ts`,
`src/client/game/client-kernel.ts`, client spectator UI

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

---
