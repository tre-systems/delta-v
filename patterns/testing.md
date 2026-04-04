# Testing

Patterns governing test organization, generation strategies, fixtures, mocking, and coverage enforcement. The coding standards doc covers general test conventions; this document captures project-specific test infrastructure, fixture formats, and known gaps.

## Co-Located Tests (51)

Key files: `vitest.config.ts`, all `*.test.ts` files throughout `src/`

Every test file sits next to its production module as `<module>.test.ts`. Property-based tests use `<module>.property.test.ts`. Vitest discovers via `include: ['src/**/*.test.ts']`. The `e2e/` directory is excluded from the main test glob for separate runner configuration.

No test barrel files (`index.test.ts`), no `__tests__/` directories. `__fixtures__/` directories contain data files only and sit inside the module tree near consuming tests.

Coverage gaps are visible by scanning directories for `.ts` files without a `.test.ts` sibling. Some renderer and UI modules lack tests.

## Property-Based Testing (52)

Key files: `src/shared/hex.property.test.ts`, `src/shared/combat.property.test.ts`, `src/shared/movement.property.test.ts`, `src/client/reactive.test.ts`

Uses `fast-check` with custom domain-specific arbitraries:
- `arbCoord()`: hex coordinates bounded to `[-50, 50]` to avoid overflow
- `arbShipType()`: drawn from actual `SHIP_STATS` keys
- `arbOddsRatio()`: drawn from the fixed odds ratio set

Properties tested include: hex distance metric axioms (symmetry, triangle inequality, non-negativity), hex key serialization roundtrip, combat odds monotonicity, damage severity monotonicity, destroyed/disabled/landed/surrendered/captured ships cannot attack, fuel non-negativity, course path connectivity, drift velocity preservation, reactive signal glitch-freedom.

Integration-heavy properties use `{ numRuns: 50 }` to stay fast. All suites use `fc.assert(fc.property(...))` consistently. No custom shrinkers -- relies on fast-check's automatic shrinking.

Missing property suites: ordnance launch validity, logistics transfer constraints. These would benefit from invariant checking but do not currently have property tests.

## Data-Driven Tests (53)

Key files: `src/shared/protocol.test.ts`, `src/client/game/transport.test.ts`

Two forms of `it.each`:
- **Simple value arrays**: `it.each(['skipOrdnance', 'beginCombat', ...] as const)` with `as const` for literal type narrowing
- **Fixture-driven iteration**: loads `__fixtures__/contracts.json` entries

Mainly used for valid-input protocol validation. Invalid-input rejection tests are individual `it` blocks -- consolidating into `it.each` with `[input, expectedError]` tuples could reduce duplication. Uses the simpler array form rather than the tagged-template table format.

## Contract Fixtures (54)

Key files: `src/shared/__fixtures__/contracts.json`, `src/server/game-do/__fixtures__/transport.json`, `src/shared/protocol.test.ts`, `src/server/game-do/game-do.test.ts`

Two fixture files:

**`contracts.json`** (C2S): canonical wire-format payloads paired with expected `Result<C2S>` validation output. Each entry has `raw` and `expected` fields. Loaded via `readFileSync` + `JSON.parse` at test time.

**`transport.json`** (S2C/HTTP): response shapes for `initResponse`, `joinResponse`, `gameStart`, `stateUpdate`, `movementResult`, `combatResult`. Uses `"__STATE__"` sentinel placeholder for `GameState` fields (too large and volatile to snapshot). Protocol test normalisation handles `undefined` to `null` conversion for JSON round-trip fidelity.

Gaps:
- Missing C2S fixtures: `surrender`, `emplaceBase`, `combatSingle` not in `contracts.json`
- No negative (invalid payload) fixtures -- only success cases exist
- Schema evolution: `"__STATE__"` sentinel insulates from `GameState` changes, but envelope field changes require manual fixture updates

## Mock Storage (55)

Key files: `src/server/game-do/archive.test.ts`, `src/server/game-do/game-do.test.ts`, `src/server/game-do/alarm.test.ts`, `src/server/game-do/match-archive.test.ts`, `src/server/game-do/fetch.test.ts`

In-memory `Map<string, unknown>` backing a minimal `DurableObjectStorage`-compatible interface. Cast via `as unknown as DurableObjectStorage`. Each test file defines its own factory -- no shared mock module.

Two variants:
- **Simpler** (archive.test.ts): `get(key)`, `put(key, value)` / `put(record)` only
- **Richer** (game-do.test.ts): adds `setAlarm` tracking via `alarmAt` field, array key overloads on `get`

Minor inconsistency: simpler mock returns `Promise<void>` from `put`, richer returns `Promise<boolean>`.

Gap: no shared `test-helpers/mock-storage.ts` module. Extracting one would reduce duplication and ensure consistent API surface. Neither variant implements `list`, `transaction`, or `getAlarm` -- not needed since Delta-V uses simple key-value operations.

`game-do.test.ts` also mocks `cloudflare:workers` via `vi.mock` for the `DurableObject` base class stub.

## Deterministic RNG in Tests (56)

Key files: `src/shared/prng.ts`, `src/shared/prng.test.ts`, `src/shared/combat.property.test.ts`, `src/server/game-do/actions.ts`

`mulberry32(seed)`: fast 32-bit PRNG with full 2^32 period. `deriveActionRng(matchSeed, actionSeq)`: per-action PRNG using Knuth multiplicative hashing (`0x9e3779b9`) so replaying events N..M does not require replaying 1..N-1 first.

Three test usage patterns:
- **Direct injection**: `mulberry32(fixedSeed)` as `rng` parameter
- **Property-based**: `fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true })` wrapped in a closure
- **Snapshot pinning**: first-5-values for seed 42 pinned via `toMatchInlineSnapshot` to catch algorithm changes

PRNG tests cover determinism, value range `[0, 1)`, distribution uniformity (mean near 0.5), collision rate, and cross-seed divergence. No chi-squared or Kolmogorov-Smirnov statistical tests -- adequate for a game PRNG.

Gap: no explicit test verifying `matchSeed` persistence/restoration across DO hibernation (implicitly covered by archive tests).

## Coverage Thresholds (57)

Key files: `vitest.config.ts`

V8 provider with per-path thresholds for `src/shared/**/*.ts` only:

| Metric | Threshold |
|--------|-----------|
| Statements | 84% |
| Branches | 75% |
| Functions | 88% |
| Lines | 85% |

Branch threshold is intentionally lower (defensive branches and edge cases in complex game rules are harder to exercise).

Reports: `text` (console), `html` (browsable), `json-summary` (CI). Test files excluded from measurement.

Missing thresholds:
- `src/server/game-do/**/*.ts` -- has substantial test coverage but no enforced floor
- `src/client/**/*.ts` -- selective thresholds for well-tested client hotspots could be added
- No automated ratchet tool to update thresholds to current coverage levels

## Cross-Pattern Notes

The testing patterns reinforce each other: property-based tests (52) with deterministic RNG (56) drive high coverage numbers enforced by thresholds (57). Contract fixtures (54) feed data-driven tests (53) exercising the protocol validators. Mock storage (55) enables unit testing of the full event-sourced persistence layer without Cloudflare runtime. The main consolidation opportunity is extracting a shared mock storage module and adding negative contract fixtures.
