# Factory Functions

## Category

Creational

## Intent

Encapsulate object construction behind plain functions so that callers never use
`new`, class constructors, or inline object assembly. This keeps the codebase
free of class hierarchies, makes return types inferrable via
`ReturnType<typeof createX>`, and lets each factory close over private state
that is invisible to consumers.

## How It Works in Delta-V

Delta-V uses `const createX = (...) => { ... }` as its universal construction
idiom. Every major subsystem -- renderer, UI, connection, transport, session,
HUD, input, camera, planning, timers, telemetry -- is created through an
exported factory function rather than a class constructor.

The pattern has three recurring shapes:

1. **Closure-based module factories** -- The factory allocates private mutable
   state inside the closure and returns an object literal of methods that close
   over it. There is no `this`; state is captured lexically. Examples:
   `createRenderer`, `createConnectionManager`, `createUIManager`,
   `createGameClient`.

2. **Plain data factories** -- The factory returns a fresh value object with no
   methods. Examples: `createInitialClientSession`, `createPlanningStore`,
   `createAggregateMetrics`, `createClearedCombatPlan`.

3. **Dependency-injection factories** -- The factory receives a `deps` or
   similar options bag, wires the dependencies together, and returns a
   ready-to-use service object. Examples: `createActionDeps`,
   `createMainSessionShell`, `createHudController`,
   `createMainInteractionController`.

Exported type aliases are typically derived from the factory itself:

```ts
// src/client/renderer/renderer.ts:555
export type Renderer = ReturnType<typeof createRenderer>;
```

This avoids a separate interface definition and guarantees the type stays in
sync with the implementation.

### Composition Root

`createGameClient` (src/client/game/client-kernel.ts) acts as the composition
root. It calls roughly 15 other `create*` factories in sequence, threading
their results into one another. The ordering is significant because some
factories need handles that are only available after later factories run (the
`applyGameState` / `setState` / `transitionToPhase` variables are assigned
after `createMainSessionShell` returns).

```ts
// src/client/game/client-kernel.ts:47-48
export const createGameClient = () => {
  const ctx: ClientSession = createInitialClientSession();
```

```ts
// src/client/game/client-kernel.ts:50-58
  const canvas = byId<HTMLCanvasElement>('gameCanvas');
  const renderer = createRenderer(canvas, ctx.planningState);
  const ui = createUIManager();
  const tutorial = createTutorial();
  tutorial.onTelemetry = (evt) => track(evt);
  const tooltipEl = byId('shipTooltip');
  const transferPanelEl = byId('transferPanel');
  const map = buildSolarSystemMap();
  const turnTelemetry = createTurnTelemetryTracker();
```

### Transport Factory Layering

The transport subsystem demonstrates factory composition. Three factories exist
at increasing levels of abstraction:

```ts
// src/client/game/transport.ts:115-117
export const createLocalTransport = (
  deps: LocalTransportDeps,
): GameTransport => ({
```

```ts
// src/client/game/transport.ts:319-322
export const createLocalGameTransport = (
  deps: LocalGameTransportDeps,
): GameTransport =>
  createLocalTransport({
```

```ts
// src/client/game/transport.ts:352-354
export const createWebSocketTransport = (
  send: (msg: unknown) => void,
): GameTransport => ({
```

`createLocalGameTransport` wraps `createLocalTransport`, adapting a
higher-level deps bag into the lower-level one. Both return the same
`GameTransport` interface, which `createWebSocketTransport` also implements
with a completely different backing mechanism (serialised WebSocket messages).

## Key Locations

| Factory | File | Line |
|---|---|---|
| `createGameClient` | `src/client/game/client-kernel.ts` | 47 |
| `createRenderer` | `src/client/renderer/renderer.ts` | 69 |
| `createUIManager` | `src/client/ui/ui.ts` | 42 |
| `createConnectionManager` | `src/client/game/connection.ts` | 89 |
| `createLocalTransport` | `src/client/game/transport.ts` | 115 |
| `createLocalGameTransport` | `src/client/game/transport.ts` | 319 |
| `createWebSocketTransport` | `src/client/game/transport.ts` | 352 |
| `createInitialClientSession` | `src/client/game/session-model.ts` | 59 |
| `createPlanningStore` | `src/client/game/planning.ts` | 273 |
| `createMainSessionShell` | `src/client/game/main-session-shell.ts` | 87 |
| `createActionDeps` | `src/client/game/action-deps.ts` | 61 |
| `createHudController` | `src/client/game/hud-controller.ts` | 34 |
| `createMainInteractionController` | `src/client/game/main-interactions.ts` | 101 |
| `createCamera` | `src/client/renderer/camera.ts` | 77 |
| `createMovementAnimationManager` | `src/client/renderer/animation.ts` | 86 |
| `createTurnTimerManager` | `src/client/game/timer.ts` | 53 |
| `createHUDChromeView` | `src/client/ui/hud-chrome-view.ts` | 75 |
| `createLobbyView` | `src/client/ui/lobby-view.ts` | 49 |
| `createOverlayView` | `src/client/ui/overlay-view.ts` | 12 |
| `createGameLogView` | `src/client/ui/game-log-view.ts` | 46 |
| `createShipListView` | `src/client/ui/ship-list-view.ts` | 25 |
| `createFleetBuildingView` | `src/client/ui/fleet-building-view.ts` | 33 |
| `createSessionApi` | `src/client/game/session-api.ts` | 59 |
| `createTutorial` | `src/client/tutorial.ts` | 76 |
| `createInputHandler` | `src/client/input.ts` | 15 |
| `createGame` (engine) | `src/shared/engine/game-creation.ts` | 133 |
| `createGameStateActionHandlers` | `src/server/game-do/actions.ts` | 107 |

