# Adapter

## Category

Structural

## Intent

Decouple game logic from the communication mechanism so that the same set of player actions (submit orders, skip phases, request rematch, etc.) can be dispatched either locally against the game engine or over a WebSocket to a remote server, without any calling code knowing which path is in use.

## How It Works in Delta-V

The pattern revolves around a single `GameTransport` interface that defines every action a player can take during a game session. Two concrete adapter factories implement this interface with entirely different internals:

1. **`createLocalTransport`** -- Adapts the shared game engine into the `GameTransport` shape. Each method calls a local resolution function (e.g. `resolveAstrogationStep`, `resolveCombatStep`) through a helper `dispatchLocalResolution` that extracts the current state, runs the engine, and feeds the result back through `deps.onResolution`. Some methods like `sendChat` and `submitSurrender` are intentionally no-ops because those concepts do not apply to local/AI games.

2. **`createWebSocketTransport`** -- Adapts a raw `send(msg: unknown) => void` WebSocket callback into the same `GameTransport` shape. Each method serializes its arguments into a typed JSON message (`{ type, ...payload }`) via the `createTypedMessageSender` helper. There is no game-engine logic here at all; the server handles resolution.

A third higher-level factory, `createLocalGameTransport`, wraps `createLocalTransport` with additional callbacks for fleet-ready resolution, emplacement handling, and rematch logic. This is effectively a decorated adapter that layers single-player orchestration on top of the core local adapter.

The adapter is stored on `ClientSession.transport` and swapped at connection/session-start time. All downstream code -- action modules (`astrogation-actions`, `combat-actions`, `ordnance-actions`), the command router, and the main interaction controller -- accesses transport through a `getTransport()` getter and never checks which concrete implementation is behind it.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/transport.ts` | 35-51 | `GameTransport` interface definition |
| `src/client/game/transport.ts` | 115-239 | `createLocalTransport` factory |
| `src/client/game/transport.ts` | 319-339 | `createLocalGameTransport` decorated factory |
| `src/client/game/transport.ts` | 352-404 | `createWebSocketTransport` factory |
| `src/client/game/connection.ts` | 239 | WebSocket transport instantiation on connect |
| `src/client/game/main-session-shell.ts` | 52 | Local transport instantiation import |
| `src/client/game/session-model.ts` | ~9 | `transport` field typed as `GameTransport` |

## Code Examples

The `GameTransport` interface that both adapters satisfy:

```ts
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

The local adapter resolves actions through the engine directly:

```ts
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
  // ...
  sendChat() {
    // No chat in local/AI games
  },
});
```

The WebSocket adapter serializes and sends JSON messages:

```ts
export const createWebSocketTransport = (
  send: (msg: unknown) => void,
): GameTransport => ({
  submitAstrogation: createTypedMessageSender(
    send,
    'astrogation',
    (orders) => ({ orders }),
  ),
  submitCombat: createTypedMessageSender(send, 'combat', (attacks) => ({
    attacks,
  })),
  // ...
  sendChat: createTypedMessageSender(send, 'chat', (text) => ({
    text,
  })),
});
```

The connection manager swaps in the WebSocket adapter at connect time:

```ts
// connection.ts line 239
deps.setTransport(createWebSocketTransport((msg) => send(msg)));
```

## Consistency Analysis

The adapter pattern is applied consistently and cleanly:

- **Single interface, two implementations.** No conditional branching on "is this local or remote?" leaks out of the transport layer. Action modules call `getTransport().submitAstrogation(orders)` regardless of game mode.
- **No-op methods are explicit.** `sendChat()` and `submitSurrender()` in the local transport are empty-bodied with explanatory comments rather than throwing or silently omitting the methods. This keeps the interface honest.
- **Helper reuse is good.** The local adapter funnels most methods through `dispatchLocalResolution`, and the WebSocket adapter uses `createTypedMessageSender` to eliminate boilerplate. Both reduce the chance of interface drift.
- **Typed message construction** in `createTypedMessageSender` is generic and extensible -- adding a new transport method requires minimal new code.

One minor inconsistency: `submitEmplacement` in the local transport bypasses `dispatchLocalResolution` and calls `processEmplacement` directly with its own result handling path. This is because emplacement produces a different result shape (`LocalEmplacementResult`), but it means the error-handling flow diverges from every other method.

## Completeness Check

**Strengths:**
- The adapter completely hides the transport mechanism from all consumers.
- The decorated `createLocalGameTransport` cleanly layers additional single-player concerns without modifying the base adapter.
- The pattern is well-tested: `transport.test.ts` covers both adapters.

**Potential improvements:**
- **Return types are void.** Every transport method returns `void`, which means error handling is entirely callback-based. If the codebase ever needs request-response semantics (e.g. confirmation from the server before proceeding), the interface would need to evolve to return `Promise<Result>` or similar. For now, the fire-and-forget model works.
- **No adapter for spectator mode.** Spectators connect over WebSocket and use the same `GameTransport` but never call action methods. A read-only spectator transport that throws on write operations could enforce this invariant at the type level.
- **Emplacement asymmetry.** As noted above, `submitEmplacement` in the local adapter takes a different code path. Unifying it behind the same `dispatchLocalResolution` helper (or a variant that handles the different result type) would improve consistency.

## Related Patterns

- **Facade (pattern 17):** `createGameClient` in `client-kernel.ts` is the composition root that wires up the transport adapter along with everything else. The facade decides which adapter to use based on game mode.
- **Proxy / Lazy Evaluation (pattern 18):** `createActionDeps` lazily caches the dependency bundles that include `getTransport`, so the transport reference is resolved at call time rather than construction time. This allows the transport to be swapped without rebuilding all action deps.
- **Strategy:** The adapter pattern here is closely related to Strategy -- the `GameTransport` interface acts as a strategy that can be swapped at runtime between local and remote implementations.
