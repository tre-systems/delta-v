# Delta-V Pattern Catalogue

Consolidated design patterns used throughout the Delta-V codebase. Each document complements the main docs ([ARCHITECTURE.md](../docs/ARCHITECTURE.md), [CODING_STANDARDS.md](../docs/CODING_STANDARDS.md)) with gap analyses, consistency findings, and implementation notes not covered there.

| Document | Scope |
|----------|-------|
| [Engine & Architecture](engine-and-architecture.md) | Event sourcing, CQRS, layered boundaries, engine purity, deterministic RNG, derive/plan, pipelines |
| [Client](client.md) | Input pipeline, state machines, reactive signals, DOM helpers, rendering, animation, disposal |
| [Protocol & Persistence](protocol-and-persistence.md) | Event streams, checkpoints, parity checks, WebSocket protocol, viewer filtering, hibernation |
| [Type System & Validation](type-system-and-validation.md) | Branded types, multi-stage validation, error codes, rate limiting |
| [Testing](testing.md) | Co-located tests, property-based testing, fixtures, mock storage, coverage thresholds |
| [Scenarios & Config](scenarios-and-config.md) | AI strategy scoring, scenario rules, config-driven scenarios, data-driven maps |
