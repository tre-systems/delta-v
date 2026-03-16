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

- `src/server/game-do.ts`
- `src/client/main.ts`
- `src/client/renderer.ts`
- `src/client/input.ts`
- `src/client/ui.ts`

These files coordinate long-lived state, timers, DOM, canvas, sockets, or platform APIs. That is a legitimate use of classes in this project.

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

## Practical Style

- Use descriptive names over abbreviations unless the abbreviation is already standard in the codebase.
- Add comments sparingly and only where they explain non-obvious intent.
- Prefer direct control flow over abstract indirection.
- Keep public-facing behavior changes accompanied by tests or a clear rationale when tests are not practical.
