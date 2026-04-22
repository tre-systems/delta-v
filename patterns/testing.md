# Testing Patterns

How the Delta-V test suites are structured and what each layer covers. [CODING_STANDARDS.md](../docs/CODING_STANDARDS.md) gives the test conventions (co-location, property tests, coverage floors); [SIMULATION_TESTING.md](../docs/SIMULATION_TESTING.md) describes the simulation and load harnesses. This chapter walks through the patterns inside the Vitest suite.

Each section: the pattern, a minimal example, where it lives, and why this shape.

---

## Co-Located Tests

**Pattern.** Every test file sits next to the module it tests as `<module>.test.ts`. No `__tests__/` folders, no test barrels. Property-based tests use the suffix `<module>.property.test.ts`. Contract fixtures live in `__fixtures__/` subdirectories near consuming tests.

**Minimal example.**

```
src/shared/
  hex.ts
  hex.test.ts
  hex.property.test.ts
  combat.ts
  combat.test.ts
  combat.property.test.ts
  __fixtures__/
    contracts.json
  protocol.ts
  protocol.test.ts
```

**Where it lives.** `vitest.config.ts` globs `src/**/*.test.ts`. The `e2e/` directory is excluded from the main test runner and handled by Playwright separately.

**Why this shape.**

- **Readers and reviewers see tests together with code.** Opening `combat.ts` in an editor exposes `combat.test.ts` in the same folder — no navigation tax.
- **Coverage gaps are visible.** Scanning a directory for `.ts` files without a `.test.ts` sibling is a mechanical audit.
- **No test infrastructure to learn.** A new contributor adding a file writes its test next to it; there's no discovery step.

---

## Property-Based Tests

**Pattern.** Core engine functions have `fast-check` suites that verify invariants across generated inputs. Custom domain arbitraries (`arbCoord`, `arbShipType`, `arbOddsRatio`) keep inputs realistic and bounded.

**Minimal example.**

```ts
import fc from 'fast-check';
import { hexDistance, arbCoord } from './hex';

test('hex distance is symmetric', () => {
  fc.assert(fc.property(arbCoord(), arbCoord(), (a, b) => {
    return hexDistance(a, b) === hexDistance(b, a);
  }));
});

test('higher odds never produce worse combat results', () => {
  fc.assert(fc.property(arbCombatScenario(), (scenario) => {
    const low = resolveCombat(scenario, '1:1', rng);
    const high = resolveCombat(scenario, '3:1', rng);
    return expectedDamage(high) >= expectedDamage(low);
  }), { numRuns: 50 });   // bounded for engine-heavy props
});
```

**Where it lives.** `src/shared/hex.property.test.ts`, `combat.property.test.ts`, `movement.property.test.ts`, `client/reactive.test.ts`. Arbitraries live alongside the modules they exercise.

**Why this shape.**

- **Invariants over examples.** "Fuel never goes negative" is true for all inputs, not just the ones the author thought of.
- **Shrinking finds minimal repros.** When a property fails, fast-check reduces the counterexample automatically.
- **Cheap coverage.** A ~20-line property test often covers what would take a dozen example tests.

---

## Data-Driven Tests with `it.each`

**Pattern.** Tables of input-output pairs use Vitest's `it.each` instead of N separate test blocks. Combat tables, damage lookups, and hex-math boundaries are naturals. Use `as const` for literal type narrowing.

**Minimal example.**

```ts
it.each([
  [{ q: 0, r: 0 }, { q: 3, r: 0 }, 3],
  [{ q: 0, r: 0 }, { q: 0, r: 3 }, 3],
  [{ q: 0, r: 0 }, { q: 3, r: -3 }, 3],   // axial cube diagonal
] as const)('hexDistance(%o, %o) === %i', (a, b, expected) => {
  expect(hexDistance(a, b)).toBe(expected);
});
```

**Where it lives.** Examples in `src/shared/protocol.test.ts` (protocol-valid message iteration) and `src/client/game/transport.test.ts`.

**Why this shape.**

- **Boilerplate shrinks.** 20 test bodies collapse into 20 input rows and one assertion.
- **Readable as data.** Combat-table tests read like a spec.
- **Failure messages are descriptive.** `%o` / `%i` placeholders show the failing row.

---

## Contract Fixtures for Protocol Shapes

**Pattern.** Canonical wire-format payloads live as JSON fixtures paired with their expected validator output. Tests iterate fixtures and assert round-trip correctness. Large `GameState` values use a `"__STATE__"` sentinel so fixtures stay stable when engine types evolve.

**Minimal example.**

```json
// src/shared/__fixtures__/contracts.json
{
  "valid_astrogation": {
    "raw":      { "type": "astrogation", "orders": [] },
    "expected": { "ok": true, "value": { "type": "astrogation", "orders": [] } }
  },
  "empty_movementResult": {
    "raw":      { "type": "movementResult", "movements": [], "events": [], "state": "__STATE__" },
    "expected": { "ok": true, "value": { "type": "movementResult", "movements": [], "events": [], "state": "__STATE__" } }
  }
}
```

