# Delta-V Coding Standards

This document captures the coding conventions that fit this codebase as it exists today. It is a pragmatic reference guide: standards that are enforced, conventions that are strongly recommended, and pattern examples that explain the architecture.

## How To Read This

- **Required**: expected for new code and refactors unless there is a documented exception.
- **Recommended**: preferred default; deviate only when readability, correctness, or platform constraints justify it.
- **Reference**: explanatory patterns and examples to align implementation style across modules.

## Core Principles

- **Required:** keep docs aligned with the actual implementation.
- Prefer readability over cleverness.
- Prefer a single options object over long positional parameter lists (about five or more parameters), especially for public renderer and UI helpers.
- Prefer small, testable extractions over large architectural rewrites.
- Keep the shared rules engine functional and data-oriented.
- Prefer functions and factory managers by default. Use classes only at imperative boundaries where long-lived mutable state is natural or the platform requires them.

## Project Shape

### Shared engine

Files under `src/shared/` should remain:

- **Required** for engine/rules code:
- side-effect-free (no I/O: no DOM, no network, no storage)
- plain typed data
- easy to test in isolation

Turn-resolution engine entry points clone the input state on entry (`structuredClone`) — the caller's state is never mutated. Internally, the clone is mutated in place for efficiency. Callers must use the returned `result.state`. RNG is fully injectable on those paths — they require a mandatory `rng: () => number` parameter with no `Math.random` fallbacks in the turn-resolution path. Setup helpers such as `createGame` build state from scratch and use optional `rng` with a `Math.random` default.

Avoid pushing browser, network, storage, or rendering concerns into the shared engine.

### Imperative boundaries

Default to plain functions, typed data, and
`createXxx()` managers. Do not introduce a class just to
group methods around private state.

**Required class:** `GameDO` in `src/server/game-do/game-do.ts` must
`extend DurableObject` — Cloudflare's API, not a stylistic choice.

**Everything else** at those imperative boundaries uses the same
`createXxx()` factory pattern as the rest of the client: `createGameClient()`
in `src/client/game/client-kernel.ts`, `createInputHandler()` in `src/client/input.ts`,
`createUIManager()` in `src/client/ui/ui.ts`, and `createBotClient()` in
`scripts/load-test.ts`. Returned types are usually
`ReturnType<typeof create…>` (for example `GameClient`, `InputHandler`,
`UIManager`).

**Canvas rendering** uses the same factory idea without a
class: `createRenderer()` in `src/client/renderer/renderer.ts`
and `createCamera()` in `src/client/renderer/camera.ts` own
long-lived mutable browser state (animation managers, static
scene cache, listeners). The public type is
`ReturnType<typeof createRenderer>` (exported as `Renderer`).
Frame drawing is split across focused modules under
`src/client/renderer/` (for example `scene.ts`, `ships.ts`,
`overlay.ts`, `toast-draw.ts`, `minimap-draw.ts`); the factory
wires them. Public draw helpers with many parameters take a
single typed input object (`DrawShipsLayerInput`,
`DrawMinimapOverlayInput`, `DrawShipIconInput`, etc.) — see Core
Principles.

Guidance:

- If an imperative boundary binds DOM, window, or other
  long-lived event listeners, it should own explicit
  teardown via `dispose()` or equivalent returned
  disposers rather than relying on page lifetime.
- Prefer `createXxx()` factories for new client modules;
  do not add a class unless the platform requires it (as
  with `GameDO`) or a rare case genuinely needs `instanceof`.
- When `game/client-kernel.ts` (`createGameClient`) grows again,
  extract responsibilities into `game/*` helpers first;
  avoid inflating the kernel with unrelated logic.

### DOM helpers

Use `src/client/dom.ts` helpers for declarative DOM construction in UI code:

- **`el(tag, props, ...children)`** — Create elements with class, text, handlers, and children in one expression.
- **`visible(el, condition, display?)`** — "Smart Helper" that accepts a boolean or a `ReadonlySignal<boolean>`. If a signal is provided, it automatically creates an `effect` within the active scope.
- **`text(el, value)`** — "Smart Helper" that sets `textContent`. Accepts static values or `ReadonlySignal<unknown>`, automatically creating an `effect` for signals.
- **`cls(el, name, condition)`** — "Smart Helper" that toggles a class. Accepts a boolean or `ReadonlySignal<boolean>`, automatically creating an `effect` for signals.
- **`byId(id)`** — Typed `getElementById` that throws on missing elements.
- **`listen(target, event, handler)`** — Bind an event listener and automatically register it with the active scope for cleanup.
- **`renderList(container, items, renderItem)`** — Clear a container and render a list of items.

Prefer `el()` for building element trees programmatically.

All `innerHTML` writes go through `setTrustedHTML()` or
`clearHTML()` in `dom.ts` — never write `innerHTML`
directly outside that file. These helpers accept only
trusted internal markup (game state, static constants).
For plain text, use `textContent` or `el()`'s `text` prop.

