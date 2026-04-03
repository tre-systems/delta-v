# Minimal Framework Approach

## Category

Library Stance

## Intent

Build the entire application -- game engine, server, renderer, and UI -- without depending on heavy frameworks (React, Vue, Angular, etc.). By using raw platform APIs (Canvas 2D, DOM, WebSocket, Service Worker) with thin custom abstractions, Delta-V keeps its bundle small, avoids framework churn, retains full control over performance-critical paths, and eliminates the impedance mismatch between framework paradigms and game loop requirements.

## How It Works in Delta-V

The architecture document explicitly states: "No heavy frameworks (React/Vue/etc.) are used, ensuring maximum performance for the game loop." The entire `package.json` has zero runtime UI framework dependencies.

### What replaces frameworks

| Concern | Framework approach | Delta-V approach |
|---------|-------------------|------------------|
| **Reactivity** | React state, MobX, Vue reactivity | Custom 214-line signals (`reactive.ts`) |
| **DOM creation** | JSX, templates, virtual DOM | `el()` helper in `dom.ts` (declarative element creation) |
| **Component model** | React components, Vue SFCs | Factory functions (`createGameClient`, `createRenderer`) |
| **State management** | Redux, Zustand, Pinia | Signal stores (`game-state-store.ts`, `planning-store.ts`) |
| **Routing** | React Router, Vue Router | Manual screen management |
| **Build tooling** | Webpack, Vite, Next.js | `esbuild` for bundling, `wrangler` for deploy |
| **Testing** | React Testing Library | Vitest with raw DOM assertions |

### The `el()` helper

Instead of JSX or template strings, UI is constructed with a lightweight `el()` function:

```typescript
el('div', { class: 'card', onClick: handler },
  el('span', { class: 'title', text: 'Hello' }),
  'some text',
)
```

This provides declarative element creation with type-safe props, event binding, and child nesting -- the core value of JSX -- in about 80 lines of vanilla TypeScript.

### Factory-based composition

The architecture uses factory functions instead of class hierarchies or component trees:

- `createGameClient()` -- composes the game kernel from collaborators
- `createRenderer()` -- sets up the canvas rendering pipeline
- `createInputHandler()` -- wires input events to game commands
- `createCamera()` -- manages viewport state
- `createBotClient()` -- AI player composition

The only production `class` in the entire codebase is `GameDO`, which must be a class because Cloudflare's Durable Object API requires it.

### Direct Canvas API

The renderer uses the Canvas 2D API directly rather than through a game framework (Phaser, PixiJS, etc.). This means:
- No abstraction layer between game logic and pixel output
- Full control over draw order, caching, and performance
- No framework overhead for the 60fps render loop

### Platform-native features

- **Service Worker**: Direct Service Worker API for offline caching, no Workbox
- **WebSocket**: Direct WebSocket API through Cloudflare's hibernation layer
- **DOM events**: Raw `addEventListener` with typed handlers, no synthetic event system

## Key Locations

- `src/client/reactive.ts` -- custom reactive system (214 lines)
- `src/client/dom.ts` -- `el()` helper and DOM utilities
- `src/client/game/client-kernel.ts` -- factory-based client composition
- `src/client/renderer/` -- direct Canvas 2D rendering
- `static/index.html` -- plain HTML shell (no framework bootstrap)
- `docs/ARCHITECTURE.md` -- explicit no-framework stance in Key Technologies section

## Code Examples

The `el()` DOM helper:

```typescript
export const el = (
  tag: string,
  props?: ElProps,
  ...children: Child[]
): HTMLElement => {
  const element = document.createElement(tag);
  if (props) {
    if (props.class) element.className = props.class;
    if (props.onClick) element.addEventListener('click', props.onClick);
    if (props.text) element.textContent = props.text;
    // ...
  }
  for (const child of children) {
    element.appendChild(
      typeof child === 'string'
        ? document.createTextNode(child)
        : child,
    );
  }
  return element;
};
```

Factory-based composition (from architecture doc):

```
Client composition stays in createGameClient() (game/client-kernel.ts)
with factory-style collaborators (createInputHandler(), createUIManager(),
createRenderer(), createCamera(), createBotClient()).
```

Build tooling -- esbuild, not a framework's build system:

```
Build & Tools: esbuild for lightning-fast client bundling,
wrangler for local testing/deployment, and Vitest for unit testing.
```

## Consistency Analysis

The no-framework stance is applied with remarkable consistency:

- **Zero runtime UI dependencies** in `package.json` -- no React, Vue, Preact, Solid, Lit, or Svelte
- **No JSX** -- the `el()` helper is used for all DOM creation
- **No virtual DOM** -- signals drive fine-grained DOM updates directly
- **No class components** -- all client modules are factory functions
- **No framework test utilities** -- tests use Vitest with raw DOM assertions

The architecture document, coding standards, and actual code all align on this stance. There is no "accidental framework" creeping in through dependencies.

The only external runtime dependencies beyond Cloudflare platform APIs are `fast-check` (test-only) and fonts (loaded via Google Fonts CDN in `index.html`).

## Completeness Check

- **Scaling concern**: As the UI grows more complex (settings screens, lobby features, chat), the `el()` helper may become verbose compared to JSX. The architecture doc acknowledges this with the "single trusted-HTML boundary" improvement note.
- **No component lifecycle**: There is no built-in component mounting/unmounting lifecycle. Disposal scopes serve this purpose, but they require manual wiring.
- **No SSR**: Not needed for a game, but worth noting as a consequence of the no-framework choice.
- **Accessibility**: Without a framework's aria tooling, accessibility attributes must be manually added. The `el()` helper supports `data` attributes but does not have first-class `aria-*` support.
- **Bundle size**: The entire client (game engine + renderer + UI + reactive layer) is smaller than React alone. This is a direct benefit of the minimal approach.

## Related Patterns

- **64 -- Zero-Dependency Reactive Layer**: The custom signals system is the centrepiece of the no-framework approach.
- **51 -- Co-Located Tests**: Testing without framework utilities means tests are simpler and faster.
- **50 -- Hibernatable WebSocket**: The server side also avoids frameworks -- no Express, no Hono, just raw Cloudflare Workers.
