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

All engine entry points clone the input state on entry (`structuredClone`) — the caller's state is never mutated. Internally, the clone is mutated in place for efficiency. Callers must use the returned `result.state`. RNG is fully injectable — all engine entry points require a mandatory `rng: () => number` parameter with no `Math.random` fallbacks in the turn-resolution path.

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

Imperative boundary orchestrators (`main.ts`, `renderer.ts`, `game-do.ts`) tend to be larger because they coordinate many subsystems. The 1000-line heuristic applies less strictly to these files — focus on whether responsibilities are clearly separated and helper logic has been extracted.

Do not create meaningless wrapper functions or over-fragment files just to hit numeric targets.

## Testing

- Co-locate unit tests next to the source file as `*.test.ts`.
- Keep rules-heavy logic covered with direct unit tests.
- When extracting pure helpers from client/server coordinators, add tests for those helpers.
- Prefer targeted tests around risky logic over shallow coverage inflation.
- Use data-driven tests (`it.each` / `describe.each`) to reduce verbosity when testing tables, mappings, or many input-output pairs. This is especially useful for combat tables, damage lookups, and hex math.
- Use **property-based tests** (`fast-check`) for invariant verification on core engine functions. Co-locate as `*.property.test.ts` next to the source file. Property tests complement unit tests by fuzzing inputs to verify that invariants hold universally (e.g., "fuel never goes negative", "hex distance is symmetric", "higher odds never produce worse combat results").
- Coverage thresholds are enforced on `src/shared/` via vitest config — the pre-commit hook and CI both run `test:coverage` to prevent backsliding.

## Constants And Configuration

- Avoid magic numbers when a value is shared across client/server behavior.
- Promote shared gameplay or protocol constants into `src/shared/constants.ts` when appropriate.
- Keep client UI timing displays aligned with server-enforced timing.

## Docs

- Update docs when behavior changes materially.
- Do not leave roadmap items marked as future work once they are implemented.
- Architecture docs should describe the real join flow, validation model, and authority boundaries.

## Common Patterns

### Discriminated unions