If untrusted content (user names, chat, external data)
ever needs to render as HTML, add a sanitizer (e.g.
`DOMPurify`) inside `setTrustedHTML()`. See OWASP's
[XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
and
[DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html).

## Refactoring Guidance

- **Recommended** by default; apply judgment per module.

- Prefer extracting pure helper modules before introducing new patterns or libraries.
- Reduce duplication first. Do not split files only to satisfy a size target.
- Keep orchestrators focused on coordination, not business logic.
- When a file grows large, split by real responsibility boundaries.
- When a stable public entry point grows too large, keep the entry file thin and re-export narrower domain modules instead of preserving one monolithic implementation file.

### Size heuristics

These are heuristics, not hard rules:

- Pure helper functions should usually be small, often around `5-25` lines.
- Coordinator methods can be longer if the flow is linear and clear.
- Files under `200` lines are nice when natural, but not mandatory.
- Files above `500` lines should be reviewed for extraction opportunities.
- Files above `1000` lines are usually overdue for decomposition.

Imperative boundary orchestrators (`game/client-kernel.ts`, `renderer/renderer.ts`, `game-do/game-do.ts`) tend to be larger because they coordinate many subsystems. The 1000-line heuristic applies less strictly to these files — focus on whether responsibilities are clearly separated and helper logic has been extracted.

Do not create meaningless wrapper functions or over-fragment files just to hit numeric targets.

## Testing

- **Required:** co-location, engine coverage discipline, and parity safety checks for replay/projection changes.
- **Recommended:** data-driven tests and property-based tests where they reduce risk/boilerplate.

- Co-locate unit tests next to the source file as `*.test.ts`.
- Keep rules-heavy logic covered with direct unit tests.
- When extracting pure helpers from client/server coordinators, add tests for those helpers.
- Keep Playwright focused on a thin browser smoke layer. Do not use it as the default place for gameplay rules, per-scenario combinatorics, or deep engine assertions that are cheaper and clearer in Vitest.
- Add Playwright coverage only for browser-only contracts such as app boot, multi-page join/reconnect/chat flows, storage/session recovery, and critical UI wiring.
- Prefer targeted tests around risky logic over shallow coverage inflation.
- Use data-driven tests (`it.each` / `describe.each`) to reduce verbosity when testing tables, mappings, or many input-output pairs. This is especially useful for combat tables, damage lookups, and hex math.
- Use **property-based tests** (`fast-check`) for invariant verification on core engine functions. Co-locate as `*.property.test.ts` next to the source file. Property tests complement unit tests by fuzzing inputs to verify that invariants hold universally (e.g., "fuel never goes negative", "hex distance is symmetric", "higher odds never produce worse combat results").
- Coverage thresholds are enforced on `src/shared/` via vitest config — the pre-commit hook runs `test:coverage` to prevent backsliding; CI runs `test:coverage` as well.
- **Replay / projection:** Changes to **`event-projector`**, **`archive` persistence**, or **engine state shape** should keep **parity tests** (`verifyGameDoProjectionParity`, `game-do` / `event-projector` tests) green and extend them when adding new persisted event types.

For a good overview of when property tests add value, see
fast-check's
[Why Property-Based Testing?](https://fast-check.dev/docs/introduction/why-property-based/)
guide.

## Constants And Configuration

- **Required** when values affect cross-layer behavior or protocol compatibility.
- **Recommended** for readability and future tuning.

- Avoid magic numbers when a value is shared across client/server behavior.
- Promote shared gameplay or protocol constants into `src/shared/constants.ts` when appropriate.
- Keep client UI timing displays aligned with server-enforced timing.

## Docs

- **Required:** update docs when behavior and architecture decisions materially change.

- Update docs when behavior changes materially.
- Cross-cutting decisions: record them in [ARCHITECTURE.md](./ARCHITECTURE.md), [SECURITY.md](./SECURITY.md), or this file as appropriate; keep [BACKLOG.md](./BACKLOG.md) in sync for open work. Contributor workflow: [CONTRIBUTING.md](./CONTRIBUTING.md).
- Do not leave roadmap items marked as future work once they are implemented.
- Architecture docs should describe the real join flow, validation model, and authority boundaries.
- When a decision will be referenced from multiple places, add a short anchored subsection to the most relevant doc rather than duplicating prose.

## Common Patterns

### Discriminated unions

Union types with a literal discriminator field, narrowed
via `switch` or `if`. See the TypeScript Handbook on
[Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
and
[Union Exhaustiveness Checking](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html).

- **Client-side variants** use `kind` as discriminator: `LocalResolution`, `AIActionPlan`, `GameCommand`, `KeyboardAction`, `BurnChangePlan`.
- **Network messages** use `type` as discriminator: `C2S`, `S2C` message unions in `types/protocol.ts`.

Always handle all variants with a `switch` — TypeScript's exhaustive checking catches missing cases.

### Derive/plan pattern

Pure functions named `derive*` compute a data object (a "plan") describing what should happen. The caller interprets the plan and performs side effects. This separates decision logic from execution, making both testable independently.

```
derivePhaseTransition(state) → PhaseTransitionPlan    // pure: what should change
setState(plan.nextState)                               // impure: apply it
```

Examples: `deriveClientScreenPlan`, `deriveGameOverPlan`, `deriveClientMessagePlan`, `deriveBurnChangePlan`, `deriveHudViewModel`, `deriveKeyboardAction`, `deriveAIActionPlan`, `deriveClientStateEntryPlan`, `derivePhaseTransition`.

The `deriveClientStateEntryPlan()` function in `game/phase-entry.ts` is the most elaborate example — it returns a `ClientStateEntryPlan` with ~15 boolean/enum flags controlling camera reset, HUD visibility, timer start, tutorial triggers, and combat state on each phase entry. The `setState` function inside `createGameClient()` in `game/client-kernel.ts` delegates to `applyClientStateTransition()` in `game/state-transition.ts`, which reads that plan (and `deriveClientScreenPlan`) and applies the imperative side effects.

This is the [functional core / imperative shell](https://www.destroyallsoftware.com/talks/boundaries) pattern (Gary Bernhardt, ["Boundaries"](https://www.destroyallsoftware.com/talks/boundaries), SCNA 2012) — pure derivation in the core, side effects at the boundary. See also Mark Seemann's [dependency rejection](https://blog.ploeh.dk/2017/01/27/from-dependency-injection-to-dependency-rejection/) series for the same idea applied to functional programming.

### Single choke points for side effects

When a side-effecting domain has one obvious owner, keep
it that way. Prefer a single applier/dispatcher module
instead of many call sites performing "small" pieces of
the same mutation or publication flow.

Current examples:

- `dispatchGameCommand()` owns client command routing.
- `applyClientStateTransition()` owns client state-entry
  side effects.
- `applyClientGameState()` owns authoritative state apply
  to `ctx` (and optional test `renderer`); in the full client,
  `attachRendererGameStateMirrorEffect()` drives `renderer.setGameState`
  from `mirror.gameState` (see `docs/ARCHITECTURE.md`).
- `createUIManager()` owns top-level screen toggling via its
  internal `applyScreenVisibility` (wired through
  `createScreenActions()` for the user-facing screen methods),
  calling `applyUIVisibility()` from `ui/visibility.ts`.
- `GameDO.publishStateChange()` owns persistence,
  archival append, timer reschedule, and outbound
  state-bearing messages.

This pattern is a good fit here because it reduces drift
between similar flows and gives tests a narrow seam to
assert on. It is also why "small convenience writes"
inside unrelated modules are often a bad trade.

### Contract fixtures for protocols

When a shape is meant to remain stable across modules or
over time, do not rely only on behavioral tests. Add
representative fixture-style tests for:

- validated client protocol messages
- state-bearing server messages
- replay payloads and future event envelopes

These tests are especially valuable before event-sourced
replay work broadens the transport surface.

### Guard validation (null-or-error helpers)

Internal validation helpers return `null` on success or an
error object on failure. This separates validation from
control flow — the caller decides what to do with the error.

```typescript
const validatePhaseAction = (
  state: GameState,
  playerId: number,
  requiredPhase: Phase,
): EngineError | null => {
  if (state.phase !== requiredPhase) {
    return {
      code: ErrorCode.INVALID_PHASE,
      message: `Not in ${requiredPhase} phase`,
    };
  }
  return null;
};

// Caller:
const phaseError = validatePhaseAction(state, playerId, "astrogation");
if (phaseError) return { error: phaseError };
```

All validation happens before any mutations — fail fast,
then proceed with a known-good state.

### Error returns

Two error-return conventions exist, each for a different context:

**Engine results** — `{ state, ... } | { error: EngineError }`. Used by engine entry points (`processAstrogation`, `processCombat`, etc.) where the success shape varies by function. Callers narrow with `'error' in result`:

```typescript
const result = processAstrogation(state, playerId, orders, map, rng);
if ("error" in result) {
  return { kind: "error", error: result.error };
}
// result.state, result.movements, etc.
```

**Result\<T, E\>** — the shared generic `Result<T, E = string>` type in `domain.ts`. Used by validation functions, protocol parsing, event projection, and any code that returns a typed success value or an error. Callers narrow with `.ok`:

```typescript
const parsed = validateClientMessage(raw); // Result<C2S>
if (!parsed.ok) return sendError(ws, parsed.error);
// parsed.value is typed C2S
```

The error type `E` defaults to `string` but can be any type (e.g., `Result<JoinAttemptSuccess, Response>`).

Use **engine-style** for game logic results with heterogeneous success shapes. Use **Result\<T, E\>** for parse/validate functions and any code that returns a typed value or an error.

### Event accumulation

Engine functions collect domain events in a local array
and return them alongside the result state. Events are
never emitted as side effects — they are data returned
from pure functions.

```typescript
const engineEvents: EngineEvent[] = [];

// Push events as logic proceeds
engineEvents.push({
  type: "shipMoved",
  shipId: ship.id,
  from,
  to,
  fuelSpent,
});

if (course.crashed) {
  engineEvents.push({
    type: "shipCrashed",
    shipId: ship.id,
    hex,
  });
}

// Compose events from sub-calls
const subResult = resolvePostMovement(state, map, rng);
engineEvents.push(...subResult.engineEvents);

return { state, engineEvents };
```

Turn-resolution engine entry points (`processAstrogation`,
`processOrdnance`, `skipOrdnance`, `processFleetReady`,
`beginCombatPhase`, `processCombat`, `skipCombat`,
`processLogistics`, `skipLogistics`, `processSurrender`,
`processEmplacement`, and movement resolution that composes
sub-results) return `engineEvents: EngineEvent[]`. Helpers such as
`createGame` (returns `GameState` only) and `filterStateForPlayer`
(view projection) do not. Sub-functions return their own arrays, and
the caller spreads them into its accumulator. The server reads
`result.engineEvents` directly for persistence and broadcasting — no
server-side event derivation.

### Data-driven lookup tables

Prefer declarative `Record<string, T>` tables and
indexed arrays over scattered `if`/`switch` trees for
game data such as ship stats, damage odds, ordnance mass,
and detection ranges. Tables are easier to audit, diff,
and extend than equivalent branching logic. See Steve
McConnell's _Code Complete_ (ch. 18, "Table-Driven
Methods") for the underlying idea.

```typescript
// Named record table — lookup by key
const SHIP_STATS: Record<string, ShipStats> = {
  transport: {
    name: "Transport",
    combat: 1,
    fuel: 10,
    cargo: 50,
  },
  corvette: {
    name: "Corvette",
    combat: 3,
    fuel: 16,
    cargo: 0,
  },
};
const stats = SHIP_STATS[ship.type];

// Indexed array table — lookup by numeric index
const GUN_COMBAT_TABLE: number[][] = [
  [0, 0, 0, 0, 0, 0], // modified roll <= 0
  [0, 0, 0, 0, 0, 2], // modified roll 1
  [0, 0, 0, 0, 2, 3], // modified roll 2
];
const damage = GUN_COMBAT_TABLE[modRoll][oddsIndex];
```

When adding a new dimension of game data, create a new
record constant in `constants.ts` rather than encoding
it into function logic. This keeps the engine functions
short and the data auditable in one place.

### Composable configuration objects

When behaviour varies by mode (difficulty level, scenario
type, etc.), separate the _scoring/decision logic_ from
the _tuning weights_. Define a config type with numeric
weights and flags, then pass it to pure scoring functions.

```typescript
// Config: what varies
interface AIDifficultyConfig {
  multiplier: number;
  escapeDistWeight: number;
  ordnanceSkipChance: number;
  singleAttackOnly: boolean;
}

const AI_CONFIG: Record<AIDifficulty, AIDifficultyConfig> = {
  easy:   { multiplier: 0.7, ordnanceSkipChance: 0.3, ... },
  normal: { multiplier: 1.0, ordnanceSkipChance: 0,   ... },
  hard:   { multiplier: 1.5, ordnanceSkipChance: 0,   ... },
};

// Scorer: how it's used (pure, composable)
const scoreEscape = (
  ship: Ship,
  course: CourseResult,
  cfg: AIDifficultyConfig,
): number => {
  let score = 0;
  score += distFromCenter * cfg.escapeDistWeight * cfg.multiplier;
  return score;
};
```

Each scoring function handles one concern. The caller
composes them by summing scores across all strategies.
New behaviours are added by writing a new scorer and a
new config weight — no existing functions change. This
is the [Strategy pattern](https://refactoring.guru/design-patterns/strategy)
expressed as plain functions + config data rather than
class hierarchies.

### Scenario rules as feature flags

`ScenarioRules` controls behaviour variation across
scenarios without engine changes. The engine checks rule
flags at decision points:

```typescript
interface ScenarioRules {
  allowedOrdnanceTypes?: Ordnance["type"][];
  combatDisabled?: boolean;
  logisticsEnabled?: boolean;
  escapeEdge?: "any" | "north";
  sharedBases?: string[];
  reinforcements?: Reinforcement[];
}

// Engine checks:
if (state.scenarioRules.combatDisabled) {
  state.phase = "logistics";
  return { state, engineEvents };
}
```

Defaults are permissive — omitting a field means the
feature is available. This keeps simple scenarios minimal
while complex ones opt-in to restrictions. Both engine
validation and client UI derive from the same rule
helpers, so restricted scenarios stay consistent across
layers.

### String-key serialization for Map lookups

JavaScript `Map` and `Set` use reference equality for
object keys. Coordinate-style value objects need a string
serialization to serve as map keys. The `hexKey` /
`parseHexKey` pair is the canonical example:

```typescript
// HexKey is a branded string — prevents mixing with arbitrary strings.
const hexKey = ({ q, r }: HexCoord): HexKey => `${q},${r}` as HexKey;
const parseHexKey = (key: HexKey): HexCoord => {
  const [q, r] = key.split(",").map(Number);
  return { q, r };
};

// Usage:
map.hexes.get(hexKey(ship.position));  // Map<HexKey, MapHex>
visited.add(hexKey(neighbor));

// At serialization boundaries or in tests, cast with asHexKey():
const key = asHexKey("0,0");
```

Use the same pattern for any value-object key: define a
`xxxKey()` serializer and, if needed, a `parseXxxKey()`
deserializer. See Red Blob Games'
[Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/)
guide for background on hex coordinate systems.

### Function prefix conventions

| Prefix         | Meaning                                      | Side effects?  | Examples                                                 |
| -------------- | -------------------------------------------- | -------------- | -------------------------------------------------------- |
| `derive*`      | Compute a view/plan from state               | No             | `deriveHudViewModel`, `derivePhaseTransition`            |
| `build*`       | Construct a complex object                   | No             | `buildAstrogationOrders`, `buildShipTooltipHtml`         |
| `resolve*`     | Interpret input, produce structured result   | No             | `resolveAIPlan`, `resolveBaseEmplacementPlan`            |
| `process*`     | Apply game logic, return new state           | Clone-on-entry | `processAstrogation`, `processCombat`                    |
| `create*`      | Construct new instance/manager               | No             | `createGame`, `createConnectionManager`                  |
| `check*`       | Detect condition, may mutate state           | Sometimes      | `checkRamming`, `checkGameEnd`                           |
| `apply*`       | Apply transformation to state                | Yes            | `applyClientGameState`, `applyDamage`                    |
| `get*`         | Retrieve/lookup                              | No             | `getTooltipShip`, `getNextSelectedShip`                  |
| `is*` / `has*` | Boolean predicate                            | No             | `isGameOver`, `hasLineOfSight`                           |
| `present*`     | Show result/outcome to user                  | Yes (client)   | `presentMovementResult`, `presentCombatResults`          |
| `show*`        | Display UI element or feedback               | Yes (client)   | `showGameOverOutcome`, `showToast`                       |
| `render*`      | Paint Canvas layers or build/update DOM      | Yes (client)   | `renderHexGrid`, `renderOrdnance`, `renderTransferPanel` |
| `draw*`        | Paint Canvas overlays, icons, trails, toasts | Yes (client)   | `drawShipsLayer`, `drawMinimapOverlay`, `drawShipIcon`   |
| `handle*`      | React to an event or message                 | Yes            | `handleLocalResolution` (toasts engine errors locally), `handleMessage` |
| `play*`        | Trigger animation or sequence                | Yes (client)   | `playLocalMovementResult`, `playSound`                   |
| `move*`        | Relocate entity in game state                | Yes (engine)   | `moveOrdnance`, `moveShip`                               |
| `queue*`       | Schedule future action/event                 | Yes (engine)   | `queueAsteroidHazards`, `queueAttack`                    |

### Naming conventions

- **Files**: kebab-case (`game-engine.ts`, `combat-actions.ts`, `phase-entry.ts`)
- **Functions**: camelCase (`processAstrogation`, `derivePhaseTransition`)
- **Types/Interfaces**: PascalCase (`GameState`, `Ship`, `CombatActionDeps`)
- **`type` by default** for aliases, unions, intersections, and most local object shapes.
- **`interface` only when intentional extensibility is valuable**, especially exported object contracts that may be extended or declaration-merged.
- Prefer consistency within a file/module over churny keyword-only rewrites.
- **Never force `interface` for unions**; keep discriminated unions as `type` (`C2S`, `S2C`, `GameCommand`, `LocalResolution`).

### Type patterns

**Bounded type modules.** Types are split across three
files by ownership boundary: `types/domain.ts` (game
state, ships, phases), `types/protocol.ts` (C2S/S2C
messages), `types/scenario.ts` (scenario definitions,
rules). A barrel `types/index.ts` re-exports all three.
Import from the barrel in most code; import from the
specific module only when you need to emphasise the
boundary.

**`Pick<T, K>` for narrow function signatures.** When a
function only needs a few fields of a large interface,
use `Pick` to document the minimal dependency. This
makes the function easier to test (callers can pass a
partial object) and signals intent to readers. See the
TypeScript Handbook on
[Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html).

```typescript
const isOrderableShip = (
  s: Pick<Ship, "lifecycle" | "control" | "damage">,
): boolean =>
  s.lifecycle === "active" &&
  s.control !== "surrendered" &&
  s.damage.disabledTurns <= 0;

const isPlanetaryDefenseEnabled = (
  state: Pick<GameState, "scenarioRules">,
): boolean => state.scenarioRules.planetaryDefenseEnabled !== false;
```

Use `Pick` for helpers and predicates that are called
from many sites. Full interfaces are fine for top-level
engine entry points where the caller already has the
complete object.

**Lifecycle + control fields.** Entities with complex
state use a small set of string-literal fields rather
than boolean flags. `Ship` uses `lifecycle` (`active`,
`landed`, `destroyed`) and `control` (`own`, `captured`,
`surrendered`). Narrowing on these fields is more
readable and exhaustive than checking multiple booleans.

**`ReturnType<typeof createXxx>` for factory types.**
When a factory function returns an object literal, derive
the type from the function rather than declaring a
separate interface:

```typescript
const createConnectionManager = (deps: ConnectionManagerDeps) => {
  return { connect, disconnect, isConnected };
};

type ConnectionManager = ReturnType<typeof createConnectionManager>;
```

This keeps the type in sync with the implementation
automatically.

## Functional Style

The shared engine is data-oriented by design. Lean into that with functional patterns:

- **Prefer `src/shared/util.ts` helpers** over handwritten reduce/loop equivalents when they make intent clearer. The full set:

  | Helper                     | Replaces                                                                                                     |
  | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `sumBy(arr, fn)`           | `arr.reduce((s, x) => s + fn(x), 0)`                                                                         |
  | `minBy(arr, fn)` / `maxBy` | Loops tracking `bestVal` / `bestItem`                                                                        |
  | `count(arr, fn)`           | `arr.filter(fn).length` (avoids intermediate array)                                                          |
  | `indexBy(arr, fn)`         | `new Map(arr.map(x => [fn(x), x]))`                                                                          |
  | `groupBy(arr, fn)`         | Reduce building `Record<string, T[]>`                                                                        |
  | `partition(arr, fn)`       | Two `.filter()` calls with opposite predicates                                                               |
  | `compact(arr)`             | `.filter(x => x != null)` with correct narrowing                                                             |
  | `filterMap(arr, fn)`       | `.map(fn).filter(x => x != null)` in one pass                                                                |
  | `uniqueBy(arr, fn)`        | `[...new Set(arr.map(fn))]` or manual Set dedup                                                              |
  | `pickBy(obj, fn)`          | `Object.fromEntries(Object.entries(obj).filter(...))`                                                        |
  | `mapValues(obj, fn)`       | `Object.fromEntries(Object.entries(obj).map(...))`                                                           |
  | `cond([p, v], ...)`        | Chains of `if (p) return v;` (Clojure-style cond)                                                            |
  | `condp` / `matchEq`        | Clojure-style `condp`: same `expr` vs many `test` values with one `pred`; `matchEq` is strict-equality sugar |
  | `condpOr` / `matchEqOr`    | Same as above, but with an explicit fallback/default (avoids trailing `??`)                                  |
  | `clamp(n, min, max)`       | `Math.min(Math.max(n, min), max)`                                                                            |
  | `randomChoice(arr, rng)`   | `arr[Math.floor(rng() * arr.length)]` (injectable RNG)                                                       |

- **`cond()` vs `condp` / `matchEq` vs `switch` vs ternaries.** Use `cond()` when each clause is an arbitrary boolean (different fields, compound logic). Use `condp(pred, expr, [test, result], ...)` when every clause is the same comparison pattern between a fixed `expr` and successive `test` values (Clojure `condp`). Use `matchEq(expr, [k1, v1], [k2, v2], ...)` when that pattern is strict equality — it avoids repeating `expr ===`. Prefer `condpOr` / `matchEqOr` when you would otherwise append `?? default`. Use `switch` when narrowing a discriminated union (TypeScript's exhaustive checking catches missing cases). Use a ternary for simple two-branch expressions.

  ```typescript
  // cond: multiple independent conditions → value
  const status = cond(
    [ship.lifecycle === 'destroyed', 'destroyed'],
    [ship.control === 'captured', 'captured'],
    [ship.lifecycle === 'landed', 'landed'],
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

- **PlanningState** is owned by the client composition root (`ctx.planningState` inside `createGameClient()` in `game/client-kernel.ts`), defined in `src/client/game/planning.ts`. It is the client-side "working memory" for the current turn — the uncommitted moves that get sent to the server on confirm. The renderer receives it when constructed via `createRenderer(canvas, planningState)` and reads the same reference each frame to draw previews. `InputHandler` (`createInputHandler()`) does not receive PlanningState — it emits raw spatial events (`InputEvent`), and `interpretInput()` receives PlanningState as a read-only argument to produce `GameCommand[]`.

  Key fields: `burns` (Map of ship → burn direction), `overloads` (Map of ship → overload direction), `queuedAttacks` (buffered combat declarations), `selectedShipId`, `hoverHex`, `combatTargetId`/`combatAttackerIds` (combat planning), `torpedoAccel` (torpedo launch direction). Reset via `createInitialPlanningState()` on phase transitions.

- **GameState** lives on the same client context (`ctx.gameState`). Authoritative updates go through `applyClientGameState()` in `game/game-state-store.ts` (called from the `applyGameState` function inside `createGameClient()` and from injected deps in session/transport code). The composition root dual-writes into `session-signals` mirrors; `attachRendererGameStateMirrorEffect` keeps the canvas aligned with `mirror.gameState` (including `null` on exit). Other modules receive it as function arguments, never as stored references.

### Reactive signals (adopted selectively in UI)

`src/client/reactive.ts` is a small zero-dependency signals library
providing `signal`, `computed`, `effect`, `batch`,
`withScope`, `registerDisposer`, and `createDisposalScope()`.
It is used in the DOM UI layer for view-local state and derived
DOM synchronization.

Use `reactive.ts` for **small, local, stateful DOM views**.
The "Smart Helpers" (`visible`, `text`, `cls`) in `dom.ts`
automatically leverage signals when provided, reducing boilerplate.

Do **not** use it as a general app-state store. The composition
root in `game/client-kernel.ts`, the renderer, the transport/session layer, and
the shared engine should remain explicit and imperative unless
there is a clear synchronization problem being solved.

Rules for reactive UI code:

- **Use implicit scoping.** Wrap UI initialization in `withScope(scope, () => { ... })` so `effect`, `computed`, and `listen` register for cleanup. Keep that block minimal; placing it at the start or end of the factory is fine.
- Own effects explicitly. Any view or manager that creates `computed()` or `effect()` graphs should own a `DisposalScope` and expose `dispose()`.
- Keep derivation pure. Use `computed()` for pure derived values and `effect()` for DOM writes, event-driven side effects, or layout sync hooks.
- Batch related writes. Known trade-off: diamond dependencies can emit intermediate states outside `batch()`. Wrap multi-signal updates in `batch()` when they feed the same computed or effect.
- Avoid hidden identity contracts. If callers may reuse and mutate the same object reference, clone before writing it to a signal or pair it with a version signal.
- Keep the boundary local. Prefer signals inside a view over passing signals through the whole client graph.
- Register teardown in one place. Timers, event listeners, and child-view disposal should be owned by the same scope where practical.

The current pattern is intentionally narrow: pure functions
still derive most game-facing state, while reactive signals
handle repetitive DOM synchronization and lifecycle cleanup in
the overlay layer.

For background on fine-grained reactivity, see Solid's
[Fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
write-up and Preact's
[Signals guide](https://preactjs.com/guide/v10/signals/).

### Dependency injection

Client game modules use two patterns depending on purity.
For the underlying ideas, see Martin Fowler on
[Dependency Injection](https://martinfowler.com/articles/injection.html)
and Mark Seemann on
[Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/):

- **Pure functions** take only what they need as direct parameters (or a small options object when the API is naturally grouped). These are the `derive*`, `build*`, `resolve*`, `get*` functions in `game/helpers.ts`, `game/keyboard.ts`, `game/navigation.ts`, `game/burn.ts`, `game/combat.ts`, `game/messages.ts`, etc. They return values and have no side effects. Canvas drawing modules are pure at the function level but often take one typed input object for wide draw entry points, matching the options-object guideline in Core Principles.

- **Side-effecting functions** take a `deps` object as their first parameter. The `deps` interface declares the callbacks and state accessors the function needs (e.g. `getGameState()`, `showToast()`, `getTransport()`). This avoids long parameter lists and makes testing easy via mock objects. Examples: `CombatActionDeps`, `AstrogationActionDeps`, `PresentationDeps`, `LocalGameFlowDeps`.

- **Callable getter deps** (`getXxx: () => T`): deps interfaces use getter functions rather than direct value references. This ensures the consumer always reads fresh state, breaks circular init-order dependencies, and makes the call site self-documenting about what varies:

  ```typescript
  interface HudControllerDeps {
    getGameState: () => GameState | null;
    getPlayerId: () => number;
    getPlanningState: () => PlanningState;
    getIsLocalGame: () => boolean;
    ui: UIManager; // stable reference, not a getter
  }
  ```

  Use getters for state that changes over time. Use direct
  references for stable service objects.

- **Managers** use a factory pattern: `createXxx(deps: XxxDeps): XxxManager`. The returned object's methods close over the deps. Examples: `createConnectionManager()`, `createTurnTimerManager()`, `createLocalTransport()`, `createOverlayView()`, `createLobbyView()`, `createHUDChromeView()`, `createGameLogView()`, `createTurnTelemetryTracker()`.

- **Prefer factory managers for new small stateful client
  helpers.** DOM views, telemetry helpers, and similar
  modules should usually follow the same `createXxx()`
  pattern unless a class shape is clearly doing real
  work.

`createGameClient()` in `game/client-kernel.ts` wires deps objects and closures so callbacks always see current context (including forward `let` bindings where constructors need callbacks before all fields exist). `dispatchGameCommand()` in `game/command-router.ts` routes commands to the extracted action functions.

When adding new side-effecting logic, prefer extending an existing `*Deps` interface over adding surface area on the bootstrap return value (`renderer`, `showToast`, `dispose`). Keep pure derivation functions as direct-parameter exports (or a single typed options object when arity is large) — they don't need deps.

When the client needs to decide whether an action is legal or should be shown/enabled, prefer reusing shared rule helpers from `src/shared/engine/` over duplicating lighter-weight UI heuristics. The ordnance HUD and ordnance-phase auto-selection follow this pattern: the client derives button visibility/disabled state and default selection from the same validation helpers the engine uses.

### Library adoption policy

- **Required:** default to no new runtime library unless the proposal clears the criteria below.
- **Recommended:** bias toward explicit ownership and small local abstractions first.

Default to no new runtime library. Add one only if it does
at least one of these clearly:

- removes a real security risk
- removes a repeated maintenance burden the current code is
  already paying
- simplifies a broad class of code without hiding control
  flow or ownership

Current stance:

- **Good candidate when needed**: `DOMPurify` for any
  future user-controlled or external HTML.
- **Reasonable later if schemas grow**: `Valibot` or `Zod`
  for protocol/event schema ownership.
- **Do not add by default**: React, Vue, Redux, Zustand,
  RxJS, XState, Immer, or rendering frameworks.
- **Do not replace `reactive.ts` just to use a library**:
  switch only if the project decides it no longer wants to
  own that implementation.

New library proposals should explain:

- why the existing code is insufficient
- which files/modules will simplify
- what bundle/runtime/test costs are introduced
- how the library fits the existing architecture boundaries

### Transport adapter

Network vs. local game branching is handled by `GameTransport` (`src/client/game/transport.ts`), not by `if (isLocalGame)` checks in action handlers:

- `createWebSocketTransport(send)` — wraps a WebSocket send function
- `createLocalTransport(deps)` — dependency-injected local resolution using callbacks

Action handlers call `transport.submitAstrogation(orders)` (transport from context or `*Deps`) instead of branching on game mode. The `isLocalGame` flag may still exist for scheduling (e.g. AI turns) but should not appear in submission logic.

### Async patterns

- **AI turn loop** uses `async/await` with `while` loops, not recursive `setTimeout` callback chains. The 500ms initial delay uses `await new Promise(r => setTimeout(r, 500))`.
- **Promise-wrap callbacks** when an animation or timer needs to be awaited: wrap the callback-based API in a `new Promise` whose resolver is called from the callback.

### Screen visibility

The `applyScreenVisibility` pattern inside `createUIManager()` is the single choke point for screen toggling. It applies the output of the pure `buildScreenVisibility()` function. This is the one place where direct `.style.display` assignment is acceptable — everywhere else, use `show()`/`hide()`/`visible()` from `dom.ts`.

## Linting

**Required:** treat Biome and typecheck failures as blockers for merge.

Biome enforces the following as errors (not just warnings):

| Rule               | What it enforces                                                    |
| ------------------ | ------------------------------------------------------------------- |
| `useConst`         | Immutable bindings where possible                                   |
| `noVar`            | No `var` declarations                                               |
| `noDoubleEquals`   | Strict equality only                                                |
| `useArrowFunction` | Arrow functions over function expressions                           |
| `noForEach`        | Prefer `for...of` over `.forEach()` on arrays (see Practical Style) |
| `useFlatMap`       | `.flatMap()` instead of `.map().flat()`                             |
| `noUnusedImports`  | Clean imports                                                       |

Additional enforced rules include `noExplicitAny`, `noUnusedVariables`,
`useTemplate`, `noNonNullAssertion`, and others — see `biome.json` for the full
set.

The repository currently treats core lint rules as strict errors for active
project code. The exceptions are explicitly configured in `biome.json` (for
example the server override for Cloudflare globals) and should be documented
there rather than assumed in prose.

**CI and hooks:** `.github/workflows/ci.yml` runs `npm run lint` and
`npm run typecheck:all`. The Husky pre-commit hook runs the same lint and
typecheck commands (plus tests and simulation). `npm run verify` includes lint,
`typecheck:all`, coverage, build, e2e, and simulation.

Type checking is split intentionally:

- `tsconfig.json` checks application code under `src/`.
- `tsconfig.tools.json` checks tooling and test harness code (`scripts/`,
  `e2e/`, and root `*.ts` config files) with Node types enabled.
- Use `npm run typecheck` for application code only; use `npm run typecheck:all`
  before pushing or rely on CI / pre-commit / `verify`.

The server directory (`src/server/`) has `noUndeclaredVariables` disabled because Cloudflare Workers globals (like `WebSocketPair`) are not recognized by biome.

## Formatting

- **Recommended:** follow these defaults for readability; prefer consistency over rigid rule-lawyering.

- **Line width**: keep lines under 80 characters where practical. Break long lines at natural points (after commas, before operators, at arrow functions). Some lines will be longer — that's fine if breaking them would hurt readability.
- **Generous whitespace**: add blank lines to keep code airy and scannable. Prefer slightly more vertical space than the minimum when it helps you (or a reader) scan structure quickly. Specifically:
  - Between methods on the same object or class
  - Between top-level declarations (functions, consts, types, interfaces)
  - After import blocks before the first declaration
  - After the opening `{` of a function body and before a large `switch` or the first substantial statement, when it separates the “header” from the logic
  - Before and after loops (`for`, `while`)
  - Before `if` statements (but not before `else if` in a chain)
  - After the closing `}` of an `if`/`else` chain when more code follows
  - Before and after groups of related `const`/`let` declarations when they form a logical block (but not between every individual binding in a tight group)
  - Before `return` statements that follow logic
  - Between distinct logical steps within a function (e.g. after building a `const` object literal before the next branch or return)
  - Biome collapses consecutive blank lines to one — use a single well-placed blank between sections rather than stacking empty lines
- **Long signatures**: prefer a single typed options object when you reach about five or more parameters (see Core Principles). For shorter positional signatures, put each parameter on its own line when the line exceeds ~80 characters.
- **Long objects/arrays**: put each property or element on its own line.
- **Long conditionals**: break `if` conditions and ternaries across multiple lines.
- **Chained methods**: put each `.method()` on its own line for long chains (map/filter/reduce etc.).

## Practical Style

- **Recommended** defaults for day-to-day authoring.

- Use descriptive names over abbreviations unless the abbreviation is already standard in the codebase.
- Add comments sparingly and only where they explain non-obvious intent.
- Prefer direct control flow over abstract indirection.
- Keep public-facing behavior changes accompanied by tests or a clear rationale when tests are not practical.
- **Prefer `for...of`** over `.forEach()` on arrays when you own the loop body — Biome enables `noForEach`, but it does not flag every `.forEach` call; stay consistent with `for...of` for new code. When you need the index, use `for (const [i, item] of arr.entries())`.
- **Avoid `.map().filter(x => x != null)`** — use `filterMap()` from `src/shared/util.ts` for a single-pass transform-and-discard.
- **Prefer `byId()`** over `document.getElementById()!` — it throws on missing elements with a clear error message and avoids non-null assertions.