## Code Examples

### Closure-based module (renderer)

```ts
// src/client/renderer/renderer.ts:69-78
export const createRenderer = (
  canvas: HTMLCanvasElement,
  planningState: PlanningState,
) => {
  const ctx = must(canvas.getContext('2d'));
  const camera = createCamera();
  const stars: Star[] = generateStars(600, 2000);
  const movementAnimation = createMovementAnimationManager();
  const staticLayerRef: { layer: StaticSceneLayer | null } = { layer: null };
  // ...private mutable state...
```

The factory closes over `ctx`, `camera`, `stars`, `movementAnimation`, and
several mutable variables (`map`, `gameState`, `playerId`, etc.), then returns
an object of methods. Callers see only the public surface; all mutation is
internal.

### Dependency-injection factory (connection)

```ts
// src/client/game/connection.ts:89-97
export const createConnectionManager = (
  deps: ConnectionDeps,
): ConnectionManager => {
  const runtime: ConnectionRuntime = {
    ws: null,
    pingInterval: null,
    reconnectTimer: null,
    suppressDisconnectHandling: false,
  };
```

The `deps` bag contains 13 callback/getter functions. The factory wires them
into a private `runtime` object and returns a narrow `ConnectionManager`
interface.

### Data factory (session model)

```ts
// src/client/game/session-model.ts:59-60
export const createInitialClientSession = (): ClientSession => {
  type ClientSessionDraft = Omit<
```

Returns a fresh `ClientSession` with reactive signal properties wired through
`defineReactiveSessionProperty`. A companion `stubClientSession` factory
overlays test overrides.

## Consistency Analysis

**Very consistent.** The codebase contains approximately 50+ `create*` factory
functions and only a single `class` declaration in the entire `src/` tree:

```ts
// src/server/game-do/game-do.ts:71
export class GameDO extends DurableObject<Env> {
```

This class exists because Cloudflare Durable Objects require class-based
exports -- it is an external framework constraint, not a design choice. Every
other subsystem uses the factory function pattern.

Usage of `new` in production code is limited to platform APIs
(`new WebSocket(...)`, `new URL(...)`, `new Set(...)`, `new Map(...)`,
`new AudioContext()`). No application-level objects are constructed with `new`.

Naming is highly consistent: every factory begins with `create`. Return types
use `ReturnType<typeof createX>` where an explicit type alias is needed.

## Completeness Check

The pattern is applied comprehensively. A few observations:

1. **Deferred assignment in the composition root** -- In `createGameClient`,
   variables like `applyGameState`, `setState`, and `transitionToPhase` are
   declared with `let` and assigned after `createMainSessionShell` runs. This
   is a consequence of circular dependency between the action deps and session
   shell. While functional, it introduces a window where the variables are
   undefined. A two-phase initialization (create then wire) could make this
   safer.

2. **No factory for `ConnectionRuntime`** -- The runtime object inside
   `createConnectionManager` is constructed inline. Since it is purely internal
   this is fine, but a `createConnectionRuntime()` helper would make tests
   easier to stub.

3. **UI sub-view factories** -- All UI views follow the factory pattern
   consistently (`createHUDChromeView`, `createLobbyView`, etc.), but they are
   composed inside `createUIManager` which then spreads their methods onto its
   return value. This means the UIManager's public API is the union of many
   sub-views, which could grow unwieldy.

## Related Patterns

- **Builder (Game Setup)** -- `createGame` is a factory that performs builder-like
  multi-step assembly of a `GameState`.
- **Multiton (Preset Registries)** -- Factory functions frequently look up preset
  registries (`SCENARIOS`, `AI_CONFIG`, `SHIP_STATS`) during construction.
- **Dependency Injection** -- Nearly every factory accepts a typed `deps` bag,
  making DI the standard wiring mechanism.
