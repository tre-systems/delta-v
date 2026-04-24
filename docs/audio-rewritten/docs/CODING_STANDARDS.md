# Delta-V Coding Standards

The conventions that fit this codebase today. The rules and prefixes and formatting live here; the reasoning behind them lives in the pattern catalogue.

Each item is tagged as one of three levels. Required means expected for new code and refactors unless explicitly waived. Recommended means the preferred default, with room to deviate for readability, correctness, or platform constraints. Reference means background context for alignment across modules.

## Core Principles

- Required: keep docs aligned with the actual implementation.
- Prefer readability over cleverness.
- Prefer a single typed options object for any API with about five or more parameters, especially public renderer and UI helpers.
- Prefer small, testable extractions over large architectural rewrites.
- Keep the shared rules engine functional and data-oriented.
- Default to functions and factory managers. Use classes only at imperative boundaries where long-lived mutable state is natural or the platform requires it.

## Project Shape

### Shared engine

Required for engine and rules code: side-effect-free, meaning no input or output — no DOM, no network, no storage. Use plain typed data, testable in isolation.

Turn-resolution entry points deep-clone their input state and require a mandatory random-number-generator parameter. The full walkthrough is in the engine and architecture pattern document, under the sections on the side-effect-free shared engine and on deterministic RNG via per-match seed.

Avoid pushing browser, network, storage, or rendering concerns into the shared module.

### Imperative boundaries

Default to plain functions, typed data, and factory managers using the create-something naming shape. The walkthrough is in the engine and architecture pattern document, under composition root for client construction.

There is one required class: the game Durable Object must extend the Cloudflare Durable Object base class. That is a platform requirement, not a stylistic choice.

Everything else uses the create-something factory shape: the game client factory, the input handler factory, the UI manager factory, the renderer factory, the camera factory, the bot client factory, and so on. Returned types are usually derived from the factory function using the return-type utility rather than declared separately.

Guidance follows. If an imperative boundary binds DOM events, window events, or other long-lived event listeners, own explicit teardown via a dispose method or equivalent returned disposers. Prefer create-something factories for new client modules — do not add a class unless the platform requires it or a rare case genuinely needs instance-of checking. Do not extract one-use adapter factories or wrapper modules that only rename callbacks, repackage a dependency bag, or relay to a single call site — keep that wiring inline unless the helper owns real state, lifecycle, policy, or reuse. Do not extract a generic factory just to build trivial object literals — a helper that produces a send call with a fixed message type and a payload builder adds no type safety over the inline literal and hides the wire shape from readers. Write one literal per concrete case; the repetition documents intent. For method-reference forwarding, when a dependency-bag field exposes a stable function from an inner object, write the reference directly — wrapping it in an identity arrow adds nothing and clutters the adapter. And when the client kernel grows, extract responsibilities into game-helper modules first rather than inflating the kernel with unrelated logic.

### DOM helpers

A dedicated DOM helper module provides declarative DOM construction. The element helper creates an element with class, text, handlers, and children in one expression. The visibility helper accepts a boolean or a reactive signal and creates an effect in the active scope for signals. The text helper and class-toggle helper similarly accept either static values or signals. There is also a typed get-by-ID helper that throws on missing elements, a listen helper that registers for auto-cleanup in the active scope, and a render-list helper that clears and re-renders a list.

All writes of raw HTML go through two dedicated helpers — one for trusted HTML and one for clearing HTML — enforced by a pre-commit grep check. If user-controlled HTML ever enters the client, add a sanitizer such as DOMPurify inside the trusted-HTML helper. For plain text use the text-content property or the element helper's text prop. Background reading is the OWASP cross-site-scripting prevention cheat sheet and its DOM cross-site-scripting companion.

### State ownership

There are two key state objects.

Planning state is owned by the game client factory, lives in the planning module under the client game folder, and serves as short-lived working memory for the current turn. The renderer reads it by reference; the input pipeline receives it read-only. The walkthrough is in the client pattern document, under the planning store for ephemeral turn state.

Game state receives authoritative updates through a single apply function in the game-state-store module. Other modules receive it as function arguments and never store references to it. The walkthrough is in the client pattern document, under session model as aggregate root.

## Refactoring Guidance

Recommended by default; apply judgment per module.

- Extract pure helper modules before introducing new patterns or libraries.
- Reduce duplication first. Do not split files only to satisfy a size target.
- Prefer inlining single-call-site wrappers when the extracted helper adds no policy, validation, or durable state.
- Do not introduce tiny intra-file helper functions or one-entry lookup tables that only merge defaults, rename booleans, or wrap a single branch of the caller. Keep those expressions local unless the helper captures a reused domain rule.
- Keep orchestrators focused on coordination, not business logic.
- When a file grows large, split by real responsibility boundaries.
- When a stable public entry point grows too large, keep the entry file thin and re-export narrower domain modules.

