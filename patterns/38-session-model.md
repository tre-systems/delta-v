# Session Model (Aggregate Root)

## Category
Client-Specific

## Intent
Provide a single, canonical source of truth for all client-side session state -- connection status, player identity, game state, planning, logistics, and transport -- so that every subsystem reads from one place and reactive effects can observe changes through backing signals.

## How It Works in Delta-V

The `ClientSession` interface defines the complete shape of a client session. It is the aggregate root: every piece of client state either lives directly on it or is reachable through it.

The key design features are:

1. **Reactive property pairs**: Most fields have a paired `ReadonlySignal` (e.g., `state` + `stateSignal`, `gameState` + `gameStateSignal`). The `defineReactiveSessionProperty()` helper wires these up using `Object.defineProperty` so that writing `session.state = 'menu'` transparently updates the backing signal, and any effect watching `session.stateSignal.value` re-runs.

2. **Owned sub-stores**: The session owns `planningState: PlanningStore` and `logisticsState: LogisticsStore | null`, keeping all mutable client state under one roof.

3. **Narrowing via Pick types**: Consumers receive subsets of the session through `ClientSessionMessageContext`, `ClientSessionStateTransitionContext`, etc. This limits what each module can read/write without creating separate objects.

4. **Factory + stub pattern**: `createInitialClientSession()` produces a fully initialized session with default values. `stubClientSession(overrides)` merges overrides for testing.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/session-model.ts` | 31-57 | `ClientSession` interface |
| `src/client/game/session-model.ts` | 11-28 | `defineReactiveSessionProperty()` helper |
| `src/client/game/session-model.ts` | 59-153 | `createInitialClientSession()` |
| `src/client/game/session-model.ts` | 156-166 | `ClientSessionMessageContext` narrowing |
| `src/client/game/session-model.ts` | 169-178 | `ClientSessionStateTransitionContext` narrowing |
| `src/client/game/session-model.ts` | 181-196 | `stubClientSession()` test helper |
| `src/client/game/client-kernel.ts` | 48 | `const ctx: ClientSession = createInitialClientSession()` |

## Code Examples

The reactive property helper binds a plain property to a signal:

```typescript
// src/client/game/session-model.ts
const defineReactiveSessionProperty = <T>(
  session: object,
  key: string,
  initial: T,
): ReadonlySignal<T> => {
  const backingSignal = signal(initial);

  Object.defineProperty(session, key, {
    enumerable: true,
    configurable: false,
    get: () => backingSignal.value,
    set: (next: T) => {
      backingSignal.value = next;
    },
  });

  return backingSignal;
};
```

Session creation wires up all reactive properties:

```typescript
// src/client/game/session-model.ts
const session = {
  spectatorMode: false,
  scenario: 'biplanetary',
  aiDifficulty: 'normal',
  transport: null,
  planningState: createPlanningStore(),
  reconnectAttempts: 0,
} as ClientSessionDraft;

session.stateSignal = defineReactiveSessionProperty(session, 'state', 'menu');
session.playerIdSignal = defineReactiveSessionProperty(session, 'playerId', -1);
session.gameCodeSignal = defineReactiveSessionProperty(session, 'gameCode', null);
session.gameStateSignal = defineReactiveSessionProperty(session, 'gameState', null);
// ... more properties
```

Narrowed context types limit what message handlers can access:

```typescript
// src/client/game/session-model.ts
export type ClientSessionMessageContext = Pick<
  ClientSession,
  | 'state'
  | 'playerId'
  | 'gameCode'
  | 'reconnectAttempts'
  | 'latencyMs'
  | 'gameState'
  | 'reconnectOverlayState'
  | 'opponentDisconnectDeadlineMs'
>;
```

## Consistency Analysis

The `ClientSession` is genuinely the single source of session truth:

- **Connection state** (`state`, `gameCode`, `reconnectAttempts`, `reconnectOverlayState`, `opponentDisconnectDeadlineMs`) -- all on the session.
- **Player identity** (`playerId`, `spectatorMode`) -- on the session.
- **Game state** (`gameState`) -- on the session.
- **Planning state** (`planningState`) -- owned by the session.
- **Logistics state** (`logisticsState`) -- on the session.
- **Transport** (`transport`) -- on the session.
- **Presentation hints** (`latencyMs`, `isLocalGame`, `aiDifficulty`) -- on the session.

No state was found living outside the session that should logically be part of it. The `CommandRouterSessionRead` interface provides getter-based access to the session for the command dispatch layer, further confirming it is the canonical read path.

## Completeness Check

The pattern is well-implemented:

- **All reactive properties have signals**: `state`, `playerId`, `gameCode`, `gameState`, `logisticsState`, `isLocalGame`, `latencyMs`, `reconnectOverlayState`, `opponentDisconnectDeadlineMs` all have backing signals.
- **Non-reactive fields** (`spectatorMode`, `scenario`, `aiDifficulty`, `transport`, `reconnectAttempts`) are plain properties because they change infrequently or are not observed reactively.
- **Test support**: `stubClientSession` allows partial overrides, making tests concise.

One consideration: the `defineReactiveSessionProperty` approach uses `Object.defineProperty` which makes the property non-configurable. This is intentional -- it prevents accidental replacement of the signal-backed getter/setter.

## Related Patterns

- **Planning Store** (Pattern 37): Owned as `session.planningState`.
- **Disposal Scope** (Pattern 36): Session effects are grouped into disposal scopes for lifecycle management.
- **3-Layer Input Pipeline** (Pattern 41): The command router reads session state via `CommandRouterSessionRead`.