Union types with a literal discriminator field, narrowed via `switch` or `if`. See [TypeScript Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

- **Client-side variants** use `kind` as discriminator: `LocalResolution`, `AIActionPlan`, `GameCommand`, `KeyboardAction`, `BurnChangePlan`.
- **Network messages** use `type` as discriminator: `C2S`, `S2C` message unions in `types.ts`.

Always handle all variants with a `switch` — TypeScript's exhaustive checking catches missing cases.

### Derive/plan pattern

Pure functions named `derive*` compute a data object (a "plan") describing what should happen. The caller interprets the plan and performs side effects. This separates decision logic from execution, making both testable independently.

```
derivePhaseTransition(state) → PhaseTransitionPlan    // pure: what should change
setState(plan.nextState)                               // impure: apply it
```

Examples: `deriveClientScreenPlan`, `deriveGameOverPlan`, `deriveClientMessagePlan`, `deriveBurnChangePlan`, `deriveHudViewModel`, `deriveKeyboardAction`, `deriveAIActionPlan`, `deriveClientStateEntryPlan`, `derivePhaseTransition`.

The `deriveClientStateEntryPlan()` function in `game/phase-entry.ts` is the most elaborate example — it returns a `ClientStateEntryPlan` with ~15 boolean/enum flags controlling camera reset, HUD visibility, timer start, tutorial triggers, and combat state on each phase entry. The caller (`setState()` in `main.ts`) applies the plan imperatively.

This is the [functional core / imperative shell](https://www.destroyallsoftware.com/talks/boundaries) pattern (Gary Bernhardt, ["Boundaries"](https://www.destroyallsoftware.com/talks/boundaries), SCNA 2012) — pure derivation in the core, side effects at the boundary. See also Mark Seemann's [dependency rejection](https://blog.ploeh.dk/2017/01/27/from-dependency-injection-to-dependency-rejection/) series for the same idea applied to functional programming.

### Error returns

Two error-return conventions exist, each for a different context:

**Engine results** — `{ state, ... } | { error: string }`. Used by engine entry points (`processAstrogation`, `processCombat`, etc.) where the success shape varies by function. Callers narrow with `'error' in result`:

```typescript
const result = processAstrogation(
  state, playerId, orders, map, rng,
);
if ('error' in result) {
  return { kind: 'error', error: result.error };
}
// result.state, result.movements, etc.
```

**Protocol validation** — `{ ok: true; value: T } | { ok: false; error: string }`. Used by `protocol.ts` validation functions where the success type is uniform and the caller needs a typed `value`. Callers narrow with `.ok`:

```typescript
const parsed = validateAstrogationOrders(raw);
if (!parsed.ok) return sendError(ws, parsed.error);
// parsed.value is typed AstrogationOrder[]
```

Use **engine-style** for game logic results with heterogeneous success shapes. Use **protocol-style** for parse/validate functions that extract a typed value from untrusted input.

### Function prefix conventions

| Prefix | Meaning | Side effects? | Examples |
|--------|---------|---------------|----------|
| `derive*` | Compute a view/plan from state | No | `deriveHudViewModel`, `derivePhaseTransition` |
| `build*` | Construct a complex object | No | `buildAstrogationOrders`, `buildShipTooltipHtml` |
| `resolve*` | Interpret input, produce structured result | No | `resolveAIPlan`, `resolveBaseEmplacementPlan` |
| `process*` | Apply game logic, return new state | Clone-on-entry | `processAstrogation`, `processCombat` |
| `create*` | Construct new instance/manager | No | `createGame`, `createConnectionManager` |
| `check*` | Detect condition, may mutate state | Sometimes | `checkRamming`, `checkGameEnd` |
| `apply*` | Apply transformation to state | Yes | `applyGameState`, `applyDamage` |
| `get*` | Retrieve/lookup | No | `getTooltipShip`, `getNextSelectedShip` |
| `is*` / `has*` | Boolean predicate | No | `isGameOver`, `hasLineOfSight` |
| `present*` | Show result/outcome to user | Yes (client) | `presentMovementResult`, `presentCombatResults` |
| `show*` | Display UI element or feedback | Yes (client) | `showGameOverOutcome`, `showToast` |
| `render*` | Build/update DOM elements | Yes (client) | `renderTransferPanel`, `renderMinimap` |
| `handle*` | React to an event or message | Yes | `handleLocalResolution`, `handleMessage` |
| `play*` | Trigger animation or sequence | Yes (client) | `playLocalMovementResult`, `playSound` |
| `move*` | Relocate entity in game state | Yes (engine) | `moveOrdnance`, `moveShip` |
| `queue*` | Schedule future action/event | Yes (engine) | `queueAsteroidHazards`, `queueAttack` |

### Naming conventions

- **Files**: kebab-case (`game-engine.ts`, `combat-actions.ts`, `phase-entry.ts`)
- **Functions**: camelCase (`processAstrogation`, `derivePhaseTransition`)
- **Types/Interfaces**: PascalCase (`GameState`, `Ship`, `CombatActionDeps`)
- **`interface`** for extensible data shapes (`GameState`, `Ship`, `CourseResult`)
- **`type`** for discriminated unions and aliases (`C2S`, `S2C`, `GameCommand`, `LocalResolution`)

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
  | `clamp(n, min, max)` | `Math.min(Math.max(n, min), max)` |
  | `randomChoice(arr, rng)` | `arr[Math.floor(rng() * arr.length)]` (injectable RNG) |

- **`cond()` vs `switch` vs ternaries.** Use `cond()` when selecting a value from a list of independent boolean conditions — it reads like a decision table and avoids nested ternaries. Use `switch` when narrowing a discriminated union (TypeScript's exhaustive checking catches missing cases). Use a ternary for simple two-branch expressions.

  ```typescript
  // cond: multiple independent conditions → value
  const status = cond(
    [ship.destroyed, 'destroyed'],
    [ship.captured, 'captured'],
    [ship.landed, 'landed'],
  ) ?? 'active';

  // switch: discriminated union narrowing
  switch (cmd.type) {
    case 'confirmOrders': ...
    case 'setBurnDirection': ...
  }
  ```

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

- **PlanningState** is owned by `GameClient` in `main.ts`, defined in `src/client/game/planning.ts`. It is the client-side "working memory" for the current turn — the uncommitted moves that get sent to the server on confirm. Renderer receives it as a constructor parameter and reads the shared reference each frame to draw previews. `InputHandler` does not receive PlanningState — it emits raw spatial events (`InputEvent`), and `interpretInput()` receives PlanningState as a read-only argument to produce `GameCommand[]`.

  Key fields: `burns` (Map of ship → burn direction), `overloads` (Map of ship → overload direction), `queuedAttacks` (buffered combat declarations), `selectedShipId`, `hoverHex`, `combatTargetId`/`combatAttackerIds` (combat planning), `torpedoAccel` (torpedo launch direction). Reset via `createInitialPlanningState()` on phase transitions.

- **GameState** is owned by `GameClient`, updated via `applyGameState()`. Other modules receive it as function arguments, never as stored references.

### Dependency injection

Client game modules use two patterns depending on purity (see [dependency injection](https://en.wikipedia.org/wiki/Dependency_injection)):

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

## Formatting

- **Line width**: keep lines under 80 characters where practical. Break long lines at natural points (after commas, before operators, at arrow functions). Some lines will be longer — that's fine if breaking them would hurt readability.
- **Generous whitespace**: add blank lines between logical blocks — between functions, after import blocks, between distinct steps within a function, before return statements that follow logic, between groups of related declarations. Code should look simple, clear, and airy — not dense or cramped.
- **Long signatures**: put each parameter on its own line when the signature exceeds ~80 chars.
- **Long objects/arrays**: put each property or element on its own line.
- **Long conditionals**: break `if` conditions and ternaries across multiple lines.
- **Chained methods**: put each `.method()` on its own line for long chains (map/filter/reduce etc.).

## Practical Style

- Use descriptive names over abbreviations unless the abbreviation is already standard in the codebase.
- Add comments sparingly and only where they explain non-obvious intent.
- Prefer direct control flow over abstract indirection.
- Keep public-facing behavior changes accompanied by tests or a clear rationale when tests are not practical.
- **Use `for...of`** instead of `.forEach()` — enforced by biome. When you need the index, use `for (const [i, item] of arr.entries())`.
- **Avoid `.map().filter(x => x != null)`** — use `filterMap()` from `src/shared/util.ts` for a single-pass transform-and-discard.
- **Prefer `byId()`** over `document.getElementById()!` — it throws on missing elements with a clear error message and avoids non-null assertions.
