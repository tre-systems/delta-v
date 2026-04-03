# Zero-Dependency Reactive Layer

## Category

Library Stance

## Intent

Provide fine-grained reactivity (signals, computed values, effects, batching) without depending on any external framework. By implementing the reactive primitives from scratch in a single file, Delta-V avoids framework lock-in, keeps the bundle minimal, and retains full control over scheduling and disposal semantics.

## How It Works in Delta-V

The reactive layer lives in `src/client/reactive.ts` (214 lines, zero imports). It implements four primitives:

### Signal

A mutable container that notifies subscribers when its value changes:

```typescript
const count = signal(0);
count.value = 1;  // triggers subscribers
count.peek();     // reads without tracking
count.update(v => v + 1);  // functional update
```

Signals use reference equality (`===`) for change detection. Same-value writes are silently dropped.

### Computed

A derived value that automatically re-evaluates when its dependencies change:

```typescript
const doubled = computed(() => count.value * 2);
```

Computed values are lazy (evaluated on first read) and cached. They track which signals are read during evaluation and re-run only when those signals change.

### Effect

A side-effect that re-runs when any signal it reads changes:

```typescript
const dispose = effect(() => {
  document.title = `Count: ${count.value}`;
});
```

Effects automatically clean up child effects on re-run via an owner stack. Calling `dispose()` permanently stops the effect.

### Batch

Groups multiple signal writes into a single notification flush:

```typescript
batch(() => {
  a.value = 1;
  b.value = 2;
});
// Subscribers run once, not twice
```

### Disposal Scope

A container that collects disposables (effects, computed values, arbitrary cleanups) and disposes them all at once:

```typescript
const scope = createDisposalScope();
scope.effect(() => { /* ... */ });
scope.computed(() => { /* ... */ });
scope.dispose(); // cleans up everything
```

The implementation uses a tracking context (`active`) that records which signal subscriber sets are accessed during effect/computed evaluation. This is the same auto-tracking approach used by Preact Signals and SolidJS, but without their DSL or compiler requirements.

## Key Locations

- `src/client/reactive.ts` -- full implementation (214 lines)
- `src/client/reactive.test.ts` -- comprehensive test suite (including property-based tests)
- `src/client/dom.ts` -- DOM helpers that integrate with signals
- `src/client/game/` -- game state and planning stores built on signals

## Code Examples

Signal implementation (core auto-tracking):

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

Effect with owner cleanup stack:

```typescript
export const effect = (fn: () => void): Dispose => {
  const deps = new Set<Set<() => void>>();
  let cleanups: Dispose[] = [];
  let dead = false;

  const cleanup = () => {
    for (const subs of deps) subs.delete(run);
    deps.clear();
    pending.delete(run);
    for (const c of cleanups) c();
    cleanups = [];
  };

  const dispose = () => { cleanup(); dead = true; };

  const run = () => {
    if (dead) return;
    cleanup();
    const prev = active;
    const prevOwner = ownerCleanups;
    ownerCleanups = [];
    active = { run, deps };
    try { fn(); }
    finally {
      active = prev;
      cleanups = ownerCleanups;
      ownerCleanups = prevOwner;
    }
  };

  registerDisposer(dispose);
  run();
  return dispose;
};
```

## Consistency Analysis

The reactive layer is used consistently throughout the client:

- Game state is stored in signals (`game-state-store.ts`)
- UI view models are derived via computed values
- DOM updates happen via effects
- Scope-based disposal ensures cleanup when screens change
- The `batch` function is used for multi-signal updates during state transitions

No other reactivity system is used anywhere in the codebase. There is no React, no MobX, no RxJS. The 214-line file is the sole reactivity primitive.

The test suite is thorough, covering auto-tracking, disposal, batching, nested effects, scope management, and glitch-freedom (via property-based tests with fast-check).

## Completeness Check

- **No error boundaries**: If an effect throws, the error propagates uncaught. A production reactivity system would typically catch and report errors in effects.
- **No debug tooling**: There is no signal graph visualiser or dependency logger. For a game of this size, console.log debugging suffices, but it could become a pain point as the signal graph grows.
- **Synchronous only**: All updates are synchronous. There is no scheduler or transition API. This is correct for a game where frame-synchronous updates are desired.
- **Reference equality only**: Change detection uses `===`. Object/array signals require explicit replacement (not mutation) to trigger updates. This is documented by convention.

## Related Patterns

- **65 -- Minimal Framework Approach**: The reactive layer is one component of the zero-framework philosophy.
- **51 -- Co-Located Tests**: `reactive.test.ts` is co-located and uses fast-check for property-based testing.
- **52 -- Property-Based Testing**: The reactive test suite uses fast-check to verify glitch-freedom across random signal graphs.
