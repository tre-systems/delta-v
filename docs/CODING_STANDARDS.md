# Delta-V Coding Standards

The conventions that fit this codebase today. The **what** (rules, prefixes, formatting); the **why** lives in the [Pattern Catalogue](../patterns/README.md).

Each item is tagged:

- **Required** — expected for new code and refactors unless explicitly waived
- **Recommended** — preferred default; deviate only for readability, correctness, or platform constraints
- **Reference** — background context for alignment across modules

## Core Principles

- **Required:** keep docs aligned with the actual implementation.
- Prefer readability over cleverness.
- Prefer a single typed options object for any API with about five or more parameters (especially public renderer and UI helpers).
- Prefer small, testable extractions over large architectural rewrites.
- Keep the shared rules engine functional and data-oriented.
- Default to functions and factory managers. Use `class` only at imperative boundaries where long-lived mutable state is natural or the platform requires it.

## Project Shape

### Shared engine (`src/shared/`)

**Required for engine/rules code:** side-effect-free (no I/O — no DOM, no network, no storage), plain typed data, testable in isolation.

Turn-resolution entry points `structuredClone` their input state and require a mandatory `rng: () => number` parameter. Full walkthrough: [patterns/engine-and-architecture.md](../patterns/engine-and-architecture.md) (sections "Side-Effect-Free Shared Engine" and "Deterministic RNG via Per-Match Seed").

Avoid pushing browser, network, storage, or rendering concerns into `src/shared/`.

### Imperative boundaries