### Size heuristics (not hard rules)

Pure helpers are usually five to twenty-five lines. Coordinator methods can be longer if the flow is linear. Files under two hundred lines are nice when natural. Files above five hundred lines should be reviewed for extraction. Files above a thousand lines are usually overdue for decomposition.

The thousand-line threshold applies less strictly to imperative boundary orchestrators — the client kernel, the renderer, and the game Durable Object — that coordinate many subsystems. For those, focus on whether responsibilities are clearly separated and helper logic has been extracted.

## Testing

Required: co-location, engine coverage discipline, replay and projection parity safety. Recommended: data-driven tests and property-based tests.

- Co-locate unit tests next to source files with a dot-test suffix. Property tests use a dot-property dot-test suffix. Fixture data lives in a fixtures subdirectory near its consumers.
- Keep rules-heavy logic covered with direct unit tests. Extract pure helpers from coordinators and test them.
- Keep end-to-end browser tests focused on browser-only contracts such as boot, multi-page join, reconnect, chat, and storage and session recovery. Gameplay rules and scenario combinatorics go to Vitest and simulation.
- Use data-driven tests — Vitest's parameterised it-each form — for tables, mappings, and input-output pairs.
- Use property-based tests with the fast-check library for invariants on core engine functions. Co-locate them with the dot-property dot-test suffix.
- Coverage thresholds on the engine, server, Model Context Protocol adapter, and client code are enforced. Continuous integration and the full local verify gate run the coverage target.
- Replay and projection: changes to the event projector, archive persistence, or engine state shape must keep parity tests green and extend them when adding new persisted event types.

The detail on fixtures, mock storage, seeded RNG in tests, and coverage thresholds lives in the testing pattern document.

## Constants and Configuration

Required when values cross layers or affect protocol compatibility. Recommended for readability.

- Avoid magic numbers when the value is shared between client and server.
- Promote shared gameplay or protocol constants into the shared constants module.
- Keep client UI timing aligned with server-enforced timing.

## Documentation

Required: update docs when behavior or architecture decisions materially change.

There is one owner document per topic: rules in the spec, wire contracts in the protocol doc, module layout in the architecture doc, pattern rationale in the patterns folder, conventions here, recurring audits in the review plan, open work in the backlog, and contributor flow in the contributing guide.

- Do not leave roadmap items marked as future once shipped.
- When a decision is referenced from multiple places, add a short anchored subsection to the most relevant doc rather than duplicating prose.

---

## Common Patterns

Pattern rationale — with examples and tradeoffs — lives in the patterns folder. This section lists the conventions that new code should follow.

### Discriminated unions

Client variants use the field named "kind" as the discriminator — for example, game commands, keyboard actions, burn-change plans, local resolutions, and AI action plans. Network messages use the field named "type" as the discriminator for client-to-server and server-to-client shapes in the protocol types module.

Always handle every variant in a switch statement — TypeScript's exhaustive checking catches missing cases.

### Derive and plan — functional core, imperative shell

Name pure functions with the prefixes derive, build, or resolve. They return a data object, a plan. A separate apply or set-state call performs the side effect. The reference talk is Gary Bernhardt's "Boundaries"; the walkthrough is in the client pattern document.

### Single choke points

High-risk side effects have one owner each. The dispatch-game-command function handles client command routing. The apply-client-state-transition function handles client state-entry effects. The apply-client-game-state function handles authoritative state application. The apply-UI-visibility function handles top-level screen toggling via the UI manager. The run-publication-pipeline function handles server event append, checkpoint, parity, archive, timer, and broadcast.

Do not route the same mutation through multiple call sites. The walkthrough is in the engine and architecture pattern document, under single choke points for side effects.

### Contract fixtures

When a shape must stay stable across modules or over time, add fixture-style tests for validated client-to-server messages, state-bearing server-to-client messages, and replay payloads. Detail is in the testing pattern document.

### Guard validation — null-or-error helpers

Internal validation helpers return null on success or an error object on failure. The pattern is: a validate-phase-action helper checks whether the state is in the required phase, returning a shaped engine error when not, or null when fine. Callers invoke the helper, check for truthiness, and return early with the error. All validation happens before any mutations — fail fast on known-bad state, then proceed with known-good state.

### Error returns

There are two conventions for success-or-error returns.

