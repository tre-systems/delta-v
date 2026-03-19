# Delta-V Coding Standards

This document captures the coding conventions that fit this codebase as it exists today. It is intentionally short and pragmatic. Use it to keep the project easy to extend without forcing unnecessary patterns onto it.

## Core Principles

- Prefer readability over cleverness.
- Prefer small, testable extractions over large architectural rewrites.
- Keep the shared rules engine functional and data-oriented.
- Accept classes at imperative boundaries where long-lived mutable state is natural.
- Keep docs aligned with the actual implementation.

## Project Shape

### Shared engine

Files under `src/shared/` should remain:

- side-effect-free (no I/O: no DOM, no network, no storage)
- plain typed data
- easy to test in isolation

Note: the engine currently mutates `GameState` in place rather than returning immutable snapshots. This is a known trade-off documented in ARCHITECTURE.md and tracked in BACKLOG.md (item 2k). RNG is fully injectable — all engine entry points require a mandatory `rng: () => number` parameter with no `Math.random` fallbacks in the turn-resolution path.

Avoid pushing browser, network, storage, or rendering concerns into the shared engine.

### Imperative boundaries

Classes are acceptable in places like:

- `src/server/game-do/game-do.ts`
- `src/client/main.ts`
- `src/client/renderer/renderer.ts`
- `src/client/input.ts`
- `src/client/ui/ui.ts`

These files coordinate long-lived state, timers, DOM, canvas, sockets, or platform APIs. That is a legitimate use of classes in this project.

### DOM helpers

Use `src/client/dom.ts` helpers for declarative DOM construction in UI code:

- **`el(tag, props, ...children)`** — Create elements with class, text, handlers, and children in one expression instead of multi-line createElement/className/addEventListener/appendChild chains.
- **`visible(el, condition)` / `show(el)` / `hide(el)`** — Toggle display instead of writing `.style.display = condition ? 'block' : 'none'` everywhere.
- **`byId(id)`** — Typed `getElementById` that throws on missing elements, replacing `document.getElementById('x')!` non-null assertions.

Prefer `el()` for building element trees programmatically. Continue using `innerHTML` for complex HTML templates where `el()` would be awkward.

## Refactoring Guidance

- Prefer extracting pure helper modules before introducing new patterns or libraries.
- Reduce duplication first. Do not split files only to satisfy a size target.
- Keep orchestrators focused on coordination, not business logic.
- When a file grows large, split by real responsibility boundaries.

### Size heuristics

These are heuristics, not hard rules:

- Pure helper functions should usually be small, often around `5-25` lines.
- Coordinator methods can be longer if the flow is linear and clear.
- Files under `200` lines are nice when natural, but not mandatory.
- Files above `500` lines should be reviewed for extraction opportunities.
- Files above `1000` lines are usually overdue for decomposition.

Do not create meaningless wrapper functions or over-fragment files just to hit numeric targets.

## Testing

- Co-locate unit tests next to the source file as `*.test.ts`.
- Keep rules-heavy logic covered with direct unit tests.
- When extracting pure helpers from client/server coordinators, add tests for those helpers.
- Prefer targeted tests around risky logic over shallow coverage inflation.
- Use data-driven tests (`it.each` / `describe.each`) to reduce verbosity when testing tables, mappings, or many input-output pairs. This is especially useful for combat tables, damage lookups, and hex math.
- Coverage thresholds are enforced on `src/shared/` via vitest config — the pre-commit hook and CI both run `test:coverage` to prevent backsliding.

## Constants And Configuration

- Avoid magic numbers when a value is shared across client/server behavior.
- Promote shared gameplay or protocol constants into `src/shared/constants.ts` when appropriate.
- Keep client UI timing displays aligned with server-enforced timing.

## Docs

- Update docs when behavior changes materially.
- Do not leave roadmap items marked as future work once they are implemented.
- Architecture docs should describe the real join flow, validation model, and authority boundaries.

## Functional Style

The shared engine is data-oriented by design. Lean into that with functional patterns:

- **Use `src/shared/util.ts` helpers** instead of writing manual reduce/loop equivalents. They exist to make intent obvious. The full set:

  | Helper | Replaces |
  |---|---|
  | `sumBy(arr, fn)` | `arr.reduce((s, x) => s + fn(x), 0)` |
  | `minBy(arr, fn)` / `maxBy` | Loops tracking `bestVal` / `bestItem` |
  | `count(arr, fn)` | `arr.filter(fn).length` (avoids intermediate array) |
  | `indexBy(arr, fn)` | `new Map(arr.map(x => [fn(x), x]))` |
  | `groupBy(arr, fn)` | Reduce building `Record<string, T[]>` |
  | `partition(arr, fn)` | Two `.filter()` calls with opposite predicates |
  | `compact(arr)` | `.filter(x => x != null)` with correct narrowing |
  | `filterMap(arr, fn)` | `.map(fn).filter(x => x != null)` in one pass |
  | `uniqueBy(arr, fn)` | `[...new Set(arr.map(fn))]` or manual Set dedup |
  | `pickBy(obj, fn)` | `Object.fromEntries(Object.entries(obj).filter(...))` |
  | `mapValues(obj, fn)` | `Object.fromEntries(Object.entries(obj).map(...))` |
  | `cond([p, v], ...)` | Chains of `if (p) return v;` (Clojure-style cond) |

