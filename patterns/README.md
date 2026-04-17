# Delta-V Pattern Catalogue

A guided tour of the patterns that hold Delta-V together. Read these when you want to understand *why* the code looks the way it does — not just the rules ([CODING_STANDARDS](../docs/CODING_STANDARDS.md)) or the module inventory ([ARCHITECTURE](../docs/ARCHITECTURE.md)), but the recurring design choices, their tradeoffs, and where the current implementation is still rough.

Each chapter is self-contained. Start wherever the question is.

| Chapter | Answers questions like |
|----------|-----------------------|
| [Engine & Architecture](engine-and-architecture.md) | How does event sourcing work here? Why is the engine side-effect-free? How are layer boundaries enforced? Where does RNG come from? |
| [Client](client.md) | How does input become game state? What state lives where? How does the Canvas renderer stay fast? What replaces a UI framework? |
| [Protocol & Persistence](protocol-and-persistence.md) | How are events stored and replayed? What shape does each WebSocket message take? How does viewer-aware filtering work? How does DO hibernation survive disconnects? |
| [Type System & Validation](type-system-and-validation.md) | What's a branded type? Where does input validation happen? How do error codes travel? How is abuse rate-limited? |
| [Scenarios & Config](scenarios-and-config.md) | How does AI difficulty actually vary? How are scenarios defined declaratively? What are `ScenarioRules` flags? How is the solar-system map built? |
| [Testing](testing.md) | Where do tests live? When do we use property-based tests? How do we mock Durable Objects? What coverage is enforced? |

Each chapter follows the same structure:

1. **What the pattern is** — a short description of the shape.
2. **Where it lives** — file paths to the canonical implementation.
3. **Why it's shaped that way** — the tradeoffs behind the choice.
4. **Known gaps or rough edges** — honest notes on where the pattern isn't fully realized yet.

The gap notes are not a backlog. They are context for reviewers and contributors: if you're touching one of these areas, expect to encounter the rough edge. Actionable follow-ups belong in [BACKLOG.md](../docs/BACKLOG.md).
