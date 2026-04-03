# Hexagonal Architecture (Ports and Adapters)

**Category:** Architectural

## Intent

Define abstract interfaces ("ports") at application boundaries so that the core domain logic is decoupled from transport mechanisms, storage, and UI frameworks. Concrete "adapters" implement these ports for specific platforms (WebSocket, local engine, Durable Object storage), enabling the same game logic to run in multiplayer and single-player modes without modification.

## How It Works in Delta-V

The clearest manifestation of hexagonal architecture in Delta-V is the `GameTransport` interface, which defines the port through which the client's game logic sends commands to the game engine -- regardless of whether the engine is remote (multiplayer) or local (single-player/AI).

**The port: `GameTransport`**

The `GameTransport` interface in `transport.ts` defines 14 command methods covering every game-state action plus chat and rematch. It contains no implementation -- just the contract.

**Adapter 1: `createWebSocketTransport`**

For multiplayer games, this adapter serializes each command as a JSON message and sends it through a WebSocket connection. It uses a generic `createTypedMessageSender` helper to map method calls to typed protocol messages.

**Adapter 2: `createLocalTransport`**

For single-player/AI games, this adapter runs the shared engine functions directly on the client. It calls `resolveAstrogationStep`, `resolveCombatStep`, etc., which invoke the pure engine and route the result through the `onResolution` callback.

**Adapter 3: `createLocalGameTransport`**

A higher-level adapter wrapping `createLocalTransport` with fleet-ready resolution, emplacement handling, and game-flow callbacks specific to the single-player experience.

**The consuming code is adapter-agnostic.** The `ClientSession` holds a `transport: GameTransport | null` field. Action modules like `astrogation-actions.ts`, `combat-actions.ts`, and `ordnance-actions.ts` call `transport.submitAstrogation(orders)`, `transport.submitCombat(attacks)`, etc., without knowing which adapter is active.

**Other port/adapter boundaries in the codebase:**

- **Server deps interfaces.** Each `create*Deps` method in `GameDO` defines a port (e.g., `PublicationDeps`, `GameDoWebSocketMessageDeps`). The `GameDO` class provides the concrete adapters by binding its own methods.
- **Storage abstraction.** The archive module takes `DurableObjectStorage` as a parameter type, acting as a port. While there is only one production adapter, tests could substitute a mock.
- **ConnectionDeps.** The `ConnectionManager` receives `ConnectionDeps` with callbacks for `handleMessage`, `showToast`, `exitToMenu`, etc., abstracting the connection lifecycle from the game UI.

## Key Locations

| Purpose | File | Lines |
|---|---|---|
| GameTransport interface (port) | `src/client/game/transport.ts` | 35-51 |
| WebSocket adapter | `src/client/game/transport.ts` | 352-404 |
| Local transport adapter | `src/client/game/transport.ts` | 115-239 |
| Local game transport adapter | `src/client/game/transport.ts` | 319-339 |
| Transport assignment (multiplayer) | `src/client/game/connection.ts` | 239 |
| Publication deps (server port) | `src/server/game-do/publication.ts` | 17-28 |
| WebSocket message deps (server port) | `src/server/game-do/ws.ts` | 17-34 |
| Connection deps (client port) | `src/client/game/connection.ts` | 13-28 |

## Code Examples

The `GameTransport` port definition (`src/client/game/transport.ts`):

```typescript
// src/client/game/transport.ts lines 35-51
export interface GameTransport {
  submitAstrogation(orders: AstrogationOrder[]): void;
  submitCombat(attacks: CombatAttack[]): void;
  submitSingleCombat(attack: CombatAttack): void;
  endCombat(): void;
  submitOrdnance(launches: OrdnanceLaunch[]): void;
  submitEmplacement(emplacements: OrbitalBaseEmplacement[]): void;
  submitFleetReady(purchases: FleetPurchase[]): void;
  submitLogistics(transfers: TransferOrder[]): void;
  submitSurrender(shipIds: string[]): void;
  skipOrdnance(): void;
  skipCombat(): void;
  skipLogistics(): void;
  beginCombat(): void;
  requestRematch(): void;
  sendChat(text: string): void;
}
```

The WebSocket adapter maps commands to protocol messages (`src/client/game/transport.ts`):

```typescript
// src/client/game/transport.ts lines 352-404
export const createWebSocketTransport = (
  send: (msg: unknown) => void,
): GameTransport => ({
  submitAstrogation: createTypedMessageSender(
    send, 'astrogation', (orders) => ({ orders }),
  ),
  submitCombat: createTypedMessageSender(
    send, 'combat', (attacks) => ({ attacks }),
  ),
  // ... remaining commands ...
  sendChat: createTypedMessageSender(
    send, 'chat', (text) => ({ text }),
  ),
});
```

The local adapter runs the engine directly (`src/client/game/transport.ts`):

```typescript
// src/client/game/transport.ts lines 115-130 (abbreviated)
export const createLocalTransport = (
  deps: LocalTransportDeps,
): GameTransport => ({
  submitAstrogation(orders) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveAstrogationStep(state, playerId, orders, map),
      deps.onAnimationComplete,
      'Local astrogation error:',
    );
  },
  // ... remaining commands ...
});
```

## Consistency Analysis

**Strengths:**

- The `GameTransport` interface is a clean hexagonal port. All 14 methods are implemented by both adapters, and the type system enforces completeness.
- Consumer code never checks which transport is active -- it calls the interface methods uniformly. This is verified by searching for `transport.submit*` calls throughout `src/client/game/`.
- The `LocalTransportDeps` interface follows the same ports-and-adapters pattern within the local adapter itself, abstracting resolution callbacks.

**Weaknesses:**

- The `submitSurrender` method on the local transport is a no-op (`// Surrender in local games is handled directly via engine`), and `sendChat` is also empty (`// No chat in local/AI games`). These are acceptable for the current use case, but they violate the Liskov Substitution Principle -- callers cannot rely on all commands having effect regardless of adapter.
- The `submitEmplacement` method on the local transport calls `processEmplacement` directly from the shared engine rather than going through the same `dispatchLocalResolution` pattern used by all other commands. This inconsistency means emplacement error handling differs from other actions.
- The server-side does not have a symmetric `GameTransport` port. The server's `GameDO` class receives commands as raw WebSocket messages and routes them through `actions.ts`. The command dispatching pattern is ad-hoc -- there is no server-side equivalent of the `GameTransport` interface that could enable, for example, an HTTP or test adapter.

## Completeness Check

- **Consider: server-side command port.** A `GameCommandPort` interface on the server would formalize the command contract and enable non-WebSocket command sources (e.g., HTTP endpoints for admin tools, test harnesses).
- **Consider: notification port.** The client receives state updates through raw WebSocket messages processed by the session shell. A `GameNotificationPort` interface (analogous to `GameTransport` for outbound) would complete the hexagonal boundary.
- **Consider: storage port.** The archive module takes `DurableObjectStorage` directly. While this is typed, extracting a minimal `EventStore` interface would make the event-sourcing layer testable without DO mocks.

## Related Patterns

- **Composition Root** (04) -- The composition root selects and wires the concrete transport adapter based on game mode (local vs. multiplayer).
- **CQRS** (02) -- `GameTransport` is the command-side port; state updates (S2C messages) are the query-side delivery mechanism.
- **Stateless Pure Engine** (07) -- Both transport adapters ultimately call the same pure engine functions, just from different locations (server vs. client).