Default to plain functions, typed data, and `createXxx()` managers. The pattern walkthrough is in [patterns/engine-and-architecture.md#composition-root-for-client-construction](../patterns/engine-and-architecture.md#composition-root-for-client-construction).

**Required class:** `GameDO` in `src/server/game-do/game-do.ts` must `extend DurableObject` — Cloudflare's API, not a stylistic choice.

Everything else uses the `createXxx()` factory shape: `createGameClient()`, `createInputHandler()`, `createUIManager()`, `createRenderer()`, `createCamera()`, `createBotClient()`, and so on. Returned types are usually `ReturnType<typeof create…>`.

Guidance:

- If an imperative boundary binds DOM, window, or other long-lived event listeners, own explicit teardown via `dispose()` or equivalent returned disposers.
- Prefer `createXxx()` factories for new client modules; do not add a class unless the platform requires it or a rare case genuinely needs `instanceof`.
- Do not extract one-use adapter factories or wrapper modules that only rename callbacks, repackage a dependency bag, or relay to a single call site. Keep that wiring inline unless the helper owns real state, lifecycle, policy, or reuse.
- When `client-kernel.ts` grows, extract responsibilities into `game/*` helpers first; avoid inflating the kernel with unrelated logic.

### DOM helpers (`src/client/dom.ts`)

Use the helpers for declarative DOM construction:

- `el(tag, props, ...children)` — element with class, text, handlers, children in one expression.
- `visible(el, condition, display?)` — accepts boolean or `ReadonlySignal<boolean>`; creates an `effect` in the active scope for signals.
- `text(el, value)` — accepts static values or signals.
- `cls(el, name, condition)` — toggle a class; accepts boolean or signal.
- `byId(id)` — typed `getElementById` that throws on missing elements.
- `listen(target, event, handler)` — registers for auto-cleanup in the active scope.
- `renderList(container, items, renderItem)` — clear + render a list.

All `innerHTML` writes go through `setTrustedHTML()` or `clearHTML()` in `dom.ts` — enforced by a pre-commit grep check. If user-controlled HTML ever enters the client, add a sanitizer (e.g. `DOMPurify`) inside `setTrustedHTML()`. For plain text use `textContent` or `el()`'s `text` prop. Background: OWASP [XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [DOM XSS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html).

### State ownership

- **PlanningState** — owned by `createGameClient()`, defined in `src/client/game/planning.ts`. Short-lived "working memory" for the current turn. Renderer reads by reference; input pipeline receives it read-only. Walkthrough: [patterns/client.md#planning-store-ephemeral-turn-state](../patterns/client.md#planning-store-ephemeral-turn-state).
- **GameState** — authoritative updates go through `applyClientGameState()` in `game/game-state-store.ts`. Other modules receive it as function arguments, never stored references. Walkthrough: [patterns/client.md#session-model-as-aggregate-root](../patterns/client.md#session-model-as-aggregate-root).

## Refactoring Guidance

**Recommended** by default; apply judgment per module.

- Extract pure helper modules before introducing new patterns or libraries.
- Reduce duplication first; do not split files only to satisfy a size target.
- Prefer inlining single-call-site wrappers when the extracted helper adds no policy, validation, or durable state.
- Keep orchestrators focused on coordination, not business logic.
- When a file grows large, split by real responsibility boundaries.
- When a stable public entry point grows too large, keep the entry file thin and re-export narrower domain modules.

### Size heuristics (not hard rules)

- Pure helpers: usually 5–25 lines.
- Coordinator methods: longer if the flow is linear.
- Files under 200 lines: nice when natural.
- Files above 500 lines: review for extraction.
- Files above 1000 lines: usually overdue for decomposition.

The 1000-line threshold applies less strictly to imperative boundary orchestrators (`client-kernel.ts`, `renderer/renderer.ts`, `game-do.ts`) that coordinate many subsystems — focus on whether responsibilities are clearly separated and helper logic has been extracted.

## Testing

**Required:** co-location, engine coverage discipline, replay/projection parity safety. **Recommended:** data-driven tests, property-based tests.

- Co-locate unit tests next to source as `*.test.ts`. Property tests as `*.property.test.ts`. Fixture data in `__fixtures__/` near consumers.
- Keep rules-heavy logic covered with direct unit tests; extract pure helpers from coordinators and test them.
- Keep Playwright focused on browser-only contracts (boot, multi-page join/reconnect/chat, storage/session recovery). Gameplay rules and scenario combinatorics go to Vitest and simulation.
- Use data-driven tests (`it.each`) for tables, mappings, and input-output pairs.
- Use property-based tests (`fast-check`) for invariants on core engine functions — co-locate as `*.property.test.ts`.
- Coverage thresholds on `src/shared/` are enforced; pre-commit and CI both run `test:coverage`.
- **Replay / projection:** changes to `event-projector`, `archive` persistence, or engine state shape must keep parity tests (`verifyGameDoProjectionParity`, game-do / event-projector tests) green and extend them when adding new persisted event types.

Pattern detail (fixtures, mock storage, seeded RNG in tests, coverage thresholds): [patterns/testing.md](../patterns/testing.md). Intro to property-based testing: fast-check's [Why Property-Based Testing?](https://fast-check.dev/docs/introduction/why-property-based/).

## Constants & Configuration

**Required** when values cross layers or affect protocol compatibility. **Recommended** for readability.

- Avoid magic numbers when the value is shared between client and server.
- Promote shared gameplay or protocol constants into `src/shared/constants.ts`.
- Keep client UI timing aligned with server-enforced timing.

## Documentation

**Required:** update docs when behavior or architecture decisions materially change.

- One owner doc per topic: rules in [SPEC.md](./SPEC.md), wire contracts in [PROTOCOL.md](./PROTOCOL.md), module layout in [ARCHITECTURE.md](./ARCHITECTURE.md), pattern rationale in [`patterns/`](../patterns/README.md), conventions here, recurring audits in [REVIEW_PLAN.md](./REVIEW_PLAN.md), open work in [BACKLOG.md](./BACKLOG.md), contributor flow in [CONTRIBUTING.md](./CONTRIBUTING.md).
- Do not leave roadmap items marked as future once shipped.
- When a decision is referenced from multiple places, add a short anchored subsection to the most relevant doc rather than duplicating prose.

---

## Common Patterns

Pattern rationale — with examples and tradeoffs — lives in [`patterns/`](../patterns/README.md). This section lists the conventions that new code should follow.

### Discriminated unions

- **Client variants** use `kind` as discriminator: `GameCommand`, `KeyboardAction`, `BurnChangePlan`, `LocalResolution`, `AIActionPlan`.
- **Network messages** use `type` as discriminator: `C2S`, `S2C` in `types/protocol.ts`.

Always handle every variant in a `switch` — TypeScript's exhaustive checking catches missing cases. Background: [TS Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

### Derive / plan (functional core, imperative shell)

Name pure functions `derive*`, `build*`, `resolve*`. They return a data object ("plan"). A separate `apply*` / `setState` call performs the side effect. Reference: [Gary Bernhardt, "Boundaries"](https://www.destroyallsoftware.com/talks/boundaries). Walkthrough: [patterns/client.md](../patterns/client.md).

### Single choke points

High-risk side effects have one owner:

- `dispatchGameCommand()` — client command routing
- `applyClientStateTransition()` — client state-entry effects
- `applyClientGameState()` — authoritative state apply
- `applyUIVisibility()` — top-level screen toggling (via `createUIManager`)
- `runPublicationPipeline()` — server event append / checkpoint / parity / archive / timer / broadcast

Do not route the same mutation through multiple call sites. Walkthrough: [patterns/engine-and-architecture.md#single-choke-points-for-side-effects](../patterns/engine-and-architecture.md#single-choke-points-for-side-effects).

### Contract fixtures

When a shape must stay stable across modules or over time, add fixture-style tests for validated C2S messages, state-bearing S2C messages, and replay payloads. See [patterns/testing.md#contract-fixtures-for-protocol-shapes](../patterns/testing.md#contract-fixtures-for-protocol-shapes).

### Guard validation (null-or-error helpers)

Internal validation helpers return `null` on success or an error object on failure:

```typescript
const validatePhaseAction = (
  state: GameState,
  playerId: number,
  requiredPhase: Phase,
): EngineError | null => {
  if (state.phase !== requiredPhase) {
    return { code: ErrorCode.INVALID_PHASE, message: `Not in ${requiredPhase} phase` };
  }
  return null;
};

const phaseError = validatePhaseAction(state, playerId, 'astrogation');
if (phaseError) return { error: phaseError };
```

All validation happens before any mutations — fail fast on known-bad state, then proceed with known-good state.

### Error returns

Two conventions for success-or-error:

**Engine results** — `{ state, ... } | { error: EngineError }`. Used by engine entry points. Narrow with `'error' in result`:

```typescript
const result = processAstrogation(state, playerId, orders, map, rng);
if ('error' in result) return { kind: 'error', error: result.error };
// result.state, result.movements, ...
```

**`Result<T, E = string>`** — generic type in `domain.ts`. Used by validators, parsers, and any code returning a typed value or an error. Narrow with `.ok`:

```typescript
const parsed = validateClientMessage(raw);
if (!parsed.ok) return sendError(ws, parsed.error);
// parsed.value is typed C2S
```

Use engine-style for game logic with heterogeneous success shapes. Use `Result<T, E>` for parse/validate. Walkthrough: [patterns/type-system-and-validation.md#resultt-e-and-engine-style-returns](../patterns/type-system-and-validation.md#resultt-e-and-engine-style-returns).

### Event accumulation

Engine functions collect `EngineEvent[]` in a local array and return them alongside the result state. Events are never emitted as side effects:

```typescript
const engineEvents: EngineEvent[] = [];
engineEvents.push({ type: 'shipMoved', shipId, from, to, fuelSpent });
if (course.crashed) engineEvents.push({ type: 'shipCrashed', shipId, hex });

const subResult = resolvePostMovement(state, map, rng);
engineEvents.push(...subResult.engineEvents);

return { state, engineEvents };
```

Turn-resolution entry points (`processAstrogation`, `processCombat`, `processOrdnance`, `skipOrdnance`, `processLogistics`, `skipLogistics`, `processSurrender`, `processEmplacement`, `processFleetReady`, `beginCombatPhase`, `skipCombat`) return `engineEvents`. Helpers like `createGame` and `filterStateForPlayer` do not. The server reads `result.engineEvents` directly — no server-side event derivation.

### Data-driven lookup tables

Prefer declarative `Record<string, T>` tables and indexed arrays over `if`/`switch` trees for game data (ship stats, damage tables, ordnance mass, detection ranges). Add new dimensions as new records in `constants.ts` rather than encoding them into function logic. Background: Steve McConnell, *Code Complete*, ch. 18 ("Table-Driven Methods").

```typescript
const SHIP_STATS: Record<string, ShipStats> = {
  transport: { name: 'Transport', combat: 1, fuel: 10, cargo: 50 },
  corvette:  { name: 'Corvette',  combat: 3, fuel: 16, cargo: 0  },
};
const GUN_COMBAT_TABLE: number[][] = [
  [0, 0, 0, 0, 0, 0],  // modified roll ≤ 0
  [0, 0, 0, 0, 0, 2],  // modified roll 1
  …
];
```

### Composable configuration objects

When behavior varies by mode (difficulty, scenario), separate scoring/decision logic from tuning weights. Define a config type and pass it to pure scoring functions. Walkthrough: [patterns/scenarios-and-config.md#ai-config-as-weights-not-code](../patterns/scenarios-and-config.md#ai-config-as-weights-not-code).

### Scenario rules as feature flags

`ScenarioRules` controls behavior variation across scenarios. Defaults are permissive — omitting a field enables the feature. Engine and client UI derive from the same rule helpers to avoid drift. Walkthrough: [patterns/scenarios-and-config.md#scenario-rules-as-feature-flags](../patterns/scenarios-and-config.md#scenario-rules-as-feature-flags).

### String-key serialization for Map lookups

`Map` and `Set` use reference equality. Coordinate-style value objects need string serialization:

```typescript
const hexKey = ({ q, r }: HexCoord): HexKey => `${q},${r}` as HexKey;
const parseHexKey = (key: HexKey): HexCoord => {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
};

map.hexes.get(hexKey(ship.position));    // Map<HexKey, MapHex>
visited.add(hexKey(neighbor));

const key = asHexKey('0,0');              // at serialization boundaries
```

Use the same pattern for any value-object key: define `xxxKey()` and, if needed, `parseXxxKey()`. Hex-coord background: Red Blob Games' [Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/).

### Reactive signals (UI layer)

`src/client/reactive.ts` provides `signal`, `computed`, `effect`, `batch`, `withScope`, `registerDisposer`, `createDisposalScope()`. Used selectively in the DOM UI layer and for durable session/UI state — not as a global store.

Rules:

- **Use implicit scoping.** Wrap UI initialization in `withScope(scope, () => { … })` so `effect`, `computed`, and `listen` auto-register.
- Own effects explicitly. Any view or manager that creates `computed()` / `effect()` graphs owns a `DisposalScope` and exposes `dispose()`.
- Keep derivation pure. Use `computed()` for derived values, `effect()` for DOM writes and other side effects.
- Batch related writes. Wrap multi-signal updates in `batch()` when they feed the same computed/effect.
- Clone before storing a shared object reference in a signal, or pair it with a version signal.
- Keep signals local to the view they serve; don't thread signals through the whole client graph.
- Separate durable UI state (waiting, reconnect, game-over, replay, timer) from one-shot events (toasts, sounds, user commands).

Walkthrough: [patterns/client.md#reactive-signals-zero-dependency](../patterns/client.md#reactive-signals-zero-dependency). Background: Solid's [Fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity), Preact's [Signals guide](https://preactjs.com/guide/v10/signals/).

### Dependency injection

- **Pure functions** take direct parameters (or a small typed options object).
- **Side-effecting functions** take a `deps` object as their first parameter. Examples: `CombatActionDeps`, `AstrogationActionDeps`, `PresentationDeps`, `LocalGameFlowDeps`.
- **Callable getter deps** (`getXxx: () => T`) ensure consumers always read fresh state and break circular init-order dependencies. Use direct references for stable service objects.
- **Managers** use the factory pattern: `createXxx(deps: XxxDeps): XxxManager`. The returned methods close over the deps.

When adding new side-effecting logic, prefer extending an existing `*Deps` interface over widening the bootstrap return value. When the client decides whether an action is legal or visible, reuse shared rule helpers from `src/shared/engine/` rather than duplicating UI heuristics.

Background: Martin Fowler, [Dependency Injection](https://martinfowler.com/articles/injection.html); Mark Seemann, [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/).

### Transport adapter

Network vs. local game branching is hidden by `GameTransport` (`src/client/game/transport.ts`). Action handlers call `transport.submitAstrogation(orders)` instead of branching on `isLocalGame`. The flag may still appear in scheduling logic (AI-turn timing) but should not appear in submission logic.

### Async patterns

- **AI turn loop** uses `async/await` + `while`, not recursive `setTimeout` chains. The 500 ms initial delay is `await new Promise(r => setTimeout(r, 500))`.
- **Promise-wrap callbacks** when an animation or timer needs to be awaited.

### Screen visibility

`screenModeSignal` + `applyUIVisibility()` inside `createUIManager()` is the single choke point for screen toggling, applying the output of pure `buildScreenVisibility()`. This is the one place where direct `.style.display` assignment is acceptable. Everywhere else, use `show()` / `hide()` / `visible()` from `dom.ts`.

### Library adoption

Default to no new runtime library. Add one only if it clearly does one of:

- Removes a real security risk.
- Removes a repeated maintenance burden already being paid.
- Simplifies a broad class of code without hiding control flow or ownership.

Current stance:

- **Good candidate when needed:** `DOMPurify` for any future user-controlled or external HTML.
- **Reasonable later if schemas grow:** `Valibot` or `Zod` for protocol/event schema ownership.
- **Do not add by default:** React, Vue, Redux, Zustand, RxJS, XState, Immer, or rendering frameworks.
- **Do not replace `reactive.ts` just to use a library** — switch only if ownership of reactive internals is no longer wanted.

New library proposals should explain: why existing code is insufficient, which modules simplify, what bundle/runtime/test costs are introduced, and how the library fits the existing architecture boundaries.

---

## Naming Conventions

### Files, functions, types

- **Files:** kebab-case (`game-engine.ts`, `combat-actions.ts`, `phase-entry.ts`).
- **Functions:** camelCase (`processAstrogation`, `derivePhaseTransition`).
- **Types / interfaces:** PascalCase (`GameState`, `Ship`, `CombatActionDeps`).
- **`type` by default** for aliases, unions, intersections, and most local object shapes.
- **`interface` only when extensibility matters** — especially exported object contracts that may be extended or declaration-merged.
- **Never force `interface` for unions** — keep discriminated unions as `type`.

### Function prefix conventions

| Prefix | Meaning | Side effects? | Examples |
| --- | --- | --- | --- |
| `derive*` | Compute a view/plan from state | No | `deriveHudViewModel`, `derivePhaseTransition` |
| `build*` | Construct a complex object | No | `buildAstrogationOrders`, `buildShipTooltipHtml` |
| `resolve*` | Interpret input, produce structured result | No | `resolveAIPlan`, `resolveBaseEmplacementPlan` |
| `process*` | Apply game logic, return new state | Clone-on-entry | `processAstrogation`, `processCombat` |
| `create*` | Construct new instance / manager | No | `createGame`, `createConnectionManager` |
| `check*` | Detect condition, may mutate state | Sometimes | `checkRamming`, `checkGameEnd` |
| `apply*` | Apply transformation to state | Yes | `applyClientGameState`, `applyDamage` |
| `get*` | Retrieve / lookup | No | `getTooltipShip`, `getNextSelectedShip` |
| `is*` / `has*` | Boolean predicate | No | `isGameOver`, `hasLineOfSight` |
| `present*` | Show result / outcome to user | Yes (client) | `presentMovementResult`, `presentCombatResults` |
| `show*` | Display UI element or feedback | Yes (client) | `showGameOverOutcome`, `showToast` |
| `render*` | Paint Canvas or build/update DOM | Yes (client) | `renderHexGrid`, `renderTransferPanel` |
| `draw*` | Paint Canvas overlays, icons, trails, toasts | Yes (client) | `drawShipsLayer`, `drawMinimapOverlay` |
| `handle*` | React to an event or message | Yes | `handleLocalResolution`, `handleMessage` |
| `play*` | Trigger animation or sequence | Yes (client) | `playLocalMovementResult`, `playSound` |
| `move*` | Relocate entity in game state | Yes (engine) | `moveOrdnance`, `moveShip` |
| `queue*` | Schedule future action / event | Yes (engine) | `queueAsteroidHazards`, `queueAttack` |

### Type patterns

- **Bounded type modules** — `types/domain.ts` (state/ships/phases), `types/protocol.ts` (C2S/S2C), `types/scenario.ts` (scenarios/rules). Barrel `types/index.ts` re-exports all three. Import from the specific module only when emphasising a boundary.
- **`Pick<T, K>` for narrow signatures** — when a helper only needs a few fields of a large interface, use `Pick`. Easier to test, clearer intent. Reference: [TS Handbook — Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html).
- **Lifecycle + control string-literal fields** — entities with complex state use small unions rather than multiple booleans. `Ship.lifecycle` is `'active' | 'landed' | 'destroyed'`; `Ship.control` is `'own' | 'captured' | 'surrendered'`.
- **`ReturnType<typeof createXxx>` for factory types** — derive the public type from the factory rather than declaring a separate interface. Keeps the type in sync with the implementation automatically.

---

## Functional Style

The shared engine is data-oriented. Lean into functional patterns:

- **Prefer `src/shared/util.ts` helpers** over handwritten loops when they clarify intent:

  | Helper | Replaces |
  | --- | --- |
  | `sumBy(arr, fn)` | `arr.reduce((s, x) => s + fn(x), 0)` |
  | `minBy` / `maxBy` | Loops tracking `bestVal` / `bestItem` |
  | `count(arr, fn)` | `arr.filter(fn).length` |
  | `indexBy(arr, fn)` | `new Map(arr.map(x => [fn(x), x]))` |
  | `groupBy(arr, fn)` | Reduce building `Record<string, T[]>` |
  | `partition(arr, fn)` | Two opposite `.filter()` calls |
  | `compact(arr)` | `.filter(x => x != null)` with narrowing |
  | `filterMap(arr, fn)` | `.map(fn).filter(x => x != null)` in one pass |
  | `uniqueBy(arr, fn)` | `[...new Set(arr.map(fn))]` |
  | `pickBy(obj, fn)` / `mapValues(obj, fn)` | `Object.fromEntries(Object.entries(obj)…)` |
  | `cond([p, v], …)` | Chains of `if (p) return v;` |
  | `condp` / `matchEq` (+ `condpOr` / `matchEqOr`) | Clojure-style value dispatch |
  | `clamp(n, min, max)` | `Math.min(Math.max(n, min), max)` |
  | `randomChoice(arr, rng)` | `arr[Math.floor(rng() * arr.length)]` |

- **`cond` vs `condp` / `matchEq` vs `switch` vs ternary:**
  - `cond()` — multiple independent boolean conditions.
  - `condp(pred, expr, [test, result], …)` — same comparison pattern against successive values.
  - `matchEq(expr, [k1, v1], …)` — strict equality dispatch; `condpOr` / `matchEqOr` take an explicit default (avoids trailing `??`).
  - `switch` — discriminated-union narrowing (TypeScript's exhaustive check catches misses).
  - Ternary — simple two-branch expression.

- **Prefer expressions over statements.** `filter → map` is clearer than a loop pushing to an array.
- **Avoid mutable accumulators** when a helper already captures the pattern.
- **Prefer `filterMap` over `.map().filter()`** when transforming and discarding nulls.
- **Prefer `count` over `.filter().length`** — avoids allocating an intermediate array.
- **Build lookup structures declaratively** — `indexBy(orders, o => o.shipId)` over a manual loop.
- **Don't force it.** Imperative code is fine for inherently stateful logic (tracking previous iteration, complex early-exit conditions, Canvas drawing).
- **Prefer arrow functions** over function declarations.

---

## Linting

**Required:** treat Biome and typecheck failures as blockers.

Biome enforces (as errors, not warnings): `useConst`, `noVar`, `noDoubleEquals`, `useArrowFunction`, `noForEach`, `useFlatMap`, `noUnusedImports`, `noExplicitAny`, `noUnusedVariables`, `useTemplate`, `noNonNullAssertion`, and others — see [`biome.json`](../biome.json) for the full set.

Exceptions (e.g. Cloudflare globals in `src/server/`) are configured in `biome.json` rather than assumed in prose.

**CI and hooks:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `npm run lint` and `npm run typecheck:all`. The Husky pre-commit hook runs the same commands (plus tests and simulation). `npm run verify` runs the same pipeline locally — see [CONTRIBUTING.md](./CONTRIBUTING.md).

Type checking is split intentionally:

- `tsconfig.json` checks application code (`src/`).
- `tsconfig.tools.json` checks tooling (`scripts/`, `e2e/`, root config files).
- Use `npm run typecheck` for app code; `npm run typecheck:all` before pushing.

---

## Formatting

**Recommended:** consistency over rigid rule-lawyering.

- **Line width** under 80 characters where practical. Break at natural points (commas, operators, arrow functions). Some lines will be longer — fine if breaking hurts readability.
- **Generous whitespace** — blank lines between methods, top-level declarations, after import blocks, around loops, before `return` statements following logic, and between distinct logical steps. Biome collapses consecutive blanks to one.
- **Long signatures** — prefer a single typed options object at ~5+ parameters. Otherwise put each parameter on its own line when the line exceeds ~80 characters.
- **Long objects / arrays** — one property/element per line.
- **Long conditionals** — break `if` conditions and ternaries across lines.
- **Chained methods** — one `.method()` per line for long chains (map/filter/reduce).

---

## Practical Style

**Recommended** defaults for day-to-day authoring.

- Descriptive names over abbreviations (unless the abbreviation is standard).
- Comments sparingly — only where they explain non-obvious intent.
- Direct control flow over abstract indirection.
- Behavior changes accompanied by tests, or a clear rationale where tests aren't practical.
- **`for…of` over `.forEach()`** on arrays when you own the body. For index use `for (const [i, item] of arr.entries())`.
- **`filterMap()` over `.map().filter(x => x != null)`**.
- **`byId()` over `document.getElementById()!`** — throws with a clear error; avoids non-null assertions.
