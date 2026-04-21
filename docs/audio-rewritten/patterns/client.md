# Client Patterns

How the framework-free browser client stays coherent. A separate coding standards document covers naming conventions, function prefix tables, factory patterns, and the small DOM helper API. This chapter walks through the patterns that tie input, state, rendering, and the DOM together.

Each section follows the same structure: the pattern, where it lives, and why this shape.

---

## Three-Layer Input Pipeline

**Pattern.** DOM events never reach game logic. They pass through three layers: raw capture, then game interpretation, then command dispatch.

Picture the flow as a left-to-right pipeline. Raw browser events — clicks, key presses, touch events — enter at the far left. Layer one, the input module, handles camera transforms and converts screen coordinates into meaningful game positions like a hex tile identifier, but it knows nothing about game rules. Layer two is a pure function called interpret-input that takes a snapshot of the current event, the current phase, and the current state, and returns a list of game commands. Layer three, the command router, receives those commands and dispatches them to the appropriate domain handler — astrogation, combat, ordnance, or UI.

Keyboard shortcuts and button clicks skip layers one and two entirely and enter directly at layer three, sharing the same dispatch point. This is a sibling path, not a violation of the design.

**Why this shape.**

- Layer two being a pure function means every combination of phase, state, and input can be tested without a browser.
- The handler map in layer three is checked at compile time: adding a new game command variant will fail to compile until a corresponding handler exists.
- Raw DOM and game rules never share a scope, so a hover event cannot accidentally alter a ship's velocity.

---

## Client State Machine

**Pattern.** A flat set of named states describes where the UI is at any moment. Transitions are derived from the authoritative game state received from the server — they are never imperatively set. State-entry side effects all flow through a single applier function.

The full set of named states includes menu, connecting, waiting for opponent, several playing sub-states covering astrogation, ordnance, combat, logistics, movement animation, and opponent turn, plus game over.

The derivation works like this: given the current client state and the latest game state, a pure function produces the next client state. A single applier then owns updating the screen and triggering any side effects.

**Why this shape.**

- Derivation means the client state cannot diverge from the server state. The server sends game state; the client computes its view of it.
- Exhaustive records and switch statements catch missing cases at compile time.
- A single applier is the only place that mutates stored state, starts timers, resets cameras, or triggers tutorials — so state-entry effects cannot scatter across the codebase.

---

## Reactive Signals (Zero-Dependency)

**Pattern.** A small, zero-dependency signals library — roughly two hundred lines — provides the primitives: signal, computed, effect, and batch, along with disposal scopes. This library owns durable UI state where it removes the need for imperative fan-out. Transient events like toasts and sounds remain imperative.

A signal holds a value. A computed derives a value from one or more signals and updates automatically. An effect runs a side-effecting function whenever its tracked signals change. Disposal scopes manage teardown.

The DOM helper functions for visibility, text content, and CSS classes accept signals directly, so they update automatically without manual wiring.

**Why this shape.**

- Signals eliminate the class of bug where the heads-up display forgot to re-render when the turn changed, without taking on a framework like React.
- Effects record which signals they read automatically — there is no manual subscription list to maintain.
- Teardown is last-in, first-out and automatic inside any scoped block.

---

## Session Model as Aggregate Root

**Pattern.** One client session object owns every piece of durable client state. Reactive fields are defined so that a plain assignment transparently updates both the underlying field and its companion signal.

Every reactive field exists in two forms: a plain field you can assign to directly, and a read-only signal you can subscribe to reactively. Sub-stores for planning and logistics are owned by the session object, not shared across the codebase.

Narrow view types — each exposing only a specific slice of the session — limit what each collaborator can reach.

**Why this shape.**

- One root means one place to inspect in tests and one place to handle teardown.
- Reactive properties via property descriptor give imperative call-site syntax with reactive semantics, avoiding setter boilerplate.
- Narrowed context types act as compile-time access control: modules only see the fields they genuinely need.

---

## Planning Store (Ephemeral Turn State)

**Pattern.** All uncommitted UI planning — burns, overloads, queued attacks, selections, hover state — lives in one store. A single revision signal bumps on every mutation. Phase transitions reset the relevant sub-state.

When a player sets a burn for a ship, the planning store records it and increments its revision signal. The heads-up display is built as a computed value that reads the revision signal, so it automatically re-derives whenever any planning change occurs.

The renderer holds the read-only planning state by reference, which means previews such as dashed courses, ghost ships, and fuel cost labels are always current without a setter API.