Engine results use a union of a success shape and an error shape. Engine entry points use this style. The caller narrows by checking whether the result contains an error field — for example, running astrogation processing against a state and returning an error outcome when the result has an error, otherwise continuing with the state, movements, and other success fields.

The generic result type from the domain module wraps either a typed value or an error. Validators, parsers, and any code returning a typed value or an error use this style. The caller narrows by checking the ok field — for example, a validate-client-message call returns a result whose success branch contains a typed client-to-server payload.

Use the engine style for game logic with heterogeneous success shapes. Use the generic result type for parse and validate operations. The walkthrough is in the type system and validation pattern document.

### Event accumulation

Engine functions collect engine events in a local array and return them alongside the result state. Events are never emitted as side effects — they accumulate and travel with the return value.

A typical pattern is: start an empty engine-events array, push a ship-moved event after resolving movement, push a ship-crashed event if the course ended in a crash, fold in sub-results by spreading their events into the parent array, and finally return the new state alongside the accumulated events.

Turn-resolution entry points — astrogation processor, combat processor, ordnance processor, skip-ordnance, logistics processor, skip-logistics, surrender processor, emplacement processor, fleet-ready processor, begin-combat-phase, and skip-combat — all return engine events. Helpers such as game creation and filter-state-for-player do not. The server reads the events directly from the result — there is no server-side event derivation.

### Data-driven lookup tables

Prefer declarative record tables and indexed arrays over chains of if statements or switch trees for game data such as ship stats, damage tables, ordnance mass, and detection ranges. Add new dimensions as new records in the constants module rather than encoding them into function logic.

As examples, ship stats live as a record mapping a ship-kind string to an object of combat, fuel, and cargo values — transport versus corvette, and so on. The gun-combat table is a two-dimensional indexed array: outer index is the modified die-roll bucket, inner index selects the result column.

The background reference is Steve McConnell's "Code Complete," chapter eighteen, on table-driven methods.

### Composable configuration objects

When behavior varies by mode — difficulty, scenario — separate scoring and decision logic from tuning weights. Define a config type and pass it to pure scoring functions. The walkthrough is in the scenarios and config pattern document, under AI config as weights not code.

### Scenario rules as feature flags

The scenario rules object controls behavior variation across scenarios. Defaults are permissive — omitting a field enables the feature. The engine and client UI derive from the same rule helpers to avoid drift. The walkthrough is in the scenarios and config pattern document, under scenario rules as feature flags.

### String-key serialization for Map lookups

JavaScript's Map and Set types use reference equality, so coordinate-style value objects need string serialization. Define a hex-key function that serializes a hex coordinate to a comma-joined string of its Q and R components, typed as a branded key, and a parse-hex-key function that reverses it. Maps and sets then key on the serialized form. At serialization boundaries, use an as-hex-key helper to brand an externally-provided string.

Use the same pattern for any value-object key: define a key function and, if needed, a parse function. Hex-coordinate background is Red Blob Games' hexagonal grids reference.

### Reactive signals — UI layer

The reactive module provides signals, computed values, effects, batching, scope, a register-disposer helper, and a create-disposal-scope factory. These are used selectively in the DOM UI layer and for durable session and UI state — not as a global store.

Rules:

- Use implicit scoping. Wrap UI initialization in a with-scope call so that effects, computed values, and listeners auto-register.
- Own effects explicitly. Any view or manager that creates computed or effect graphs owns a disposal scope and exposes a dispose method.
- Keep derivation pure. Use computed for derived values, and effect for DOM writes and other side effects.
- Batch related writes. Wrap multi-signal updates in a batch when they feed the same computed or effect.
- Clone before storing a shared object reference in a signal, or pair it with a version signal.
- Keep signals local to the view they serve. Do not thread signals through the whole client graph.
- Separate durable UI state — waiting, reconnect, game-over, replay, timer — from one-shot events such as toasts, sounds, and user commands.

Background reading is Solid's fine-grained reactivity guide and Preact's signals guide.

### Dependency injection

Pure functions take direct parameters or a small typed options object. Side-effecting functions take a dependencies object as their first parameter — combat action deps, astrogation action deps, presentation deps, local game flow deps, and so on. Callable getter dependencies — functions of the shape "get something returning type T" — ensure consumers always read fresh state and break circular initialization-order dependencies. Use direct references for stable service objects.

Managers use the factory pattern: a create-something function takes a dependencies object and returns a manager. The returned methods close over the dependencies.

