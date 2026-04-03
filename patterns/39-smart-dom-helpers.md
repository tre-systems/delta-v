# Smart DOM Helpers

## Category
Client-Specific

## Intent
Reduce the verbosity and error-proneness of raw DOM manipulation (createElement, className, addEventListener, appendChild chains) without introducing a UI framework. The helpers provide a declarative API for building element trees, toggling visibility, binding reactive text/classes, and managing event listener lifecycles.

## How It Works in Delta-V

The `dom.ts` module exports a small set of helpers that replace common multi-line DOM patterns with single calls:

1. **`el(tag, props, ...children)`** -- Declarative element creation. Accepts a tag name, an optional props object (`class`, `classList`, `text`, `html`, `style`, `disabled`, `title`, `data`, `onClick`, `onKeydown`, `onInput`, `onChange`), and child elements or strings. Event handlers are wired through `listen()` for automatic disposal.

2. **`listen(target, event, handler, options)`** -- Binds an event listener and returns a disposer function. Automatically calls `registerDisposer()` to integrate with the active `DisposalScope`, eliminating the need to manually track and remove listeners.

3. **`visible(element, condition, display)`** -- Toggles element visibility. Accepts either a boolean or a `ReadonlySignal<boolean>`, and when given a signal, wraps the toggle in a reactive `effect()` for automatic updates. Also manages `aria-hidden` for accessibility.

4. **`text(element, val)`** -- Sets text content from a value or signal, with reactive binding when a signal is provided.

5. **`cls(element, className, condition)`** -- Toggles a CSS class based on a boolean or signal.

6. **`show(element)` / `hide(element)`** -- Simple display toggling.

7. **`renderList(container, items, renderItem)`** -- Clears a container and renders a list of items, replacing the common clearHTML-then-loop pattern.

8. **`byId(id)`** -- Typed `getElementById` that throws if the element is not found, eliminating null checks at every call site.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/dom.ts` | 36-96 | `el()` element factory |
| `src/client/dom.ts` | 128-140 | `listen()` with auto-disposal |
| `src/client/dom.ts` | 151-161 | `renderList()` |
| `src/client/dom.ts` | 166-200 | `visible()` with signal support |
| `src/client/dom.ts` | 203-215 | `text()` with signal support |
| `src/client/dom.ts` | 218-230 | `cls()` with signal support |
| `src/client/dom.ts` | 235-243 | `byId()` typed lookup |

## Code Examples

Declarative element construction with `el()`:

```typescript
// src/client/dom.ts (usage pattern)
el('div', { class: 'card', onClick: handler },
  el('span', { class: 'title', text: 'Hello' }),
  'some text',
)
```

Reactive visibility binding:

```typescript
// src/client/dom.ts
export const visible = (
  element: HTMLElement,
  condition: boolean | ReadonlySignal<boolean>,
  display = '',
): void => {
  const apply = (on: boolean): void => {
    const newDisplay = on ? display : 'none';
    if (element.style.display !== newDisplay) {
      element.style.display = newDisplay;
    }
    if (on) {
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('aria-hidden', 'true');
    }
  };

  if (typeof condition === 'boolean') {
    apply(condition);
  } else {
    effect(() => {
      apply(condition.value);
    });
  }
};
```

Event binding with auto-disposal:

```typescript
// src/client/dom.ts
export const listen = <T extends EventTarget, K extends string>(
  target: T,
  event: K,
  handler: (e: Event) => void,
  options?: AddEventListenerOptions,
): (() => void) => {
  target.addEventListener(event, handler, options);
  const dispose = () => target.removeEventListener(event, handler, options);
  registerDisposer(dispose);
  return dispose;
};
```

Usage in HUD chrome view:

```typescript
// src/client/ui/hud-chrome-view.ts
text(fleetStatusEl, fleetStatusSignal);
visible(helpOverlayEl, helpOverlayVisibleSignal, 'flex');
```

## Consistency Analysis

The helpers are used widely but not universally:

- **`byId()`** is the standard lookup method across all view modules.
- **`listen()`** is used consistently in `input.ts`, view modules, and the tutorial system.
- **`visible()`, `text()`, `cls()`** are used in HUD chrome, overlay, and other views.
- **`el()`** is used for dynamic element construction.
- **`renderList()`** is used for rendering ship lists and similar collections.

**Raw DOM manipulation still exists** in several places:

- **Renderer** (`renderer.ts`, `static-layer.ts`): Uses `document.createElement('canvas')` directly -- this is appropriate since canvas elements are not UI elements managed by the helper system.
- **Audio** (`audio.ts`): Uses `document.addEventListener` directly for one-time click/touchstart resume handlers. These are global one-shot handlers, not scoped UI events.
- **Viewport** (`viewport.ts`): Uses `addEventListener` directly for resize/orientationchange. These are infrastructure-level listeners outside the scope of `withScope`.
- **Telemetry** (`telemetry.ts`): Global error handlers use `addEventListener` directly.
- **`hud-chrome-view.ts` line 368**: Uses `soundBtn.innerHTML = ...` directly instead of `setTrustedHTML()`. This is a consistency gap noted in Pattern 40.

The cases where raw DOM APIs are used directly are mostly justified (canvas creation, global handlers), but the `innerHTML` bypass is a genuine inconsistency.

## Completeness Check

The helper set covers the most common DOM patterns well. Potential additions:

- **`attr()` helper**: There is no helper for setting arbitrary HTML attributes reactively. The `el()` function handles `disabled`, `title`, and `data`, but `setAttribute` calls are done directly where needed.
- **No `removeChild` helper**: Children are removed via `clearHTML()` (clearing all) or direct DOM calls. A targeted remove helper is not needed given current usage.
- **The signal overload** in `visible()`, `text()`, and `cls()` is a clean dual-mode API that avoids the need for separate reactive and non-reactive versions.

## Related Patterns

- **Disposal Scope** (Pattern 36): `listen()` auto-registers disposers with the active scope.
- **Trusted HTML Boundary** (Pattern 40): `el()` routes `html` prop through `setTrustedHTML()`.
- **Session Model** (Pattern 38): Signal-based properties on the session are consumed by `visible()`, `text()`, `cls()` in views.
