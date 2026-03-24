# ADR 0004: Internationalization (i18n) scope

## Context

User-visible copy is embedded in English throughout `src/client/ui`, `src/client/game`, toasts, and server error strings.

## Decision

**English-only** product surface for the current phase. No message catalogs, locales, or RTL work until product prioritizes localization.

## Consequences

- New UI strings can remain **inline**; if localization is later required, plan a **string extraction** pass and a small i18n layer (library choice deferred).
- Scenario names and rules in [SPEC.md](../SPEC.md) remain the canonical English rules reference.