**Why this shape.**

- A coarse-grained revision signal is sufficient because planning changes cluster in time and re-derivation of the heads-up display is cheap.
- The split between a read-only planning type and a mutable planning store means the input pipeline cannot accidentally mutate planning state — TypeScript enforces this at compile time.

---

## Canvas Renderer Factory

**Pattern.** A factory function called create-renderer composes roughly seventeen drawing modules and runs a request-animation-frame loop. A static scene layer — covering stars, the hex grid, gravity wells, asteroids, and celestial bodies — caches to an offscreen canvas keyed by camera position, zoom level, viewport dimensions, a coarse body-animation bucket, and the set of destroyed asteroids. This avoids redrawing thousands of hex tiles on every frame when the camera is idle.

The renderer is composed of distinct modules: one for the scene, one for ships, one for entities, one for vector overlays, one for effects, one for the overlay, one for the minimap, one for the static scene and its caching layer, one for animations, and one for the camera.

**Why this shape.**

- Using a factory rather than a class means the renderer owns mutable long-lived state without requiring inheritance or instance checks. The public type is inferred directly from the factory's return value, so it stays in sync with the implementation automatically.
- Separating view computation from Canvas drawing — building a body view first, then rendering it — makes view logic testable without a Canvas context.

---

## Animation Manager with Completion Guarantees

**Pattern.** Ship and ordnance movement animations have explicit completion paths: a normal finish, a fallback timer set to the animation duration plus five hundred milliseconds, and an immediate skip when the browser tab is hidden. State is cleared before the completion callback fires, so the callback cannot observe mid-animation state.

The animation manager accepts injected dependencies for the clock and timer functions, which allows tests to advance time deterministically without real timers.

**Why this shape.**

- Game state is already in its post-movement form before the animation starts. The animation is purely cosmetic interpolation and cannot block the game engine.
- Three completion paths mean a network hiccup or a hidden tab will not leave the UI frozen in an animating state.

---

## Trusted HTML Boundary

**Pattern.** All writes to inner HTML go through two dedicated helper functions in the DOM module. Nothing else in the codebase may write to inner HTML directly. This constraint is enforced by a pre-commit check.

All current callers pass internally generated markup — derived from game state, static strings, or computed display values — and nothing user-controlled.

**Why this shape.**

- If user-controlled content ever needs to render as HTML — for example, chat messages, player names, or modded scenario descriptions — a single boundary can add a sanitizer. If inner HTML writes were scattered throughout the codebase, that audit would be impossible.
- The pre-commit check keeps the boundary from quietly re-opening during refactors.

---

## Disposal Scopes

**Pattern.** Anything with a lifetime — effects, computed values, DOM listeners, timers — registers with a disposal scope. Scopes dispose in last-in, first-out order. A second scope can be nested inside a first. A scope helper function implicitly registers anything created inside a given block.

When the scope is disposed, everything registered with it tears down in reverse order of registration. Every view and manager that creates computed or effect graphs owns a scope and exposes a dispose method.

**Why this shape.**

- Central scope registration means every module has one teardown path, eliminating the class of bug where a listener was never removed.
- On effect re-runs, previously registered nested disposers run first, so subscriptions do not stack.
- Last-in, first-out disposal handles child-before-parent teardown order correctly.

---

## Transport Adapter (WebSocket vs Local AI)

**Pattern.** A game transport interface hides whether the current game is multiplayer over a WebSocket or a local game against an AI. Action handlers call transport methods like submit-astrogation — they never branch on whether this is a local game inside the submission logic itself.

Two factory functions implement the interface: one wraps a WebSocket connection, and the other runs the game engine directly in-process.

**Why this shape.**

- Action code is identical for multiplayer and single-player because the engine is the same either way.
- Adding a new mode — such as a Model Context Protocol-driven local session — only requires a new transport factory, leaving all existing action code untouched.

---

## Cross-Cutting Theme: Pure Core, Imperative Shell

Several of the patterns in this chapter share a common shape: a pure function computes what should happen and returns it as data; a thin imperative layer performs the actual side effect. This is the functional-core, imperative-shell pattern, applied consistently across the client.

The main advantage is testability. A phase-transition derivation test does not need a DOM, and a screen-visibility test does not need a browser. The main discipline is keeping the pure core truly pure: the moment a planner reaches for the document object or a timer, the imperative shell has leaked inward.
