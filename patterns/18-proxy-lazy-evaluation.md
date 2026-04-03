# Proxy / Lazy Evaluation

## Category

Structural

## Intent

Defer the construction of expensive dependency bundles until they are first accessed, cache them so subsequent accesses are free, and use getter-based indirection so that the underlying dependencies (game state, transport, etc.) are resolved at call time rather than construction time. This avoids allocating objects that may never be used and ensures that mutable references are always current.

## How It Works in Delta-V

The primary implementation lives in `createActionDeps` (`action-deps.ts`), which builds a set of "sub-dep" bundles for different game action domains: astrogation, combat, ordnance, local game flow, and presentation. Each bundle is a plain object containing getters and callbacks that various action modules need.

The lazy evaluation mechanism has two layers:

### Layer 1: `createCachedValue` -- Lazy Construction with Memoization

A small utility creates a thunk that builds the value on first call and caches it forever:

```ts
const createCachedValue = <T>(build: () => T): (() => T) => {
  let cached: T | undefined;

  return () => {
    if (cached === undefined) {
      cached = build();
    }

    return cached;
  };
};
```

This is applied to each sub-dep bundle:

```ts
const getAstrogationDeps = createCachedValue<AstrogationActionDeps>(() => ({
  getGameState: args.getGameState,
  getClientState: args.getClientState,
  getPlayerId: args.getPlayerId,
  getTransport: args.getTransport as AstrogationActionDeps['getTransport'],
  planningState: args.planningState,
  showToast,
}));
```

### Layer 2: Property Getters -- Proxy-Like Access

The returned object uses ES property getters to intercept access and delegate to the cached thunks:

```ts
return {
  get astrogationDeps() {
    return getAstrogationDeps();
  },
  get combatDeps() {
    return getCombatDeps();
  },
  // ...
};
```

This means `actionDeps.combatDeps` does not allocate the combat dependency bundle until someone actually reads the property. After the first read, the cached value is returned on all subsequent reads.

### Layer 3: Getter-Based Late Binding in Dependencies

The sub-dep bundles themselves contain getters like `getGameState`, `getTransport`, and `getPlayerId` rather than direct values. These getters close over the session state and resolve at call time. This is critical because:

- The `GameTransport` is swapped between local and WebSocket adapters during the session lifecycle.
- The `GameState` changes every turn.
- The `PlayerId` is assigned after connecting to a game.

