# Testing Patterns

How the Delta-V test suites are structured and what each layer covers. The coding standards document gives the test conventions around co-location, property tests, and coverage floors. The simulation testing document describes the simulation and load harnesses. This chapter walks through the patterns inside the Vitest suite.

Each section covers the pattern, a minimal example, where it lives, and why this shape.

---

## Co-Located Tests

Every test file sits next to the module it tests, using the same name with a dot-test suffix. There are no separate test folders or test barrels. Property-based tests use an additional dot-property segment in the filename. Contract fixtures live in a fixtures subdirectory near the tests that consume them.

As a concrete example: the shared hex module, its standard tests, and its property-based tests all sit in the same directory, alongside the combat module and its tests, a fixtures folder for contract data, and the protocol module with its tests.

The Vitest configuration globs all test files under the source directory. The end-to-end directory is excluded from the main test runner and handled by Playwright separately.

The rationale for this shape is threefold. First, readers and reviewers see tests together with code — opening the combat module in an editor exposes its test file in the same folder, with no navigation tax. Second, coverage gaps are visible: scanning a directory for source files without a corresponding test file is a mechanical audit. Third, there is no test infrastructure to learn — a new contributor adding a file writes its test next to it, with no discovery step.

---

## Property-Based Tests

Core engine functions have suites built with the fast-check library that verify invariants across generated inputs. Custom domain arbitraries — for coordinates, ship types, and odds ratios — keep inputs realistic and bounded.

As examples: one property asserts that hex distance is symmetric, meaning the distance from point A to point B equals the distance from point B to point A, for all possible coordinate pairs. Another property asserts that higher combat odds never produce worse results than lower odds, comparing outcomes across generated combat scenarios with a bounded number of runs to keep engine-heavy properties fast.

These tests live alongside the modules they exercise — in the shared hex property test file, the combat property test file, the movement property test file, and the client reactive test file. Arbitraries live alongside the modules they exercise.

Next, the rationale. Invariants over examples means a statement like "fuel never goes negative" is true for all inputs, not just the ones the author thought of. When a property fails, fast-check automatically reduces the counterexample to a minimal reproduction. And a roughly twenty-line property test often covers what would take a dozen example tests.

---

## Data-Driven Tests with It-Each

Tables of input-output pairs use Vitest's parameterised test feature instead of N separate test blocks. Combat tables, damage lookups, and hex-math boundaries are natural fits. Using the as-const assertion gives literal type narrowing.

As an example, a single parameterised hex-distance test lists three coordinate pairs alongside their expected distances — including an axial cube diagonal — and runs one assertion against each row.

This pattern lives in the shared protocol test file and the client transport test file.

The benefits: boilerplate shrinks because twenty test bodies collapse into twenty input rows and one assertion. The tests read like a spec. And failure messages are descriptive because the parameter placeholders show the failing row.

---

## Contract Fixtures for Protocol Shapes

Canonical wire-format payloads live as JSON fixtures paired with their expected validator output. Tests iterate fixtures and assert round-trip correctness. Large game-state values use a double-underscore STATE double-underscore sentinel so fixtures stay stable when engine types evolve.

As an example, a contracts fixture file contains two entries: one for a valid astrogation message, with a raw payload and its expected validated output; and one for an empty movement-result message, where the game-state field is replaced with the sentinel string.

These fixtures live in two locations: one for client-to-server messages in the shared module, and one for server-to-client messages and HTTP responses in the server game-do module. They are loaded via synchronous file reads and JSON parsing in the protocol and game-do tests.

With that established, the rationale: the wire format is an API, and representative payloads pinned as JSON catch accidental protocol changes better than purely behavioral tests. The sentinel string insulates fixtures from game-state churn, though envelope changes still require manual fixture updates. Tests also convert undefined values to null to mirror JSON fidelity.

---

## Mock Durable Object Storage

Tests that touch the Durable Object plumbing use an in-memory map that implements enough of the Durable Object storage interface to exercise the code under test. The map is cast through unknown to the Durable Object storage type at the boundary.

The mock provides get, put, and delete operations backed by an in-memory map. Get resolves with the stored value. Put handles both single-key and multi-key record forms. Delete returns whether the key was present. List and transaction are omitted unless a specific test needs them.

This pattern appears in several server-side test files covering archiving, game-do logic, alarms, match archiving, and fetch handling. The game-do test file also mocks the Cloudflare workers module to stub the Durable Object base class.

The benefits: tests skip the Wrangler runtime, making them faster, deterministic, and easier to debug. Each mock implements only the surface area its test needs — list and transaction are not implemented because Delta-V uses simple key-value I/O.

---

## Deterministic RNG in Tests

Tests pin random number generation via seeded pseudo-random number generators. The mulberry32 seeded generator is used for full runs. Short fixed functions — always returning the same value — are used for single-call assertions. Fast-check arbitraries supply random values for property-based runs. No test calls the built-in Math random function.

Three examples illustrate the pattern: a fixed seed produces a fixed sequence, making specific damage values reproducible across runs. A property test lets fast-check supply random doubles in the zero-to-one range. And an algorithm snapshot test captures a sequence of five generated values with an inline snapshot, catching any future changes to the generator.

This lives in the shared pseudo-random number generator module, which provides the mulberry32 function and a derived-action RNG helper. The generator test file covers determinism, value range, uniformity, collision rate, and cross-seed divergence.

Turning to the rationale: making RNG an explicit required parameter on turn-resolution entry points means tests cannot forget to pass one — it is the only viable approach. The derived-action RNG helper means replaying an event range does not require replaying all the history before it.

---

## Coverage Thresholds

V8 coverage thresholds are enforced across the engine, server, Model Context Protocol adapter, and client code. Both the pre-push hook and continuous integration run the coverage target. Thresholds are treated as a ratchet, not a target.

As an example, the Vitest configuration specifies thresholds for the shared engine: eighty-four percent of statements, seventy-five percent of branches, eighty-eight percent of functions, and eighty-five percent of lines. Reports are generated in text, HTML, and JSON summary formats. The configuration lives in the main Vitest config file and in dedicated coverage configs for the client and for the server and shared code. Report output lives under a coverage directory with per-surface subfolders and is gitignored.

The rationale: thresholds prevent backsliding — a refactor that adds untested code fails continuous integration. Per-surface floors mean the engine still carries the strictest numbers, but server and game-do code, the Model Context Protocol adapter, and the client are also ratcheted so refactors cannot silently hollow them out. Running coverage passes sequentially avoids Vitest temporary-file races, so the client and server-shared suites no longer share a single coverage scratch directory. And the branch threshold is intentionally lower than the line threshold, because defensive branches in complex game rules are hard to exercise and forcing a higher branch figure would encourage tests that do not add real confidence.

---

## Replay and Projection Parity

Changes to the event projector, the archive persistence layer, or the engine's state shape must keep the projection parity tests green. The parity verifier compares the Durable Object's live state with the state derived by replaying the persisted event log, and the parity tests must be extended whenever a new persisted event type is added.

---

## Cross-Pattern Reinforcement

The testing patterns reinforce each other.

Property-based tests covering invariants, combined with deterministic RNG for reproducibility, drive high coverage numbers. Coverage thresholds catch any backsliding from changes to property tests. Contract fixtures and data-driven tests exercise the protocol boundary comprehensively. Mock storage enables unit testing of the entire event-sourced persistence layer without the Cloudflare runtime.

To recap, the main consolidation opportunity is a shared mock-storage module plus broader negative contract coverage — both would tighten what is already a mostly solid foundation.