- **Prefer expressions over statements.** A `filter` → `map` chain is easier to follow than a `for` loop that pushes into a mutable array.
- **Avoid mutable accumulators** when a helper already captures the pattern. Instead of tracking `bestDist` / `bestItem` through a loop, use `minBy`. Instead of `reduce((sum, x) => sum + x.value, 0)`, use `sumBy`. Instead of two `.filter()` calls splitting an array, use `partition`.
- **Prefer `filterMap` over `.map().filter()`** when transforming and discarding nulls — it's one pass and reads as a single intent: "extract these values, skip the ones that don't exist."
- **Prefer `count` over `.filter().length`** — it avoids allocating an intermediate array just to measure it.
- **Build lookup structures declaratively.** `indexBy(orders, o => o.shipId)` over manually constructing a `Map` with a loop.
- **Keep transformations as pipelines** where it reads well: filter the data, transform it, extract what you need. Chain array methods or compose helper calls — whichever is clearest.
- **Don't force it.** Imperative code is fine when the logic is inherently stateful (tracking previous iteration state, early exits with complex conditions, Canvas drawing). Functional style should clarify, not obscure.
- **Prefer arrow functions** (`const foo = (x: number) => ...`) over function declarations.

## Client Architecture

### State ownership

State belongs to the coordinator that manages its lifecycle, and is passed by reference to collaborators:

- **PlanningState** is owned by `GameClient` in `main.ts`, defined in `src/client/game/planning.ts`. Renderer receives it as a constructor parameter and reads the shared reference each frame. `InputHandler` does not receive PlanningState — it emits raw spatial events (`InputEvent`), and `interpretInput()` receives PlanningState as a read-only argument to produce `GameCommand[]`.

- **GameState** is owned by `GameClient`, updated via `applyGameState()`. Other modules receive it as function arguments, never as stored references.

### Dependency injection pattern

Client game modules use two patterns depending on purity:

- **Pure functions** take only what they need as direct parameters. These are the `derive*`, `build*`, `resolve*`, `get*` functions in `game/helpers.ts`, `game/keyboard.ts`, `game/navigation.ts`, `game/burn.ts`, `game/combat.ts`, `game/messages.ts`, etc. They return values and have no side effects.

- **Side-effecting functions** take a `deps` object as their first parameter. The `deps` interface declares the callbacks and state accessors the function needs (e.g. `getGameState()`, `showToast()`, `getTransport()`). This avoids long parameter lists and makes testing easy via mock objects. Examples: `CombatActionDeps`, `AstrogationActionDeps`, `PresentationDeps`, `LocalGameFlowDeps`.

- **Managers** use a factory pattern: `createXxx(deps: XxxDeps): XxxManager`. The returned object's methods close over the deps. Examples: `createConnectionManager()`, `createTurnTimerManager()`, `createLocalTransport()`.

`GameClient` in `main.ts` wires deps objects via lazy getters that bind callbacks to live context. The `dispatch()` switch routes commands to the extracted action functions.

When adding new side-effecting logic, prefer extending an existing `*Deps` interface over adding methods to `GameClient`. Keep pure derivation functions as direct-parameter exports — they don't need deps.

### Transport adapter

Network vs. local game branching is handled by `GameTransport` (`src/client/game/transport.ts`), not by `if (isLocalGame)` checks in action handlers:

- `createWebSocketTransport(send)` — wraps a WebSocket send function
- `createLocalTransport(deps)` — dependency-injected local resolution using callbacks

Action handlers call `this.transport.submitAstrogation(orders)` etc. instead of branching on game mode. The `isLocalGame` flag may still exist for scheduling (e.g. AI turns) but should not appear in submission logic.

### Async patterns

- **AI turn loop** uses `async/await` with `while` loops, not recursive `setTimeout` callback chains. The 500ms initial delay uses `await new Promise(r => setTimeout(r, 500))`.
- **Promise-wrap callbacks** when an animation or timer needs to be awaited: wrap the callback-based API in a `new Promise` whose resolver is called from the callback.

### Screen visibility

The `applyScreenVisibility` pattern in `UIManager` is the single choke point for screen toggling. It applies the output of the pure `buildScreenVisibility()` function. This is the one place where direct `.style.display` assignment is acceptable — everywhere else, use `show()`/`hide()`/`visible()` from `dom.ts`.

## Linting

Biome enforces the following as errors (not just warnings):

| Rule | What it enforces |
|---|---|
| `useConst` | Immutable bindings where possible |
| `noVar` | No `var` declarations |
| `noDoubleEquals` | Strict equality only |
| `useArrowFunction` | Arrow functions over function expressions |
| `noForEach` | `for...of` instead of `.forEach()` |
| `useFlatMap` | `.flatMap()` instead of `.map().flat()` |
| `noUnusedImports` | Clean imports |

Additional rules at warning level: `noNonNullAssertion`, `noExplicitAny`, `noAccumulatingSpread`, `noUnusedVariables`.

The server directory (`src/server/`) has `noUndeclaredVariables` disabled because Cloudflare Workers globals (like `WebSocketPair`) are not recognized by biome.

## Practical Style

- Use descriptive names over abbreviations unless the abbreviation is already standard in the codebase.
- Add comments sparingly and only where they explain non-obvious intent.
- Prefer direct control flow over abstract indirection.
- Keep public-facing behavior changes accompanied by tests or a clear rationale when tests are not practical.
- **Use `for...of`** instead of `.forEach()` — enforced by biome. When you need the index, use `for (const [i, item] of arr.entries())`.
- **Avoid `.map().filter(x => x != null)`** — use `filterMap()` from `src/shared/util.ts` for a single-pass transform-and-discard.
- **Prefer `byId()`** over `document.getElementById()!` — it throws on missing elements with a clear error message and avoids non-null assertions.
