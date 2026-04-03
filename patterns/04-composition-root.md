# Composition Root

**Category:** Architectural

## Intent

Centralize the creation and wiring of all application dependencies in a single location (the "composition root") so that modules receive their dependencies through injection rather than constructing them internally. This makes modules independently testable and keeps the dependency graph explicit.

## How It Works in Delta-V

Delta-V uses the composition root pattern extensively on both client and server, with factory functions that wire dependencies at the top level and pass them down as typed `Deps` interfaces.

**Client composition root: `createGameClient` in `client-kernel.ts`**

This is the primary composition root for the browser client. It:
1. Constructs all top-level services: renderer, UI manager, tutorial, input handler, camera controller, HUD controller, turn timer, session tokens.
2. Wires them together through explicit dependency objects (`actionDeps`, `sessionShell`, `interactions`).
3. Returns a `GameClient` object with a `dispose()` method for cleanup.

The function does not use a DI container. Dependencies are wired manually through factory calls, each of which takes a typed deps object.

**Server composition root: `GameDO` class in `game-do.ts`**

The `GameDO` Durable Object class acts as the server's composition root. It creates typed deps objects for each subsystem through `create*Deps` methods:
- `createFetchDeps()` -- HTTP handler dependencies
- `createAlarmDeps()` -- Alarm (timeout) handler dependencies
- `createPublicationDeps()` -- State publication pipeline
- `createGameStateActionDeps()` -- Engine action runner
- `createInitRequestDeps()` -- Room initialization
- `createWebSocketMessageDeps()` -- WebSocket message handling
- `createWebSocketCloseDeps()` -- WebSocket close handling
- And several more.

Each `create*Deps` method returns a plain object conforming to a typed interface. The subsystem modules (e.g., `ws.ts`, `alarm.ts`, `publication.ts`) accept these deps objects as their first parameter, never reaching into the `GameDO` class directly.

## Key Locations

| Purpose | File | Lines |
|---|---|---|
| Client composition root | `src/client/game/client-kernel.ts` | 47-221 |
| Server deps factories | `src/server/game-do/game-do.ts` | 330-509 |
| Publication deps interface | `src/server/game-do/publication.ts` | 17-28 |
| Action deps interface | `src/server/game-do/actions.ts` | 85-98 |
| WebSocket message deps | `src/server/game-do/ws.ts` | 17-34 |
| WebSocket close deps | `src/server/game-do/ws.ts` | 124-130 |
| Alarm deps interface | `src/server/game-do/alarm.ts` | (AlarmDeps type) |
| Client action deps factory | `src/client/game/action-deps.ts` | full file |
| Connection manager deps | `src/client/game/connection.ts` | 13-28 |
| Local transport deps | `src/client/game/transport.ts` | 53-68 |

## Code Examples

The server's `GameDO` constructs deps objects for each subsystem (`src/server/game-do/game-do.ts`):

```typescript
// src/server/game-do/game-do.ts lines 373-384
private createPublicationDeps(): PublicationDeps {
  return {
    storage: this.storage,
    env: this.env,
    waitUntil: (promise) => this.waitUntil(promise),
    getGameCode: () => this.getGameCode(),
    verifyProjectionParity: (state) => this.verifyProjectionParity(state),
    broadcastStateChange: (state, primaryMessage) =>
      this.broadcastStateChange(state, primaryMessage),
    startTurnTimer: (state) => this.startTurnTimer(state),
  };
}
```

The publication module declares its dependency contract as a plain interface (`src/server/game-do/publication.ts`):

```typescript
// src/server/game-do/publication.ts lines 17-28
export interface PublicationDeps {
  storage: DurableObjectStorage;
  env: { DB: D1Database; MATCH_ARCHIVE?: R2Bucket };
  waitUntil: (promise: Promise<unknown>) => void;
  getGameCode: () => Promise<string>;
  verifyProjectionParity: (state: GameState) => Promise<void>;
  broadcastStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
  ) => void;
  startTurnTimer: (state: GameState) => Promise<void>;
}
```

The client composition root wires services through factory calls (`src/client/game/client-kernel.ts`):

```typescript
// src/client/game/client-kernel.ts lines 47-154 (abbreviated)
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();
  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const ui = createUIManager();
  const map = buildSolarSystemMap();
  // ... more construction ...

  const actionDeps = createActionDeps({
    getGameState: () => ctx.gameStateSignal.peek(),
    getClientState: () => ctx.stateSignal.peek(),
    getPlayerId: () => ctx.playerId as PlayerId,
    getTransport: () => ctx.transport,
    getMap: () => map,
    // ... more deps ...
  });

  const sessionShell = createMainSessionShell({
    ctx, map, renderer, ui, hud, actionDeps,
    turnTelemetry, sessionTokens, turnTimer, tutorial,
    // ...
  });
  // ...
};
```

## Consistency Analysis

**Strengths:**

- The server side is exceptionally well-decomposed. Every subsystem (`ws.ts`, `alarm.ts`, `publication.ts`, `socket.ts`, `fetch.ts`, `match.ts`) accepts a typed deps interface, making each independently testable. The test files confirm this -- e.g., `ws.test.ts` constructs fake deps objects.
- The deps pattern is applied consistently across all 10+ server subsystems with no exceptions.
- The client follows the same pattern for key services like `ConnectionManager`, `GameTransport`, and `HudController`.

**Weaknesses:**

- The `createGameClient` function in `client-kernel.ts` uses mutable closure variables (`let applyGameState`, `let setState`, `let transitionToPhase`, `let replayController`) to resolve circular dependencies between the session shell and client kernel. This is a pragmatic solution but it obscures the dependency graph -- the variables are assigned after construction, creating a temporal coupling.
- The `connection.ts` module creates a `new WebSocket(...)` directly inside `connect()` rather than receiving a WebSocket factory through deps. This means the connection module has a hard dependency on the browser's `WebSocket` constructor.
- Similarly, `session-api.ts` calls `fetch()` directly rather than through an injected HTTP client. Both of these are platform seams that could benefit from injection for testing.
- The `GameDO` class has 13 `create*Deps` methods, which is a lot of boilerplate. Each method manually maps `this.method` to deps fields. While this is explicit and testable, the repetition suggests the class might benefit from a shared deps-building utility.

## Completeness Check

- **No DI container needed.** The manual wiring approach is appropriate for this codebase size. A container would add complexity without proportional benefit.
- **Consider: WebSocket and fetch injection.** The two remaining hard platform dependencies (`new WebSocket` in `connection.ts`, `fetch` in `session-api.ts`) could be injected through the deps interfaces to enable full unit testing without browser globals.
- **Consider: reducing closure mutations in client-kernel.** The `let` variables could potentially be replaced with a builder pattern or a two-phase initialization object, though the current approach works correctly.

## Related Patterns

- **Hexagonal Architecture** (05) -- The deps interfaces act as ports; the composition root plugs in concrete adapters.
- **Layered Architecture** (03) -- The composition root wires layers without crossing boundaries.
- **SRP Choke Points** (06) -- The composition root is where choke-point functions like `publishStateChange` get their dependencies wired.