When adding new side-effecting logic, prefer extending an existing dependencies interface over widening the bootstrap return value. When the client decides whether an action is legal or visible, reuse shared rule helpers from the shared engine rather than duplicating UI heuristics.

Background reading is Martin Fowler on dependency injection and Mark Seemann on composition root.

### Transport adapter

Network versus local game branching is hidden by the game transport interface, defined in the client game transport module. Action handlers call methods on the transport — for example, submit astrogation — instead of branching on whether the game is local. The local-game flag may still appear in scheduling logic for AI-turn timing but should not appear in submission logic.

### Async patterns

The AI turn loop uses async-await with a while loop, not recursive set-timeout chains. The five-hundred-millisecond initial delay is awaited via a promise wrapping a set-timeout. Wrap callbacks in promises when an animation or timer needs to be awaited.

### Screen visibility

The screen-mode signal and apply-UI-visibility function inside the UI manager factory form the single choke point for screen toggling, applying the output of a pure build-screen-visibility function. This is the one place where direct style-display assignment is acceptable. Everywhere else, use the show, hide, and visible helpers from the DOM helper module.

### Library adoption

Default to no new runtime library. Add one only if it clearly does one of: removes a real security risk, removes a repeated maintenance burden already being paid, or simplifies a broad class of code without hiding control flow or ownership.

Current stance: a sanitizer library such as DOMPurify is a good candidate if user-controlled or external HTML ever enters the client. A schema validation library such as Valibot or Zod is reasonable later if protocol and event schemas grow complex. Do not add React, Vue, Redux, Zustand, RxJS, XState, Immer, or rendering frameworks by default. Do not replace the reactive module just to use a library — switch only if ownership of reactive internals is no longer wanted.

New library proposals should explain why existing code is insufficient, which modules would simplify, what bundle, runtime, and test costs are introduced, and how the library fits the existing architecture boundaries.

---

## Naming Conventions

### Files, functions, types

Files use kebab-case, such as game-engine, combat-actions, or phase-entry. Functions use camelCase, such as process-astrogation or derive-phase-transition. Types and interfaces use PascalCase, such as game-state, ship, or combat-action-deps.

Use the type keyword by default for aliases, unions, intersections, and most local object shapes. Use the interface keyword only when extensibility matters — especially for exported object contracts that may be extended or declaration-merged. Never force interface for unions; keep discriminated unions as type.

### Function prefix conventions

The codebase uses consistent prefixes to signal what a function does and whether it has side effects.

Derive functions compute a view or plan from state with no side effects — derive-HUD-view-model, derive-phase-transition. Build functions construct a complex object, also with no side effects — build-astrogation-orders, build-ship-tooltip-HTML. Resolve functions interpret input and produce a structured result, again with no side effects — resolve-AI-plan, resolve-base-emplacement-plan.

Process functions apply game logic and return new state, cloning their input on entry — process-astrogation, process-combat. Create functions construct a new instance or manager — create-game, create-connection-manager.

Check functions detect a condition and may sometimes mutate state — check-ramming, check-game-end. Apply functions apply a transformation to state and always have side effects — apply-client-game-state, apply-damage. Get functions retrieve or look up values with no side effects — get-tooltip-ship, get-next-selected-ship. Predicate functions beginning with "is" or "has" return booleans with no side effects — is-game-over, has-line-of-sight.

On the client side: present functions show a result or outcome to the user — present-movement-result, present-combat-results. Show functions display a UI element or feedback — show-game-over-outcome, show-toast. Render functions paint the canvas or build and update the DOM — render-hex-grid, render-transfer-panel. Draw functions paint canvas overlays, icons, trails, or toasts — draw-ships-layer, draw-minimap-overlay.

Event and sequence functions: handle functions react to an event or message — handle-local-resolution, handle-message. Play functions trigger an animation or sequence — play-local-movement-result, play-sound. Move functions relocate an entity in game state — move-ordnance, move-ship. Queue functions schedule a future action or event — queue-asteroid-hazards, queue-attack.

### Type patterns

The codebase organizes types into bounded modules: the domain types module for state, ships, and phases; the protocol types module for client-to-server and server-to-client messages; and the scenario types module for scenarios and rules. A barrel module re-exports all three. Import from the specific module only when emphasizing a boundary.

Use Pick with a type and a set of keys for narrow function signatures — when a helper only needs a few fields of a large interface, Pick makes it easier to test and clearer in intent.

Entities with complex state use small string-literal unions rather than multiple booleans. For example, a ship's lifecycle is one of active, landed, or destroyed; its control status is one of own, captured, or surrendered.

Derive the public type of a factory from its return type rather than declaring a separate interface. This keeps the type in sync with the implementation automatically.

