# Observer / Reactive Signals

## Category

Behavioral

## Intent

Provide automatic dependency tracking so that when session state changes (game state, client phase, player identity, etc.), all derived views, UI updates, and renderer state propagate without manual subscription wiring. Eliminate the class of bugs where a consumer reads stale state because someone forgot to call an update method.

## How It Works in Delta-V

Delta-V implements its own zero-dependency reactive system in `reactive.ts`, modeled after the signals pattern (similar to SolidJS/Preact signals). The system has four primitives:

### 1. Signal

A mutable reactive cell. Reading `.value` inside a tracked context (effect or computed) creates a subscription. Writing `.value` notifies all subscribers. Same-value writes are skipped (reference equality for objects).

### 2. Computed

A derived signal that re-evaluates its function whenever any tracked dependency changes. Created via `computed(fn)`, returns a `ReadonlySignal` with a `dispose` method.

### 3. Effect

A side-effectful subscription that re-runs whenever its tracked dependencies change. Created via `effect(fn)`. On re-run, the previous run's subscriptions are cleared and re-established (dynamic dependency tracking). Nested effects are automatically disposed when their parent re-runs.

### 4. DisposalScope

A lifecycle container that collects disposables (effects, computeds, plain functions) and disposes them all at once. Used to tie reactive subscriptions to a component or session lifetime.

### Session Integration

`session-model.ts` uses `defineReactiveSessionProperty` to back each mutable session field (state, playerId, gameState, logisticsState, etc.) with a hidden signal. Plain property assignment (`ctx.state = 'menu'`) triggers reactive propagation, while a companion `stateSignal` property exposes the `ReadonlySignal` for explicit subscriptions.

`session-signals.ts` composes all session-to-UI/renderer reactive effects into a single `attachMainSessionEffects` function that returns a dispose callback. Each effect is registered to a `DisposalScope` for clean teardown.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/reactive.ts` | 1-214 | Full reactive system: `signal`, `computed`, `effect`, `batch`, `DisposalScope` |
| `src/client/reactive.test.ts` | 1-646 | Comprehensive tests including property-based |
| `src/client/game/session-model.ts` | 11-153 | `defineReactiveSessionProperty`, `ClientSession` |
| `src/client/game/session-signals.ts` | 1-78 | `attachMainSessionEffects` -- composes all session effects |
| `src/client/game/session-planning-effects.ts` | -- | Planning/selection/HUD/combat button effects |
| `src/client/game/session-ui-effects.ts` | -- | Identity/waiting screen/latency/logistics effects |
| `src/client/dom.ts` | -- | `listen` helper for DOM event disposal |
| `src/client/input.ts` | 140-206 | `withScope` for input handler disposal |

## Code Examples

Signal creation and auto-tracking (`reactive.ts`):

```typescript
export const signal = <T>(initial: T): Signal<T> => {
  let val = initial;
  const subs = new Set<() => void>();

  return {
    get value() {
      if (active) {
        subs.add(active.run);
        active.deps.add(subs);
      }
      return val;
    },
    set value(next: T) {
      if (next === val) return;
      val = next;
      if (batchDepth > 0) {
        for (const sub of subs) pending.add(sub);
      } else {
        for (const sub of [...subs]) sub();
      }
    },
    peek: () => val,
    update(fn) { this.value = fn(val); },
  };
};
```

DisposalScope with helpers:

```typescript
export const createDisposalScope = (): DisposalScope => {
  const disposers: DisposableLike[] = [];
  let disposed = false;

  const scope: DisposalScope = {
    add(disposable) {
      if (disposed) {
        getDispose(disposable)();
        return disposable;
      }
      disposers.push(disposable);
      return disposable;
    },
    effect(fn) { return this.add(effect(fn)); },
    computed(fn) { return this.add(computed(fn)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (disposers.length > 0) {
        const disposable = disposers.pop();
        if (!disposable) continue;
        getDispose(disposable)();
      }
    },
  };
  return scope;
};
```

Session property backed by hidden signal (`session-model.ts`):

```typescript
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
    set: (next: T) => { backingSignal.value = next; },
  });
  return backingSignal;
};
```

Composed session effects (`session-signals.ts`):

```typescript
export const attachMainSessionEffects = (
  session: ClientSession,
  deps: MainSessionEffectsDeps,
): Dispose => {
  const scope = createDisposalScope();
  scope.add(attachSessionPlanningSelectionEffect(session));
  scope.add(attachSessionPlayerIdentityEffect(session, { renderer: deps.renderer, ui: deps.ui }));
  scope.add(attachSessionCombatButtonsEffect(session, deps.ui));
  scope.add(attachSessionFleetPanelEffect(session, deps.ui));
  scope.add(attachSessionHudEffect(session, deps.hud));
  // ...
  return () => scope.dispose();
};
```

## Consistency Analysis

**Strengths:**

- Every mutable session field uses `defineReactiveSessionProperty`, ensuring consistent reactive backing. There are no raw mutable fields on `ClientSession` that could change silently.
- `DisposalScope` is used consistently: input handlers, session effects, and the DOM event system all create scopes and dispose them on teardown.
- The `withScope` + `registerDisposer` mechanism allows effects created inside a scope block to automatically register themselves without manual `.add()` calls.
- Nested effects auto-dispose when their parent re-runs, preventing accumulation leaks (verified by the "does not leak effects across re-runs" test).
- `batch` is used in `applyClientStateTransition` to coalesce multiple signal writes into a single flush.

**Potential memory leak risks:**

- If an effect is created outside any scope or parent effect (bare `effect(() => ...)` at top level), there is no automatic disposal path. The tests verify this behavior but callers must be disciplined.
- The `ownerCleanups` stack mechanism correctly handles nested effects, but a deeply nested chain could theoretically accumulate cleanup arrays. In practice the nesting depth is shallow (2-3 levels max).
- The `peek()` method correctly reads without tracking, preventing accidental subscriptions in initialization code.

**Areas for improvement:**

- Reference equality for objects means that replacing `gameState` with a new object (which happens on every server update) always triggers effects even if the logical content is identical. This is by design (structural equality would be expensive), but it means effects must be cheap or guarded with internal diffing.
- There is no built-in "untrack" utility for reading a signal inside an effect without subscribing. Callers must use `peek()` instead, which is slightly less discoverable.

## Completeness Check

- The reactive system covers: signals, computed, effects, batching, disposal scopes, and implicit scope registration.
- It does not include: schedulers, transitions, error boundaries, or async effects. These are not needed for the current architecture.
- The test suite is thorough: property-based tests verify computed consistency and batch equivalence, unit tests cover disposal, nesting, dependency switching, and diamond dependency patterns.
- All session fields that need reactive tracking are wired through `defineReactiveSessionProperty`. No manual subscription or event-emitter patterns exist alongside the signal system.

## Related Patterns

- **State Machine** (09) -- `ClientState` is stored as a reactive signal; effects respond to state transitions.
- **Derive/Plan** (12) -- Many derive functions are called inside effects, with the effect re-running when signal dependencies change.
- **Pipeline** (15) -- Session effects form a reactive pipeline from session state to renderer/UI.