By passing `getTransport: () => ctx.transport` rather than `transport: ctx.transport`, the action modules always get the current transport, even though the `ActionDeps` object was created once at startup.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/action-deps.ts` | 49-59 | `createCachedValue` utility |
| `src/client/game/action-deps.ts` | 61-206 | `createActionDeps` with all lazy bundles |
| `src/client/game/action-deps.ts` | 184-203 | Property getter proxy on returned object |
| `src/client/game/client-kernel.ts` | 119-138 | Where `createActionDeps` is invoked with getter args |

## Code Examples

The `createCachedValue` memoization primitive:

```ts
const createCachedValue = <T>(build: () => T): (() => T) => {
  let cached: T | undefined;

  return () => {
    if (cached === undefined) {
      cached = build();
    }

    return cached;
  };
};
```

Lazy construction of a combat deps bundle:

```ts
const getCombatDeps = createCachedValue<CombatActionDeps>(() => ({
  getGameState: args.getGameState,
  getClientState: args.getClientState,
  getPlayerId: args.getPlayerId,
  getTransport: args.getTransport as CombatActionDeps['getTransport'],
  getMap: args.getMap,
  planningState: args.planningState,
  showToast,
}));
```

Property getter proxy on the returned object:

```ts
return {
  get astrogationDeps() {
    return getAstrogationDeps();
  },
  get combatDeps() {
    return getCombatDeps();
  },
  get ordnanceDeps() {
    return getOrdnanceDeps();
  },
  get localGameFlowDeps() {
    return getLocalGameFlowDeps();
  },
  get presentationDeps() {
    return getPresentationDeps();
  },
  presentMovementResult,
  presentCombatResults: presentCombatWithPresentationDeps,
  showGameOverOutcome,
};
```

The calling site in `client-kernel.ts` passes getters for late binding:

```ts
const actionDeps = createActionDeps({
  getGameState: () => ctx.gameStateSignal.peek(),
  getClientState: () => ctx.stateSignal.peek(),
  getPlayerId: () => ctx.playerId as PlayerId,
  getTransport: () => ctx.transport,
  getMap: () => map,
  getAIDifficulty: () => ctx.aiDifficulty,
  getScenario: () => ctx.scenario,
  getIsLocalGame: () => ctx.isLocalGame,
  planningState: ctx.planningState,
  // ...
});
```

## Consistency Analysis

The lazy/proxy pattern is applied consistently within `createActionDeps` but is not widely used elsewhere in the codebase:

- **All five sub-dep bundles** (astrogation, combat, ordnance, local game flow, presentation) use the same `createCachedValue` + getter pattern. This is uniform.
- **Getter-based late binding** is used pervasively across the codebase for session state. The `ActionDepsArgs` interface contains 8 getter functions (`getGameState`, `getClientState`, `getPlayerId`, `getTransport`, `getMap`, `getAIDifficulty`, `getScenario`, `getIsLocalGame`). This pattern of passing `() => value` rather than `value` is a project-wide convention seen in `LocalTransportDeps`, `ConnectionDeps`, `HudController` deps, and others.
- **`createCachedValue` is private** to `action-deps.ts`. It is not exported or reused elsewhere, even though the same memoization concept could apply to other construction sites.
- **The comment at the top** explicitly states the design intent: "Sub-dep bundles are created lazily and cached so `createActionDeps` does not allocate fresh astrogation/combat/ordnance/local-flow objects on every access (those getters are read frequently from input and the game loop)."

## Completeness Check

**Strengths:**
- The pattern neatly solves the problem of constructing dependency bundles that may not all be needed in every game phase (e.g., local game flow deps are only used in single-player mode).
- The cache-once semantics are appropriate because the bundles contain only getters and callbacks, not values that change. The actual mutable state is resolved through the getters at call time.
- The property getter approach provides a natural API (`actionDeps.combatDeps`) without requiring explicit `.get()` calls.

**Potential improvements:**
- **`createCachedValue` could be shared.** If other composition sites have similar lazy-init needs, extracting this to a utility module would promote reuse. Currently it is the only location using this pattern.
- **No cache invalidation.** The cache is permanent for the lifetime of the `ActionDeps` instance. This is correct here because the bundles contain only stable references (getters, callbacks), but the pattern would be dangerous if applied to bundles containing snapshot values.
- **The `undefined` sentinel has a limitation.** If `build()` legitimately returned `undefined`, the cache would re-evaluate every time. This is not a practical concern here since all builders return objects, but a more robust implementation could use a boolean flag.
- **Other lazy evaluation opportunities:**
  - The `StaticSceneLayer` in the renderer uses a cache-key comparison (`computeStaticSceneLayerKey`) to avoid repainting the static scene layer every frame. This is a related but distinct form of lazy evaluation (cache invalidation by key rather than build-once).
  - The HUD controller and camera controller receive getters but construct all their internal state eagerly. If their construction is lightweight, this is fine; if it grows, applying `createCachedValue` to their internal sub-structures could help.
  - The `buildBaseThreatZoneViews` call in the renderer is invoked every frame during non-animation. Memoizing it based on game state could reduce per-frame work.

## Related Patterns

- **Facade (pattern 17):** `createGameClient` is the composition root that calls `createActionDeps`. The facade passes getter functions that enable the lazy/late-binding behavior.
- **Adapter (pattern 16):** The `getTransport` getter is what allows the transport adapter to be swapped at runtime (between local and WebSocket) without rebuilding the action deps.
- **Composite (pattern 19):** The static scene layer's key-based caching (`computeStaticSceneLayerKey` in `static-layer.ts`) is a related lazy-evaluation technique applied to the renderer's composite layer system.
