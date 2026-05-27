# Coding Standards Guide

A reusable guide for creating coding standards on other projects, based on the
parts of this project that worked well: clear boundaries, deterministic core
logic, explicit side-effect ownership, co-located tests, owner docs, and narrow
reviewable conventions.

The goal of a coding standard is not to describe every taste preference. It is
to make code easier to change safely. Good standards tell contributors what must
stay true, where decisions belong, and how to make local code fit the system
around it.

## What a Coding Standard Should Contain

Every project coding standard should separate policy from preference:

| Section | Purpose |
| --- | --- |
| **Core principles** | The few rules that shape all code. |
| **Project shape** | Main layers, ownership boundaries, and import direction. |
| **Side-effect rules** | Where I/O, mutation, randomness, logging, storage, and network calls are allowed. |
| **State ownership** | Which module owns each durable state object and how others read or mutate it. |
| **API conventions** | Function shape, options objects, return types, errors, validation, and dependency injection. |
| **Testing standards** | Where tests live, what each test layer owns, and what behavior requires tests. |
| **Documentation rules** | Which docs own which topics and when code changes must update docs. |
| **Naming conventions** | File names, type names, function prefixes, and domain vocabulary. |
| **Refactoring guidance** | When to extract, inline, split, or leave code alone. |
| **Library policy** | When new dependencies are justified. |
| **Linting and formatting** | Tool-enforced rules versus human judgment. |
| **Examples** | Small before/after snippets that make the standard concrete. |

Do not mix temporary roadmap items into coding standards. Active work belongs in
an issue tracker or backlog. Standards should describe how new work is expected
to be written.

## Core Principles

Start with a short list. If everything is a principle, nothing is.

Useful defaults:

1. Keep behavior and docs aligned.
2. Prefer clear, boring code over clever code.
3. Keep pure domain logic separate from I/O.
4. Make side effects explicit and owned by a small number of modules.
5. Prefer small testable extractions over broad rewrites.
6. Use the project's existing patterns before introducing new abstractions.
7. Add or update tests for behavior changes.
8. Treat public contracts, persisted data, and external APIs as compatibility
   surfaces.

These principles should be stable enough that they survive framework and
library changes.

## Project Shape and Boundaries

Name the main layers of the system and define what each layer may import or do.
This is one of the highest-leverage parts of a coding standard.

Example layer policy:

| Layer | Allowed | Not allowed |
| --- | --- | --- |
| **Domain/core** | Pure logic, typed data, validation helpers, deterministic calculations | DOM, network, storage, logging, global randomness |
| **Application/server** | Persistence, auth, jobs, API routing, orchestration | UI imports, duplicated domain rules |
| **Client/UI** | Rendering, input, local presentation state, browser APIs | Server-only imports, business rules copied from core |
| **Tooling/scripts** | Build, migration, data repair, verification commands | Runtime-only assumptions without checks |

Add enforcement where practical:

- Import-boundary tests.
- Lint rules.
- Grep checks for banned calls in sensitive directories.
- Type-level boundaries.
- CI jobs that run the relevant checks on every change.

The standard should make it obvious where a new file belongs.

## Functional Core, Imperative Shell

A useful default for complex systems is:

- Put domain decisions in pure functions.
- Put I/O and orchestration at the edges.
- Pass dependencies in rather than importing globals.
- Return structured results rather than mutating hidden state.

Pure code is easier to test, replay, simulate, and reason about. Imperative code
is still necessary, but it should live at clear boundaries: UI controllers,
server handlers, job runners, persistence adapters, and platform integration
points.

Use this pattern especially for:

- Rules engines.
- Price, billing, tax, eligibility, routing, or scheduling logic.
- Protocol parsing and validation.
- State transition logic.
- Any workflow that must be replayed, audited, or tested with many inputs.

## Side-Effect Ownership

Side effects should have owners. If five modules can write the same state,
persist the same record, or emit the same event, drift is likely.

For each side-effecting domain, define the choke point:

