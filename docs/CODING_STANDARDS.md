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

Files under `src/shared/` should remain primarily:

- pure functions
- plain typed data
- deterministic transformations
- easy to test in isolation

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

## Practical Style

- Use descriptive names over abbreviations unless the abbreviation is already standard in the codebase.
- Add comments sparingly and only where they explain non-obvious intent.
- Prefer direct control flow over abstract indirection.
- Keep public-facing behavior changes accompanied by tests or a clear rationale when tests are not practical.
