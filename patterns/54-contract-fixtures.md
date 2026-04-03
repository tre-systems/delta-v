# Contract Fixtures

## Category

Testing

## Intent

Capture canonical protocol payloads as JSON fixture files so that validator tests and transport tests can assert against stable, reviewed, and versionable contracts. When the protocol evolves, the fixture diff shows exactly what changed.

## How It Works in Delta-V

Two `__fixtures__/` directories contain JSON contract files:

1. **`src/shared/__fixtures__/contracts.json`** -- Canonical C2S message payloads paired with their expected validation results, plus replay entry/timeline shapes. Each C2S entry has `raw` (the wire format) and `expected` (the `Result<C2S>` output from `validateClientMessage`).

2. **`src/server/game-do/__fixtures__/transport.json`** -- HTTP response shapes (`initResponse`, `joinResponse`) and S2C message shapes (`gameStart`, `stateUpdate`, `movementResult`, `combatResult`). State fields use the sentinel `"__STATE__"` placeholder since full `GameState` objects are too large and volatile to snapshot.

Tests load these fixtures at runtime via `readFileSync` and `JSON.parse`, then use the data to drive assertions. The `protocol.test.ts` file loads `contracts.json` and runs each C2S entry through `validateClientMessage`, comparing the output to the `expected` field. The `game-do.test.ts` file loads `transport.json` for HTTP response shape assertions.

## Key Locations

- `src/shared/__fixtures__/contracts.json` -- C2S contracts and replay entry shapes
- `src/server/game-do/__fixtures__/transport.json` -- S2C and HTTP response shapes
- `src/shared/protocol.test.ts` (lines 1-34) -- fixture loading and normalisation
- `src/server/game-do/game-do.test.ts` (lines 39-49) -- fixture loading

## Code Examples

Contract fixture structure (C2S):

```json
{
  "c2s": {
    "fleetReady": {
      "raw": {
        "type": "fleetReady",
        "purchases": [{ "shipType": "corvette" }]
      },
      "expected": {
        "ok": true,
        "value": {
          "type": "fleetReady",
          "purchases": [{ "kind": "ship", "shipType": "corvette" }]
        }
      }
    }
  }
}
```

Transport fixture structure (S2C):

```json
{
  "s2c": {
    "movementResult": {
      "type": "movementResult",
      "movements": [{
        "shipId": "p0s0",
        "from": { "q": 5, "r": 10 },
        "to": { "q": 6, "r": 9 },
        "path": [{ "q": 5, "r": 10 }, { "q": 6, "r": 9 }],
        "newVelocity": { "dq": 2, "dr": -1 },
        "fuelSpent": 1,
        "gravityEffects": [],
        "outcome": "normal"
      }],
      "ordnanceMovements": [],
      "events": [],
      "state": "__STATE__"
    }
  }
}
```

Fixture loading in tests:

```typescript
const sharedContractFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/contracts.json', import.meta.url),
    'utf8',
  ),
) as { c2s: Record<string, { raw: unknown; expected: unknown }> };
```

## Consistency Analysis

The fixture pattern is applied to both protocol directions (C2S in shared, S2C in server). Both fixtures use the same structural pattern of grouping by message type with representative payloads.

The `"__STATE__"` sentinel in transport fixtures is a pragmatic choice -- it avoids coupling fixtures to the volatile `GameState` shape while still testing the message envelope. The normalisation helper in `protocol.test.ts` handles `undefined` to `null` conversion for JSON round-trip fidelity.

## Completeness Check

- **Missing fixtures**: Not every C2S message type appears in `contracts.json`. Types like `surrender`, `emplaceBase`, and `combatSingle` are absent. Adding them would make the contract suite more comprehensive.
- **Negative fixtures**: The contracts file only contains valid (success) cases. Adding invalid payload fixtures with `{ "ok": false, "error": "..." }` expected values would create a negative contract suite.
- **Schema evolution**: When `GameState` fields change, the `"__STATE__"` sentinel means transport fixtures do not need updating. However, if message envelope fields change (e.g., adding a new field to `movementResult`), the fixture must be updated manually.

## Related Patterns

- **53 -- Data-Driven Tests**: Contract fixtures provide the data for data-driven `it.each`-style tests.
- **47 -- Discriminated Union Messages**: Fixtures represent concrete instances of the C2S/S2C unions.
- **58 -- Multi-Stage Validation**: Fixtures exercise the first validation stage (protocol parsing).