| Domain | Choke point example |
| --- | --- |
| Command dispatch | One router that interprets user or API commands |
| State application | One function that applies authoritative state |
| Persistence | One writer for each durable record type |
| Publication | One pipeline that saves, emits, broadcasts, and logs |
| UI visibility | One owner that decides which major screen is visible |
| Error reporting | One reporter that redacts and rate-limits |

The standard should say where direct side effects are acceptable and where they
must go through helpers.

Examples:

- Browser DOM writes go through local DOM helpers.
- Database writes go through repository or service functions.
- Network messages are built from typed message constructors or validators.
- Randomness is injected into deterministic code.
- Logging in core logic is forbidden; callers log structured outcomes.

## State Ownership

Every important state object needs a single owner.

Define:

- Which module creates the state.
- Which module can mutate it.
- Whether other modules receive snapshots, references, getters, or events.
- How state is reset, disposed, restored, or replayed.
- Which state is durable and which is ephemeral.

Good patterns:

- Authoritative state changes through one `apply*` function.
- Short-lived planning or draft state stays near the UI or workflow that owns it.
- Long-lived state is loaded and saved through one persistence boundary.
- Derived values are recomputed from source state instead of stored twice.
- Event-like one-shot notifications are not mixed with durable state.

Avoid storing references to mutable state across layers unless ownership is
explicit.

## APIs and Function Shape

Make function conventions predictable.

Recommended defaults:

- Use direct parameters for small pure functions.
- Use a typed options object when a function has many parameters or several
  optional settings.
- Use a `deps` object for side-effecting modules.
- Use callable getters such as `getCurrentUser()` when a dependency must read
  fresh state.
- Return structured results for expected failures instead of throwing for normal
  validation outcomes.
- Throw only for programmer errors, impossible states, or platform failures that
  cannot be handled locally.

Example:

```typescript
type SendInvoiceDeps = {
  now: () => Date;
  loadCustomer: (id: CustomerId) => Promise<Customer | null>;
  saveInvoice: (invoice: Invoice) => Promise<void>;
  sendEmail: (message: EmailMessage) => Promise<void>;
};

type SendInvoiceResult =
  | { ok: true; invoiceId: InvoiceId }
  | { ok: false; code: 'customer_not_found' | 'invalid_invoice' };
```

This makes dependencies, failure modes, and tests visible.

## Validation and Error Handling

Input validation belongs at boundaries. Domain invariants belong in the domain.
Do not rely on UI checks to protect server or core logic.

Standards to define:

- Which inputs are validated at API, queue, CLI, and UI boundaries.
- Whether validators return `Result<T, E>`, throw, or collect errors.
- How error codes are named and surfaced.
- How much detail is safe to expose to users or clients.
- Which errors should be logged, redacted, retried, or ignored.

Good practice:

- Validate before mutation.
- Keep error shapes stable for public clients.
- Use exhaustive handling for discriminated unions and enums.
- Separate user-correctable errors from system failures.
- Include tests for invalid, oversized, missing, and unknown input.

## Naming Conventions

Naming standards should reveal intent, not satisfy ceremony.

Define:

- File naming: kebab-case, snake_case, or framework default.
- Function naming: verbs that signal behavior.
- Type naming: nouns and domain terms.
- Boolean naming: `is*`, `has*`, `can*`, `should*`.
- Event and message names.
- Whether acronyms are normalized.

Useful function prefixes:

| Prefix | Meaning |
| --- | --- |
| `derive*` | Compute a view or value from existing state |
| `build*` | Construct a complex object |
| `parse*` | Convert untrusted input into typed data |
| `validate*` | Check input or invariants |
| `resolve*` | Decide a result from rules or competing inputs |
| `process*` | Run a domain operation and return a new result |
| `apply*` | Mutate or commit a change |
| `create*` | Construct a service, manager, or value |
| `handle*` | Respond to an event or message |
| `render*` | Update UI output |
| `load*` / `save*` | Read or write persistence |