---

## Functional Style

The shared engine is data-oriented. Lean into functional patterns.

Prefer the shared utility helpers over handwritten loops when they clarify intent. The utility module provides a suite of helpers. Sum-by reduces an array to a sum by applying a function to each item. Min-by and max-by pick the item minimizing or maximizing a selector. Count returns the number of items satisfying a predicate without allocating a filtered array. Index-by turns an array into a map keyed by a selector. Group-by builds a record from a key function. Partition splits an array into two by a predicate. Compact removes nulls with narrowing. Filter-map transforms and discards nulls in one pass. Unique-by deduplicates by a selector. Pick-by and map-values operate on object entries. A conditional dispatcher called cond chains predicate-value pairs. Pattern-match helpers called condp and match-eq, with default-taking variants condp-or and match-eq-or, dispatch against successive values or by strict equality. Clamp keeps a number in a range. Random-choice picks an element using an injected RNG.

Next, choosing between conditional dispatch forms. Use cond for multiple independent boolean conditions. Use the predicate-dispatch form when comparing a single predicate against successive values. Use the strict-equality dispatch form for equality dispatch; its default-taking variants avoid a trailing null-coalescing. Use a switch statement for discriminated-union narrowing, where TypeScript's exhaustive check catches misses. Use a ternary for simple two-branch expressions.

Beyond that:

- Prefer expressions over statements. Filter then map is clearer than a loop pushing to an array.
- Avoid mutable accumulators when a helper already captures the pattern.
- Prefer filter-map over separate map and filter calls when transforming and discarding nulls.
- Prefer the count helper over filtering and reading the length — it avoids allocating an intermediate array.
- Build lookup structures declaratively — for example, index orders by ship identifier — rather than with manual loops.
- Do not force it. Imperative code is fine for inherently stateful logic such as tracking previous iteration, complex early-exit conditions, or canvas drawing.
- Prefer arrow functions over function declarations.

---

## Linting

Required: treat linter and type-checker failures as blockers.

The Biome linter enforces a range of rules as errors rather than warnings, including: use-const, no-var, no-double-equals, use-arrow-function, no-for-each, use-flat-map, no-unused-imports, no-explicit-any, no-unused-variables, use-template, no-non-null-assertion, and others. See the Biome configuration file for the full set. Exceptions for specific environments — for example Cloudflare globals in the server module — are configured in the Biome config rather than assumed in prose.

Continuous integration and Git hooks both run the pipeline. The CI workflow runs lint, typecheck, coverage, build, browser smoke, accessibility, simulation, and deploy validation. Husky splits the local gate: pre-commit runs lint, boundary checks, and the all-inclusive typecheck, while pre-push runs lint, boundary checks, the all-inclusive typecheck, build, and an impacted simulation smoke when AI, engine, or scenario files changed. The verify script, or setting the full-pre-push environment variable on a git push, runs the exhaustive local release sweep.

Type checking is split intentionally. The main TypeScript config checks application code. The tools TypeScript config checks tooling — scripts, end-to-end tests, and root config files. Use the app-code typecheck command for application code and the all-inclusive typecheck command before pushing.

---

## Formatting

Recommended: consistency over rigid rule-lawyering.

- Keep line width under eighty characters where practical. Break at natural points such as commas, operators, and arrow functions. Some lines will be longer — that is fine if breaking hurts readability.
- Use generous whitespace — blank lines between methods, top-level declarations, after import blocks, around loops, before return statements following logic, and between distinct logical steps. The linter collapses consecutive blank lines to one.
- For long function signatures, prefer a single typed options object at roughly five or more parameters. Otherwise put each parameter on its own line when the line exceeds roughly eighty characters.
- For long object or array literals, put one property or element per line.
- Break long conditional expressions and ternaries across lines.
- For long method chains, put one method call per line.

---

## Practical Style

Recommended defaults for day-to-day authoring.

- Use descriptive names over abbreviations unless the abbreviation is standard.
- Use comments sparingly — only where they explain non-obvious intent. Use double-slash line comments; avoid slash-star-star JSDoc blocks. Types are self-documenting, so prefer accurate type names over doc comments on fields.
- Prefer direct control flow over abstract indirection.
- Accompany behavior changes with tests, or provide a clear rationale where tests are not practical.
- Use for-of loops over forEach on arrays when you own the body. For index access, use the entries form of for-of.
- Prefer filter-map over separate map and filter calls when discarding nulls.
- Use the typed get-by-ID helper rather than the native get-element-by-ID method — it throws with a clear error and avoids non-null assertions.
