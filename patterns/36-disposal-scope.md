# Disposal Scope

## Category
Client-Specific

## Intent
Prevent memory leaks by grouping reactive subscriptions, event listeners, and other disposable resources into a single scope that can be torn down atomically. Without this pattern, every `effect()`, `computed()`, and `listen()` call would need individual tracking and manual cleanup, making lifecycle management error-prone and scattered.

## How It Works in Delta-V

The `DisposalScope` interface provides a container that collects disposable resources (functions or objects with a `.dispose()` method) and disposes them all when `scope.dispose()` is called.

The core flow is:

1. **Create a scope** via `createDisposalScope()`.
2. **Register resources** using `scope.add(disposable)`, `scope.effect(fn)`, or `scope.computed(fn)`. Each method returns the resource for inline chaining.
3. **Auto-registration** via `registerDisposer()` -- when an effect or listener is created inside `withScope(scope, fn)`, it automatically registers its disposer with the active scope. The `listen()` helper in `dom.ts` and the `effect()` function both call `registerDisposer()` internally.
4. **Tear down** by calling `scope.dispose()`, which pops and disposes all collected resources in reverse order (LIFO). After disposal, any newly added resource is immediately disposed (guarding against late registration).

The `withScope()` function sets a module-level `activeScope` variable so that nested `effect()` and `listen()` calls auto-register without passing the scope explicitly. This is used heavily in the input handler and UI manager setup.

There is also an **owner cleanup** mechanism within effects themselves: when an effect re-runs, any nested effects or `registerDisposer` calls made during the previous run are cleaned up automatically before the new run. This prevents stacking subscriptions on each re-evaluation.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/reactive.ts` | 7-12 | `DisposalScope` interface |
| `src/client/reactive.ts` | 91-127 | `createDisposalScope()` factory |
| `src/client/reactive.ts` | 30-48 | `withScope()`, `getCurrentScope()`, `registerDisposer()` |
| `src/client/reactive.ts` | 155-196 | Effect with owner-cleanup chain |
| `src/client/dom.ts` | 128-140 | `listen()` auto-registers via `registerDisposer()` |
| `src/client/input.ts` | 140-196 | `withScope(scope, () => { listen(...) })` pattern |
| `src/client/game/session-signals.ts` | 42-64 | Scope grouping multiple session effects |
| `src/client/ui/ui.ts` | 42-43 | UI manager scope |
| `src/client/tutorial.ts` | 8 | Tutorial scope |

## Code Examples

Scope creation and resource collection in the input handler:

```typescript
// src/client/input.ts
const scope = createDisposalScope();

withScope(scope, () => {
  listen(canvas, 'mousedown', (event) => {
    const e = event as MouseEvent;
    onPointerDown(e.clientX, e.clientY);
  });

  listen(canvas, 'mousemove', (event) => {
    const e = event as MouseEvent;
    onPointerMove(e.clientX, e.clientY);
  });

  listen(window, 'mouseup', (event) => {
    const e = event as MouseEvent;
    onPointerUp(e.clientX, e.clientY);
  });
  // ... more listeners
});

return {
  dispose: () => {
    scope.dispose();
  },
};
```

Composing multiple effect disposers into a parent scope:

```typescript
// src/client/game/session-signals.ts
const scope = createDisposalScope();

scope.add(attachSessionPlanningSelectionEffect(session));
scope.add(attachSessionPlayerIdentityEffect(session, { renderer: deps.renderer, ui: deps.ui }));
scope.add(attachSessionCombatButtonsEffect(session, deps.ui));
// ... more effects

return () => scope.dispose();
```

Late-registration guard in `createDisposalScope`:

```typescript
// src/client/reactive.ts
add(disposable) {
  if (disposed) {
    getDispose(disposable)();
    return disposable;
  }
  disposers.push(disposable);
  return disposable;
},
```

## Consistency Analysis

The pattern is applied consistently across the client codebase:

- **Input handler** (`input.ts`): Uses `createDisposalScope` + `withScope` for all canvas event listeners.
- **UI manager** (`ui/ui.ts`): Creates a scope at construction and wires all view effects through it.
- **Session signals** (`session-signals.ts`): Groups all reactive session-to-renderer/UI subscriptions into one scope.
- **Tutorial** (`tutorial.ts`): Creates its own disposal scope.
- **HUD chrome view** (`ui/hud-chrome-view.ts`): Creates a scope and uses `withScope` for reactive bindings.

One area where the `innerHTML` usage in `hud-chrome-view.ts` (line 368) bypasses the `setTrustedHTML` helper is not a disposal concern but is noted elsewhere (Pattern 40).

**No leak risks identified**: Every component that creates subscriptions or listeners pairs them with a disposal scope, and the scopes are disposed on teardown. The auto-registration via `registerDisposer()` means that even ad-hoc `listen()` calls inside a `withScope` block are captured.

## Completeness Check

The pattern is well-implemented. A few observations:

- **No scope hierarchy**: Scopes are flat -- there is no parent-child scope tree. If needed, nesting is achieved by `scope.add(childScope)` or `scope.add(childDispose)`. This is simple and sufficient for the current architecture.
- **The owner-cleanup mechanism** within `effect()` handles nested effects automatically, which is the trickiest lifecycle case. This is correctly implemented with the `ownerCleanups` stack.
- **Potential improvement**: The `withScope` context is module-level global state. In a test environment with concurrent async operations, this could theoretically interleave. In practice the client is single-threaded so this is not a real risk.

## Related Patterns

- **Smart DOM Helpers** (Pattern 39): `listen()` calls `registerDisposer()` to auto-register with the active scope.
- **Session Model** (Pattern 38): Session signals are grouped into a disposal scope for lifecycle management.
- **Planning Store** (Pattern 37): The planning store's `revisionSignal` participates in effects that are scoped via `DisposalScope`.