The exact prefixes matter less than consistency and signal.

## Type and Data Standards

For typed codebases, define how types are used to protect contracts.

Useful rules:

- Prefer discriminated unions for variants.
- Use literal unions instead of loose strings for states and modes.
- Use branded or opaque types for identifiers that should not be mixed.
- Keep protocol types close to validators.
- Use narrow parameter types such as `Pick<T, K>` when helpers need only a few
  fields.
- Derive factory return types from the factory when that keeps implementation
  and public shape in sync.
- Keep serialization boundaries explicit.

For dynamic languages, express the same ideas through schemas, dataclasses,
runtime validators, or clear module contracts.

## Data-Driven Code

Prefer tables and configuration when behavior is naturally data.

Good candidates:

- Role or permission matrices.
- Product or plan limits.
- Feature flags.
- Routing tables.
- Mapping external codes to internal states.
- Scenario, workflow, or rule configuration.

Data-driven code is not a license to hide logic in unreadable JSON. Use it when
the table reads more clearly than nested conditionals, and test the table as
part of the behavior.

## Dependency and Library Policy

New dependencies should earn their place.

Require dependency proposals to answer:

1. What problem does existing code fail to solve well?
2. Which modules get simpler?
3. What runtime, bundle, security, maintenance, and learning costs are added?
4. How is the dependency isolated if it needs to be replaced?
5. Is it used at a boundary where a library is safer than custom code?

Good reasons to add a dependency:

- Security-sensitive parsing or sanitization.
- Standards-compliant protocol handling.
- Complex domain logic that is not a project differentiator.
- Large repeated maintenance burden.

Weak reasons:

- Personal preference.
- Replacing a small local helper.
- Adopting a framework for one isolated screen or script.
- Hiding control flow that reviewers need to understand.

## Testing Standards

Testing standards should say which layer proves which behavior.

Example test ownership:

| Test type | Best for |
| --- | --- |
| Unit tests | Pure logic, edge cases, validation, formatting, small transformations |
| Property-based tests | Invariants across many generated inputs |
| Integration tests | Module boundaries, persistence adapters, API handlers |
| Contract fixtures | Public wire formats, schemas, snapshots, persisted payloads |
| Browser/end-to-end tests | Real browser behavior, storage, navigation, multiple tabs, accessibility baselines |
| Simulation/load tests | Long-running behavior, stochastic systems, queue or throughput risks |
| Manual QA | Sensory checks, nuanced UX, assistive technology, hardware-specific behavior |

Useful rules:

- Co-locate tests with the source when practical.
- Put large fixtures near the tests that consume them.
- Test pure helpers directly instead of only through a large workflow.
- Add regression tests for bugs that escaped review.
- Keep browser tests focused on browser-only contracts.
- Use deterministic randomness in tests.
- Make public contract changes update fixture tests.

The standard should also say what must happen when tests are impractical:
documented rationale, manual verification notes, or a follow-up item.

## Documentation Standards

Define one owner doc per topic.

Examples:

- Architecture and module boundaries.
- Public API and protocol contracts.
- Setup and contributor workflow.
- Security and privacy behavior.
- Operational runbooks.
- Coding standards.
- Review procedures.
- Backlog or active work.

Rules that work well:

- Update docs when behavior, commands, routes, schemas, or operating procedures
  change.
- Link to the owner doc instead of duplicating long explanations.
- Remove or reclassify roadmap text when it ships.
- Keep active work out of stable reference docs.
- Run doc-link checks for documentation changes.

Docs are part of the codebase contract. Treat stale docs as defects.

## Refactoring Standards

Refactoring standards should stop both extremes: endless large files and
premature abstraction.

Good defaults:

- Extract when a helper owns real policy, state, lifecycle, validation, or reuse.
- Inline wrappers that only rename a function or pass through arguments.
- Split files by responsibility, not by arbitrary line count.
- Keep orchestration code linear when the sequence is the important thing.
- Prefer local pure helpers before introducing new frameworks or global patterns.
- Avoid drive-by refactors in unrelated areas.