**Where it lives.** `src/shared/__fixtures__/contracts.json` (C2S), `src/server/game-do/__fixtures__/transport.json` (S2C + HTTP responses). Loaded via `readFileSync` + `JSON.parse` in protocol and game-do tests.

**Why this shape.**

- **Wire format is an API.** Representative payloads pinned as JSON catch accidental protocol changes better than purely behavioral tests.
- **`"__STATE__"` sentinel** insulates fixtures from `GameState` churn. Envelope changes still need manual fixture updates.
- **Round-trip normalization.** Tests convert `undefined` → `null` to mirror JSON fidelity.

---

## Mock Durable Object Storage

**Pattern.** Tests that touch the DO plumbing use an in-memory `Map<string, unknown>` that implements enough of the `DurableObjectStorage` surface to exercise the code under test. Cast via `as unknown as DurableObjectStorage`.

**Minimal example.**

```ts
const storage: DurableObjectStorage = {
  data: new Map<string, unknown>(),
  get: (key) => Promise.resolve(storage.data.get(key)),
  put: (keyOrRecord, value) => {
    if (typeof keyOrRecord === 'string') storage.data.set(keyOrRecord, value);
    else Object.entries(keyOrRecord).forEach(([k, v]) => storage.data.set(k, v));
    return Promise.resolve();
  },
  delete: (key) => Promise.resolve(storage.data.delete(key)),
  // …list, transaction if needed
} as unknown as DurableObjectStorage;
```

**Where it lives.** Per-file factories in `src/server/game-do/archive.test.ts`, `game-do.test.ts`, `alarm.test.ts`, `match-archive.test.ts`, `fetch.test.ts`. `game-do.test.ts` also mocks `cloudflare:workers` via `vi.mock` to stub the `DurableObject` base class.

**Why this shape.**

- **Tests skip the Wrangler runtime.** Faster, deterministic, easier to debug.
- **Narrow surface area.** Each mock implements only what its test needs. `list` and `transaction` aren't implemented because Delta-V uses simple key-value I/O.

---

## Deterministic RNG in Tests

**Pattern.** Tests pin RNG via seeded PRNGs. `mulberry32(seed)` for full runs; short sequences like `() => 0.5` for single-call asserts; fast-check arbitraries for property-based runs. No test calls `Math.random`.

**Minimal example.**

```ts
// Fixed seed → fixed sequence:
const rng = mulberry32(42);
const result = processCombat(state, playerId, attacks, map, rng);
expect(result.results[0].damage).toBe(3);   // reproducible

// Property test — fast-check supplies:
fc.assert(fc.property(
  fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
  (randomValue) => { /* … */ }
));

// Algorithm snapshot — catch PRNG changes:
const seq = Array.from({ length: 5 }, () => rng());
expect(seq).toMatchInlineSnapshot('[0.123, 0.456, …]');
```

**Where it lives.** `src/shared/prng.ts` (`mulberry32`, `deriveActionRng`). `prng.test.ts` covers determinism, value range `[0, 1)`, uniformity, collision rate, cross-seed divergence.

**Why this shape.**

- **Required RNG parameter** on turn-resolution entry points makes this the only viable approach — tests can't forget to pass one.
- **`deriveActionRng`** means replaying an event range doesn't require replaying the history before it.

---

## Coverage Thresholds

**Pattern.** V8 coverage thresholds are enforced across the engine, server, MCP adapter, and client. Pre-push and CI both run `test:coverage` — thresholds are a ratchet, not a target.

**Minimal example.**

```ts
// vitest config excerpts:
coverage: {
  provider: 'v8',
  thresholds: {
    'src/shared/**/*.ts': {
      statements: 84,
      branches:   75,
      functions:  88,
      lines:      85,
    },
  },
  reporter: ['text', 'html', 'json-summary'],
}
```

**Where it lives.** [`vitest.config.ts`](../vitest.config.ts), [`vitest.coverage.client.config.ts`](../vitest.coverage.client.config.ts), and [`vitest.coverage.server.config.ts`](../vitest.coverage.server.config.ts). Reports in `coverage/client/` and `coverage/server-shared/` (gitignored).

**Why this shape.**

- **Prevents backsliding.** A refactor that adds untested code fails CI.
- **Per-surface floors.** The engine still carries the strictest floors, but server/game-do, MCP adapter, and client coverage are also ratcheted so refactors cannot silently hollow them out.
- **Sequential coverage passes avoid Vitest temp-file races.** Client and server/shared suites no longer share one `coverage/.tmp/` directory.
- **Branch threshold intentionally lower.** Defensive branches in complex game rules are hard to exercise; forcing 85 % branch coverage would encourage exercises that don't add real confidence.

---

## Cross-Pattern Reinforcement

The testing patterns reinforce each other:

- **Property-based tests** (invariants) + **deterministic RNG** (reproducibility) drive high coverage numbers.
- **Coverage thresholds** (enforced) catch backsliding from property tests.
- **Contract fixtures** + **data-driven tests** exercise the protocol boundary comprehensively.
- **Mock storage** enables unit testing of the entire event-sourced persistence layer without Cloudflare runtime.

The main consolidation opportunity is a shared mock-storage module plus broader negative contract coverage — both would tighten what's already mostly solid.