Useful size heuristics:

- Small pure helpers are often 5-25 lines.
- Files under 200 lines are pleasant when natural.
- Files above 500 lines deserve a responsibility review.
- Files above 1000 lines usually need decomposition unless they are deliberate
  generated code or boundary orchestration.

Heuristics are prompts for judgment, not automatic rewrite orders.

## Linting and Formatting

Make machines enforce what machines can judge.

Good lint targets:

- Unused imports and variables.
- Dangerous equality or coercion.
- Banned globals in sensitive layers.
- Non-null assertions or unchecked casts.
- Inconsistent module syntax.
- Formatting.
- Import order, if the team values it.

Keep human review focused on design, correctness, clarity, and maintainability.

Formatting rules should be boring:

- Pick one formatter.
- Do not argue formatting in review.
- Allow exceptions where generated code or readability requires it.
- Keep line breaks at natural boundaries.

## UI and Frontend Standards

For projects with UI, define standards for both code and experience.

Code standards:

- DOM or framework helpers own unsafe rendering operations.
- User-provided content is rendered as text unless sanitized.
- View state is scoped to the component or workflow that owns it.
- Derived UI state is computed from source state.
- Event listeners and effects have explicit cleanup.
- UI code reuses shared domain rules instead of duplicating them.

Experience standards:

- Keyboard access and focus behavior are part of done.
- Loading, empty, error, disabled, and success states are designed.
- Responsive behavior is verified at named breakpoints.
- Motion and animation respect reduced-motion preferences.
- Components have stable dimensions where layout shift would harm usability.

These standards should be concrete enough that reviewers can apply them.

## Async and Concurrency Standards

Async code needs conventions because failures are often timing-dependent.

Define:

- Cancellation and timeout behavior.
- Retry policy.
- Idempotency rules.
- Queue and job ownership.
- Locking or deduplication rules.
- How background failures are logged and surfaced.
- Whether callbacks should be wrapped in promises for sequencing.

Good practice:

- Prefer `async` / `await` for sequential workflows.
- Avoid recursive timer chains when a loop with delay is clearer.
- Make retries bounded and observable.
- Treat duplicate delivery as normal for queues and webhooks.
- Keep cleanup paths tested.

## Security and Privacy Standards

Do not leave security and privacy as separate documents only. Coding standards
should include the day-to-day rules contributors need.

Examples:

- Validate untrusted input at every boundary.
- Never log secrets, tokens, recovery codes, raw credentials, or unnecessary PII.
- Redact before reporting errors.
- Use platform crypto for tokens and identifiers.
- Keep auth checks server-side.
- Make destructive operations explicit and auditable.
- Prefer deny-by-default permission checks.
- Keep retention and deletion behavior documented.

Link to deeper security and privacy docs for complete policy, but put the common
coding rules where contributors will see them.

## Creating the Standard for a New Project

Use this process:

1. Read the code that already works well.
2. Identify the project's real boundaries and invariants.
3. Write required rules for invariants and recommended rules for style.
4. Add examples from the codebase.
5. Add enforcement for rules that should never rely on memory.
6. Link to deeper rationale or pattern docs instead of making the standard huge.
7. Review the standard after the next few pull requests and remove anything that
   did not help reviewers or contributors.

Good standards are discovered from working code and sharpened by review. Avoid
importing a generic standard wholesale unless the project is also generic.

## Coding Standard Template

Use this as a starting outline:

```markdown
# Coding Standards

## Core Principles

## Project Shape

## Boundaries and Side Effects

## State Ownership

## APIs, Dependencies, and Error Handling

## Naming Conventions

## Type and Data Conventions

## Testing

## Documentation

## Refactoring Guidance

## Dependency Policy

## Linting and Formatting

## Security and Privacy Rules

## Examples and Anti-Patterns
```

Keep the first version short. Add detail only where repeated review comments,
bugs, or onboarding confusion show that the team needs a written rule.
